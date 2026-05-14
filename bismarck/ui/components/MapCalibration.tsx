import { useRef, useEffect, useCallback, useState } from 'react'
import { getAllHexCells } from '../../engine/map'

interface MapCalibrationProps {
  onConfirm: (scale: number, offX: number, offY: number) => void
}

const MAP_W = 1677
const MAP_H = 1011

// 六角格固定参数 (同 HexMap)
const X0 = 180; const Y0 = 37; const DX = 180; const DY = 156; const HEX_R = 104

function labelToPixel(label: string) {
  const q = label.charCodeAt(0) - 65
  const r = parseInt(label.slice(1)) - 1
  if (isNaN(q) || isNaN(r) || q < 0) return null
  return { x: X0 + r * DX - (q % 2) * (DX / 2), y: Y0 + q * DY }
}

function hexCorners(cx: number, cy: number) {
  const c: { x: number; y: number }[] = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6
    c.push({ x: cx + HEX_R * Math.cos(a), y: cy + HEX_R * Math.sin(a) })
  }
  return c
}

export function MapCalibration({ onConfirm }: MapCalibrationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(() => {
    const v = localStorage.getItem('bismarck_map_scale')
    return v ? parseFloat(v) : 0.92
  })
  const [offX, setOffX] = useState(() => {
    const v = localStorage.getItem('bismarck_map_offx')
    return v ? parseFloat(v) : -52
  })
  const [offY, setOffY] = useState(() => {
    const v = localStorage.getItem('bismarck_map_offy')
    return v ? parseFloat(v) : -41
  })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, offX: 0, offY: 0 })

  // 加载地图
  useEffect(() => {
    const img = new Image()
    img.src = '/map.jpg'
    img.onload = () => { imgRef.current = img; draw() }
  }, [])

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    c.width = MAP_W; c.height = MAP_H
    ctx.clearRect(0, 0, MAP_W, MAP_H)

    // 底图
    if (imgRef.current) {
      ctx.drawImage(imgRef.current, offX, offY, MAP_W * scale, MAP_H * scale)
    }

    // 六角格
    for (const cell of getAllHexCells()) {
      const p = labelToPixel(cell.label)
      if (!p) continue
      const corners = hexCorners(p.x, p.y)
      ctx.beginPath()
      ctx.moveTo(corners[0].x, corners[0].y)
      for (let i = 1; i < 6; i++) ctx.lineTo(corners[i].x, corners[i].y)
      ctx.closePath()
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.lineWidth = 1
      ctx.stroke()

      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.font = 'bold 11px system-ui'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'bottom'
      ctx.fillText(cell.label, p.x + HEX_R * 0.65, p.y + HEX_R * 0.7)
    }
  }, [scale, offX, offY])

  useEffect(() => { draw() }, [draw])

  // 鼠标事件
  const onMouseDown = (e: React.MouseEvent) => {
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, offX, offY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging) return
    const dx = e.clientX - dragStart.current.x
    const dy = e.clientY - dragStart.current.y
    setOffX(dragStart.current.offX + dx)
    setOffY(dragStart.current.offY + dy)
  }
  const onMouseUp = () => setDragging(false)

  // 滚轮缩放
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.01 : 0.01
    setScale(s => Math.max(0.5, Math.min(2.5, s + delta)))
  }

  const reset = () => { setScale(0.92); setOffX(-52); setOffY(-41) }

  const confirm = () => {
    localStorage.setItem('bismarck_map_scale', String(scale))
    localStorage.setItem('bismarck_map_offx', String(offX))
    localStorage.setItem('bismarck_map_offy', String(offY))
    onConfirm(scale, offX, offY)
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center gap-2 p-4">
      <h2 className="text-white text-xl font-bold">校准地图 — 拖拽/滚轮对齐六角格</h2>

      <div className="flex gap-4 text-white text-sm">
        <span>缩放: {scale.toFixed(2)}</span>
        <span>X: {offX}</span>
        <span>Y: {offY}</span>
      </div>

      <div className="overflow-auto border-2 border-yellow-500 rounded" style={{ maxWidth: '95vw', maxHeight: '65vh' }}>
        <canvas
          ref={canvasRef}
          className="block cursor-grab"
          style={{ width: `${MAP_W * 0.55}px`, height: `${MAP_H * 0.55}px` }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        />
      </div>

      <div className="flex gap-3">
        <button onClick={reset} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded font-bold">重置</button>
        <button
          onClick={() => { setScale(s => s + 0.01); draw() }}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
        >+ 放大</button>
        <button
          onClick={() => { setScale(s => Math.max(0.5, s - 0.01)); draw() }}
          className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded"
        >- 缩小</button>
        <button onClick={confirm} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold text-lg">确认对齐</button>
      </div>

      <p className="text-slate-400 text-xs">提示: 鼠标拖拽平移, 滚轮缩放, 也可用 +/- 按钮微调</p>
    </div>
  )
}
