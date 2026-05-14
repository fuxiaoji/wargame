import { useRef, useEffect, useCallback, useState } from 'react'
import { getAllHexCells, hexToLabel } from '../../engine/map'
import { GameState, ShipState } from '../../engine/types'

interface HexMapProps {
  gameState: GameState
  highlightedHexes: Set<string>
  selectedHex: string | null
  showGermanPositions: boolean
  onHexClick: (label: string) => void
  mapScale?: number
  mapOffX?: number
  mapOffY?: number
  tokenScale?: number
  zoom?: number
}

// ============================================================
//  六角格参数 —— 字母 A..G 从上到下, 数字 1..8 从左到右
//  奇数列(B/D/F)向左错半格, pointy-top
// ============================================================
const MAP_W = 1677
const MAP_H = 1011

const X0 = 180       // 左边缘到 A 列中心
const Y0 = 37        // 上边缘到 A 行中心
const DX = 180       // 同行邻格水平距离 (←→)
const DY = 156       // 同列邻格垂直距离 (↑↓)
const HEX_R = 104    // 六角格半径

// ============ 格号 ↔ 像素 ============
function labelToPixel(label: string): { x: number; y: number } | null {
  const q = label.charCodeAt(0) - 65
  const r = parseInt(label.slice(1)) - 1
  if (isNaN(q) || isNaN(r) || q < 0) return null
  return {
    x: X0 + r * DX - (q % 2) * (DX / 2),
    y: Y0 + q * DY,
  }
}

function pixelToLabel(px: number, py: number): string | null {
  let best: string | null = null
  let bestDist = Infinity
  for (const cell of getAllHexCells()) {
    const p = labelToPixel(cell.label)
    if (!p) continue
    const d = (p.x - px) ** 2 + (p.y - py) ** 2
    if (d < bestDist) { bestDist = d; best = cell.label }
  }
  if (bestDist > HEX_R * HEX_R) return null
  return best
}

// ============ 六角格几何 ============
function hexCorners(cx: number, cy: number): { x: number; y: number }[] {
  const c: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    c.push({ x: cx + HEX_R * Math.cos(a), y: cy + HEX_R * Math.sin(a) })
  }
  return c
}

// ============ 六角格覆盖层 ============
function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  cells: ReturnType<typeof getAllHexCells>,
  highlightedHexes: Set<string>,
  selectedHex: string | null,
) {
  for (const cell of cells) {
    const p = labelToPixel(cell.label)
    if (!p) continue

    const isHl = highlightedHexes.has(cell.label)
    const isSel = selectedHex === cell.label
    const corners = hexCorners(p.x, p.y)

    let fill = 'rgba(30,58,95,0.06)'
    if (cell.isLand) fill = 'rgba(60,40,30,0.22)'
    if (cell.isPort) fill = 'rgba(80,50,20,0.28)'

    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.fillStyle = fill
    ctx.fill()

    const stroke = isSel ? '#fbbf24' : isHl ? '#34d399' : 'rgba(255,255,255,0.15)'
    const lw = isSel ? 2.5 : isHl ? 2 : 0.5
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = 'bold 11px system-ui'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(cell.label, p.x + HEX_R * 0.65, p.y + HEX_R * 0.7)

    if (cell.isSeaRoute && !cell.isLand) {
      ctx.fillStyle = 'rgba(255,220,120,0.5)'
      ctx.beginPath()
      ctx.arc(p.x + HEX_R * 0.3, p.y + HEX_R * 0.25, 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

// ============ 算子 ============
const TOKEN_W = 42
const TOKEN_H = 34

function tokenColors(side: 'german' | 'british', revealed: boolean, isDummy: boolean) {
  if (isDummy) return { bg: '#4a5568', fg: '#cbd5e0', border: '#718096' }
  if (side === 'german') return { bg: '#742a2a', fg: '#fff', border: '#fc8181' }
  if (revealed) return { bg: '#2a4365', fg: '#fff', border: '#63b3ed' }
  return { bg: '#2d3748', fg: '#a0aec0', border: '#4a5568' }
}

function drawToken(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  ship: ShipState,
  stackIdx: number,
  stackTotal: number,
  scale: number,
  viewerIsGerman: boolean,
) {
  const { def, steps } = ship
  // 规则5.0: 德军视角下未翻开的英军算子显示为 ?
  const hideFromGerman = viewerIsGerman && def.side === 'british' && !ship.revealed && !def.isDummy
  const col = tokenColors(def.side, ship.revealed, def.isDummy)
  const w = TOKEN_W * scale; const h = TOKEN_H * scale
  const ox = (stackIdx - (stackTotal - 1) / 2) * 7 * scale
  const oy = -stackIdx * 4 * scale
  const tx = cx + ox
  const ty = cy + oy

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath()
  ctx.roundRect(tx - w / 2 + 1, ty - h / 2 + 1, w, h, 4 * scale)
  ctx.fill()

  ctx.fillStyle = hideFromGerman ? '#2d3748' : col.bg
  ctx.strokeStyle = hideFromGerman ? '#4a5568' : col.border
  ctx.lineWidth = 1.5 * scale
  ctx.beginPath()
  ctx.roundRect(tx - w / 2, ty - h / 2, w, h, 4 * scale)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = hideFromGerman ? '#a0aec0' : col.fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (def.isDummy || hideFromGerman) {
    ctx.font = `bold ${Math.round(17 * scale)}px system-ui`
    ctx.fillText('?', tx, ty)
  } else {
    ctx.font = `bold ${Math.round(9 * scale)}px system-ui`
    const name = def.name.length > 4 ? def.name.slice(0, 4) : def.name
    ctx.fillText(name, tx, ty - 9 * scale)

    ctx.font = `bold ${Math.round(11 * scale)}px system-ui`
    ctx.fillText(`${def.attack}/${def.defense}`, tx, ty + 2 * scale)

    const barW = w - 10 * scale
    const barH = 4 * scale
    const barY = ty + h / 2 - barH - 3 * scale
    const ratio = steps / def.maxSteps
    ctx.fillStyle = '#1a202c'
    ctx.fillRect(tx - barW / 2, barY, barW, barH)
    ctx.fillStyle = ratio > 0.66 ? '#48bb78' : ratio > 0.33 ? '#ecc94b' : '#fc8181'
    ctx.fillRect(tx - barW / 2, barY, barW * ratio, barH)
  }

  ctx.restore()
}

// ============ 组件 ============
export function HexMap({
  gameState,
  highlightedHexes,
  selectedHex,
  showGermanPositions,
  onHexClick,
  mapScale,
  mapOffX,
  mapOffY,
  tokenScale = 1,
  zoom = 1,
}: HexMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapImgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)

  // 加载底图 (如果有校准参数)
  const hasMap = mapScale !== undefined && mapOffX !== undefined && mapOffY !== undefined
  useEffect(() => {
    if (!hasMap) return
    const img = new Image()
    img.src = '/map.jpg'
    img.onload = () => {
      mapImgRef.current = img
      setImgLoaded(true)
    }
  }, [hasMap])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const px = (e.clientX - rect.left) * sx
    const py = (e.clientY - rect.top) * sy
    const label = pixelToLabel(px, py)
    if (label) onHexClick(label)
  }, [onHexClick])

  const drawFrame = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    canvas.width = MAP_W
    canvas.height = MAP_H
    ctx.clearRect(0, 0, MAP_W, MAP_H)

    // ---- 1) 底图 ----
    if (hasMap && mapImgRef.current) {
      ctx.drawImage(mapImgRef.current, mapOffX!, mapOffY!, MAP_W * mapScale!, MAP_H * mapScale!)
    } else {
      const grad = ctx.createLinearGradient(0, 0, MAP_W, MAP_H)
      grad.addColorStop(0, '#1a3a5c')
      grad.addColorStop(0.5, '#1e4d7a')
      grad.addColorStop(1, '#162d4a')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, MAP_W, MAP_H)

      ctx.fillStyle = 'rgba(255,255,255,0.04)'
      ctx.font = 'bold 44px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('北 大 西 洋', MAP_W * 0.48, MAP_H * 0.5)

      ctx.save(); ctx.setLineDash([16, 12])
      ctx.strokeStyle = 'rgba(255,200,100,0.35)'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(60, 460); ctx.bezierCurveTo(350, 420, 650, 400, 1150, 580); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(60, 500); ctx.bezierCurveTo(350, 510, 650, 520, 1100, 790); ctx.stroke()
      ctx.setLineDash([]); ctx.restore()

      ctx.fillStyle = 'rgba(255,200,150,0.4)'; ctx.font = 'italic bold 10px system-ui'
      ctx.fillText('—— 运输航线 ——', 500, 440); ctx.fillText('—— 运输航线 ——', 500, 540)

      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(1350, 817, 8, 0, Math.PI*2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'
      ctx.fillText('布雷斯特 F7', 1364, 821)

      ctx.fillStyle = 'rgba(255,100,100,0.35)'; ctx.font = 'italic 10px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('德军起始区 (A5/A6/B7)', 1050, 20)
    }

    // ---- 2) 六角格 ----
    const cells = getAllHexCells()
    drawHexGrid(ctx, cells, highlightedHexes, selectedHex)

    // ---- 3) 算子 ----
    const hexUnits = new Map<string, ShipState[]>()
    const addShips = (ships: ShipState[], posMap: Map<string, { q: number; r: number }>) => {
      for (const ship of ships) {
        if (ship.steps <= 0) continue
        const pos = posMap.get(ship.def.id)
        if (!pos) continue
        const label = hexToLabel(pos)
        if (!label) continue
        if (!hexUnits.has(label)) hexUnits.set(label, [])
        hexUnits.get(label)!.push(ship)
      }
    }

    addShips(gameState.britishShips, gameState.britishPositions)
    if (showGermanPositions || gameState.germanPositionPublic) {
      addShips(gameState.germanShips, gameState.germanPositions)
    }

    for (const [label, units] of hexUnits) {
      const p = labelToPixel(label)
      if (!p) continue
      if (units.length > 1) {
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 11px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillText(`×${units.length}`, p.x, p.y - TOKEN_H / 2 - 13)
      }
      units.forEach((ship, i) => drawToken(ctx, p.x, p.y, ship, i, units.length, tokenScale, showGermanPositions))
    }
  }, [gameState, highlightedHexes, selectedHex, showGermanPositions, imgLoaded, mapScale, mapOffX, mapOffY, tokenScale])

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    drawFrame(c)
  }, [drawFrame])

  return (
    <div className="relative overflow-auto border border-slate-600 rounded-lg" style={{ maxHeight: '75vh' }}>
      <canvas
        ref={canvasRef}
        className="block cursor-crosshair"
        style={{ width: `${100 * zoom}%`, height: 'auto', transformOrigin: 'top left' }}
        onClick={handleClick}
      />
    </div>
  )
}
