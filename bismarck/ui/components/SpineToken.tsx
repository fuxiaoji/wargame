/**
 * SpineToken — 在六角格地图上渲染单个 spine 小人物
 *
 * 用绝对定位的 canvas 叠加在 HexMap 的 canvas 之上，
 * 替代原有的方块算子 (drawToken)。
 */
import { useEffect, useRef } from 'react'
import { SpineManager } from '../spine/SpineManager'
import { SpineCharacter, type AnimEvent } from '../spine/SpineCharacter'

interface SpineTokenProps {
  shipId: string
  px: number
  py: number
  stackIdx: number
  stackTotal: number
  anim: AnimEvent
  hidden: boolean
  tokenScale?: number
  mapW: number
  mapH: number
}

function shipAnimEvent(
  _shipId: string,
  selectedShip: string | null,
  isMoving: boolean,
  isDamaged: boolean,
  _isVictorious: boolean,
  gameOver: boolean,
): AnimEvent {
  if (isDamaged) return 'damaged'
  if (gameOver) return 'victory'
  if (selectedShip === _shipId) return 'selected'
  if (isMoving) return 'moving'
  return 'idle'
}

export { shipAnimEvent }

const TOKEN_PX = 80
const CANVAS_RES = 200

export function SpineToken({
  shipId,
  px,
  py,
  stackIdx,
  stackTotal,
  anim,
  hidden,
  tokenScale = 1,
}: SpineTokenProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const charRef = useRef<SpineCharacter | null>(null)

  useEffect(() => {
    const asset = SpineManager.getAsset(shipId)
    if (!asset) return

    const res = Math.round(CANVAS_RES * tokenScale)
    try {
      const char = new SpineCharacter(asset, res, res)
      charRef.current = char

      const canvas = char.getCanvas()
      if (!canvas) return
      canvas.style.width = '100%'
      canvas.style.height = '100%'

      if (containerRef.current) {
        containerRef.current.innerHTML = ''
        containerRef.current.appendChild(canvas)
      }

      return () => {
        char.destroy()
        charRef.current = null
      }
    } catch (e) {
      console.warn('[SpineToken] create failed:', e)
    }
  }, [shipId])

  useEffect(() => {
    if (charRef.current) {
      charRef.current.setAnimation(anim)
    }
  }, [anim])

  if (hidden) return null

  const size = TOKEN_PX * tokenScale
  const ox = (stackIdx - (stackTotal - 1) / 2) * 7 * tokenScale
  const oy = -stackIdx * 4 * tokenScale

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        left: px + ox - size / 2,
        top: py + oy - size / 2,
        width: size,
        height: size,
        pointerEvents: 'none',
        zIndex: 20 + stackIdx,
      }}
    />
  )
}
