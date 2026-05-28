import { useRef, useEffect, useCallback, useState } from 'react'
import { getAllHexCells, hexToLabel } from '../../engine/map'
import { GameState, ShipState } from '../../engine/types'


interface HexMapProps {
  gameState: GameState
  highlightedHexes: Set<string>
  selectedHex: string | null
  showGermanPositions: boolean
  transportRevealedHex: string | null
  onHexClick: (label: string) => void
  mapScale?: number
  mapOffX?: number
  mapOffY?: number
  tokenScale?: number
  zoom?: number
  heatmapData?: Float32Array | null
  selectedShip?: string | null
  displayMode?: 'token' | 'sprite'
}

const MAP_W = 1677
const MAP_H = 1011
const X0 = 180
const Y0 = 37
const DX = 180
const DY = 156
const HEX_R = 104

function labelToPixel(label: string): { x: number; y: number } | null {
  const q = label.charCodeAt(0) - 65
  const r = parseInt(label.slice(1)) - 1
  if (isNaN(q) || isNaN(r) || q < 0) return null
  return { x: X0 + r * DX - (q % 2) * (DX / 2), y: Y0 + q * DY }
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

function hexCorners(cx: number, cy: number): { x: number; y: number }[] {
  const c: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    c.push({ x: cx + HEX_R * Math.cos(a), y: cy + HEX_R * Math.sin(a) })
  }
  return c
}

function drawHexGrid(
  ctx: CanvasRenderingContext2D,
  cells: ReturnType<typeof getAllHexCells>,
  highlightedHexes: Set<string>,
  selectedHex: string | null,
  transportRevealedHex: string | null,
  heatmapData?: Float32Array | null,
) {
  // 热力图 min/max
  let hMin = 0, hMax = 0
  if (heatmapData) {
    for (let i = 0; i < 48; i++) { if (heatmapData[i] < hMin) hMin = heatmapData[i]; if (heatmapData[i] > hMax) hMax = heatmapData[i] }
    if (hMax - hMin < 0.01) hMax = hMin + 1 // 避免除零
  }

  for (const cell of cells) {
    const p = labelToPixel(cell.label)
    if (!p) continue
    const isHl = highlightedHexes.has(cell.label)
    const isSel = selectedHex === cell.label
    const isTransport = transportRevealedHex === cell.label
    const corners = hexCorners(p.x, p.y)

    let fill = 'rgba(30,58,95,0.06)'
    if (cell.isLand) fill = 'rgba(60,40,30,0.22)'
    if (cell.isPort) fill = 'rgba(80,50,20,0.28)'
    if (isTransport) fill = 'rgba(200,60,50,0.28)'

    ctx.beginPath()
    ctx.moveTo(corners[0].x, corners[0].y)
    for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y)
    ctx.closePath()
    ctx.fillStyle = fill; ctx.fill()

    // 热力图叠加
    if (heatmapData) {
      const q = cell.label.charCodeAt(0) - 65
      const r = parseInt(cell.label.slice(1)) - 1
      if (q >= 0 && q < 6 && r >= 0 && r < 8) {
        const v = heatmapData[r * 6 + q]
        const t = (v - hMin) / (hMax - hMin) // 0~1
        // 蓝(-) → 白(0) → 红(+)
        const r2 = Math.round(t * 255)
        const b2 = Math.round((1 - t) * 255)
        const alpha = Math.min(0.35, Math.abs(v) / (Math.max(Math.abs(hMin), Math.abs(hMax)) + 1) * 0.5)
        ctx.beginPath()
        ctx.moveTo(corners[0].x, corners[0].y)
        for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y)
        ctx.closePath()
        ctx.fillStyle = `rgba(${r2},0,${b2},${alpha.toFixed(2)})`; ctx.fill()
      }
    }

    const stroke = isTransport ? 'rgba(255,80,70,0.7)' : isSel ? '#fbbf24' : isHl ? '#34d399' : 'rgba(255,255,255,0.15)'
    const lw = isTransport ? 2 : isSel ? 2.5 : isHl ? 2 : 0.5
    ctx.strokeStyle = stroke; ctx.lineWidth = lw
    ctx.stroke()

    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'
    ctx.fillText(cell.label, p.x + HEX_R * 0.65, p.y + HEX_R * 0.7)

    if (cell.isSeaRoute && !cell.isLand) {
      ctx.fillStyle = 'rgba(255,220,120,0.5)'
      ctx.beginPath(); ctx.arc(p.x + HEX_R * 0.3, p.y + HEX_R * 0.25, 3, 0, Math.PI * 2); ctx.fill()
    }
  }
}

// ============ 方块算子 (底层回退) ============
const TOKEN_W = 42
const TOKEN_H = 34

function tokenColors(side: 'german' | 'british', revealed: boolean, isDummy: boolean) {
  if (isDummy) return { bg: '#4a5568', fg: '#cbd5e0', border: '#718096' }
  if (side === 'german') return { bg: '#742a2a', fg: '#fff', border: '#fc8181' }
  if (revealed) return { bg: '#2a4365', fg: '#fff', border: '#63b3ed' }
  return { bg: '#2d3748', fg: '#a0aec0', border: '#4a5568' }
}

function drawToken(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  ship: ShipState, stackIdx: number, stackTotal: number, scale: number, viewerIsGerman: boolean,
) {
  const { def, steps } = ship
  const hide = viewerIsGerman && def.side === 'british' && !ship.revealed
  const col = tokenColors(def.side, ship.revealed, def.isDummy)
  const w = TOKEN_W * scale; const h = TOKEN_H * scale
  const ox = (stackIdx - (stackTotal - 1) / 2) * 7 * scale
  const oy = -stackIdx * 4 * scale
  const tx = cx + ox; const ty = cy + oy

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  ctx.beginPath(); ctx.roundRect(tx - w / 2 + 1, ty - h / 2 + 1, w, h, 4 * scale); ctx.fill()

  ctx.fillStyle = hide ? '#2d3748' : col.bg
  ctx.strokeStyle = hide ? '#4a5568' : col.border
  ctx.lineWidth = 1.5 * scale
  ctx.beginPath(); ctx.roundRect(tx - w / 2, ty - h / 2, w, h, 4 * scale); ctx.fill(); ctx.stroke()

  ctx.fillStyle = hide ? '#a0aec0' : col.fg
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'

  if (def.isDummy || hide) {
    ctx.font = `bold ${Math.round(17 * scale)}px system-ui`; ctx.fillText('?', tx, ty)
  } else {
    ctx.font = `bold ${Math.round(9 * scale)}px system-ui`
    const name = def.name.length > 4 ? def.name.slice(0, 4) : def.name
    ctx.fillText(name, tx, ty - 9 * scale)
    ctx.font = `bold ${Math.round(11 * scale)}px system-ui`
    ctx.fillText(`${def.attack}/${def.defense}`, tx, ty + 2 * scale)

    const barW = w - 10 * scale; const barH = 4 * scale; const barY = ty + h / 2 - barH - 3 * scale
    const ratio = steps / def.maxSteps
    ctx.fillStyle = '#1a202c'; ctx.fillRect(tx - barW / 2, barY, barW, barH)
    ctx.fillStyle = ratio > 0.66 ? '#48bb78' : ratio > 0.33 ? '#ecc94b' : '#fc8181'
    ctx.fillRect(tx - barW / 2, barY, barW * ratio, barH)
  }
  ctx.restore()
}

// ============ Token 收集 ============
interface TokenInfo {
  shipId: string; px: number; py: number; stackIdx: number; stackTotal: number
  hidden: boolean; isDummy: boolean
}

function collectTokens(gameState: GameState, showGermanPositions: boolean): TokenInfo[] {
  const tokens: TokenInfo[] = []
  const addShips = (ships: ShipState[], posMap: Map<string, { q: number; r: number }>, viewerIsGerman: boolean) => {
    const hexUnits = new Map<string, ShipState[]>()
    for (const ship of ships) {
      if (ship.steps <= 0) continue
      const pos = posMap.get(ship.def.id); if (!pos) continue
      const label = hexToLabel(pos); if (!label) continue
      if (!hexUnits.has(label)) hexUnits.set(label, [])
      hexUnits.get(label)!.push(ship)
    }
    for (const [, units] of hexUnits) {
      units.forEach((ship, i) => {
        const pos = posMap.get(ship.def.id)!; const label = hexToLabel(pos)!
        const pixel = labelToPixel(label)!
        const hidden = viewerIsGerman && ship.def.side === 'british' && !ship.revealed
        tokens.push({ shipId: ship.def.id, px: pixel.x, py: pixel.y, stackIdx: i, stackTotal: units.length, hidden, isDummy: ship.def.isDummy })
      })
    }
  }
  addShips(gameState.britishShips, gameState.britishPositions, showGermanPositions)
  if (showGermanPositions) {
    addShips(gameState.germanShips, gameState.germanPositions, false)
  }
  return tokens
}

// ============ 组件 ============
export function HexMap({
  gameState, highlightedHexes, selectedHex, showGermanPositions, transportRevealedHex,
  onHexClick, mapScale, mapOffX, mapOffY, tokenScale = 1, zoom = 1, selectedShip = null,
  displayMode = 'sprite', heatmapData = null,
}: HexMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mapImgRef = useRef<HTMLImageElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const hasMap = mapScale !== undefined && mapOffX !== undefined && mapOffY !== undefined


  useEffect(() => {
    if (!hasMap) return
    const img = new Image()
    img.src = '/map.jpg'; img.onload = () => { mapImgRef.current = img; setImgLoaded(true) }
  }, [hasMap])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width; const sy = canvas.height / rect.height
    const label = pixelToLabel((e.clientX - rect.left) * sx, (e.clientY - rect.top) * sy)
    if (label) onHexClick(label)
  }, [onHexClick])

  const drawFrame = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext('2d'); if (!ctx) return
    canvas.width = MAP_W; canvas.height = MAP_H
    ctx.clearRect(0, 0, MAP_W, MAP_H)

    if (hasMap && mapImgRef.current) {
      ctx.drawImage(mapImgRef.current, mapOffX!, mapOffY!, MAP_W * mapScale!, MAP_H * mapScale!)
    } else {
      const grad = ctx.createLinearGradient(0, 0, MAP_W, MAP_H)
      grad.addColorStop(0, '#1a3a5c'); grad.addColorStop(0.5, '#1e4d7a'); grad.addColorStop(1, '#162d4a')
      ctx.fillStyle = grad; ctx.fillRect(0, 0, MAP_W, MAP_H)

      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.font = 'bold 44px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('北 大 西 洋', MAP_W * 0.48, MAP_H * 0.5)

      ctx.save(); ctx.setLineDash([16, 12])
      ctx.strokeStyle = 'rgba(255,200,100,0.35)'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(60, 460); ctx.bezierCurveTo(350, 420, 650, 400, 1150, 580); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(60, 500); ctx.bezierCurveTo(350, 510, 650, 520, 1100, 790); ctx.stroke()
      ctx.setLineDash([]); ctx.restore()

      ctx.fillStyle = 'rgba(255,200,150,0.4)'; ctx.font = 'italic bold 10px system-ui'
      ctx.fillText('—— 运输航线 ——', 500, 440); ctx.fillText('—— 运输航线 ——', 500, 540)

      ctx.fillStyle = '#fbbf24'; ctx.beginPath(); ctx.arc(1350, 817, 8, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'
      ctx.fillText('布雷斯特 F7', 1364, 821)

      ctx.fillStyle = 'rgba(255,100,100,0.35)'; ctx.font = 'italic 10px system-ui'; ctx.textAlign = 'center'
      ctx.fillText('德军起始区 (A5/A6/B7)', 1050, 20)
    }

    drawHexGrid(ctx, getAllHexCells(), highlightedHexes, selectedHex, transportRevealedHex, heatmapData)

    const tokens = collectTokens(gameState, showGermanPositions)
    for (const t of tokens) {
      const ship = [...gameState.britishShips, ...gameState.germanShips].find(s => s.def.id === t.shipId)
      if (ship) drawToken(ctx, t.px, t.py, ship, t.stackIdx, t.stackTotal, tokenScale, showGermanPositions)
    }
  }, [gameState, highlightedHexes, selectedHex, showGermanPositions, imgLoaded, mapScale, mapOffX, mapOffY, tokenScale, transportRevealedHex, heatmapData])

  useEffect(() => { const c = canvasRef.current; if (c) drawFrame(c) }, [drawFrame])

  const tokens = collectTokens(gameState, showGermanPositions)
  const CHIBI_SIZE = 72

  return (
    <div className="relative overflow-auto border border-slate-600 rounded-lg" style={{ maxHeight: '75vh' }}>
      <div style={{ position: 'relative', width: MAP_W * zoom, height: MAP_H * zoom }}>
        <canvas ref={canvasRef} className="block cursor-crosshair"
          style={{ width: MAP_W * zoom, height: MAP_H * zoom }}
          onClick={handleClick}
        />

        {/* Chibi PNG 层 — 回退 */}
        {displayMode === 'sprite' && tokens.map((t, idx) => {
          const ship = [...gameState.britishShips, ...gameState.germanShips].find(s => s.def.id === t.shipId)
          if (!ship || t.hidden) return null
          const size = CHIBI_SIZE * tokenScale * zoom
          const ox = (t.stackIdx - (t.stackTotal - 1) / 2) * 8 * tokenScale * zoom
          const oy = -t.stackIdx * 5 * tokenScale * zoom
          const labelY = t.py * zoom + oy - size * 0.7 - 12 * tokenScale * zoom
          return <span key={`chibi-${t.shipId}-${idx}`}>
            <span style={{
              position: 'absolute', left: t.px * zoom + ox - 30, top: labelY,
              width: 60, textAlign: 'center', pointerEvents: 'none',
              zIndex: 10 + t.stackIdx, fontSize: `${Math.round(9 * tokenScale * zoom)}px`,
              color: ship.def.side === 'german' ? '#f87171' : '#60a5fa',
              fontWeight: 'bold', textShadow: '0 1px 2px black',
            }}>{ship.def.name}</span>
            <img src={`/spine/${t.shipId}/chibi.png`} alt={ship.def.name}
            style={{
              position: 'absolute',
              left: t.px * zoom + ox - size / 2,
              top: t.py * zoom + oy - size * 0.7,
              width: size, height: size, objectFit: 'contain', pointerEvents: 'none',
              zIndex: 10 + t.stackIdx,
              filter: selectedShip === t.shipId ? 'drop-shadow(0 0 6px #fbbf24)' : 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))',
              opacity: t.isDummy ? 0.75 : 1,
            }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          /></span>
        })}
      </div>
    </div>
  )
}
