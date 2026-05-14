import { GameState, ShipState } from './types'
import { isSeaRoute, hexToLabel } from './map'
import { Randomizer } from './random'

export interface TransportResult {
  /** 是否宣告位置 */
  positionRevealed: boolean
  /** 获得 VP */
  vpGained: number
  /** 结果描述 */
  description: string
}

/**
 * 运输舰队攻击查表 (8.0)
 * D6 结果:
 *   1: 信号泄露 - 必须宣告当前位置
 *   2: 无效果
 *   3: 1 VP
 *   4: 1 VP + 信号泄露
 *   5: 2 VP
 *   6: 2 VP + 信号泄露
 */
const TRANSPORT_TABLE: { vp: number; reveal: boolean }[] = [
  { vp: 0, reveal: true },   // 1: 信号泄露
  { vp: 0, reveal: false },  // 2: 无效果
  { vp: 1, reveal: false },  // 3: 1 VP
  { vp: 1, reveal: true },   // 4: 1 VP + 信号泄露
  { vp: 2, reveal: false },  // 5: 2 VP
  { vp: 2, reveal: true },   // 6: 2 VP + 信号泄露
]

/** 检查舰船是否在航路上 */
export function isOnSeaRoute(ship: ShipState, state: GameState): boolean {
  const pos = state.germanPositions.get(ship.def.id)
  return pos ? isSeaRoute(pos) : false
}

/** 获取可以攻击运输舰队的德军舰船 */
export function getTransportAttackers(state: GameState): ShipState[] {
  return state.germanShips.filter(s => {
    if (s.steps <= 0) return false
    const pos = state.germanPositions.get(s.def.id)
    if (!pos) return false
    return isSeaRoute(pos)
  })
}

/** 攻击运输舰队 */
export function attackTransport(
  state: GameState,
  ship: ShipState,
  rng: Randomizer,
): TransportResult {
  const roll = rng.d6()
  const entry = TRANSPORT_TABLE[roll - 1]
  const pos = state.germanPositions.get(ship.def.id)
  const label = pos ? hexToLabel(pos) : '?'

  let description = `${ship.def.name} 在 ${label} 攻击运输舰队: 骰点 ${roll} → `

  if (entry.vp === 0 && entry.reveal) {
    description += '信号泄露! 德军必须宣告当前位置。'
  } else if (entry.vp === 0) {
    description += '无效果。'
  } else if (entry.vp > 0 && entry.reveal) {
    description += `获得 ${entry.vp} VP，但信号泄露!`
  } else {
    description += `获得 ${entry.vp} VP。`
  }

  state.vp.german += entry.vp

  return {
    positionRevealed: entry.reveal,
    vpGained: entry.vp,
    description,
  }
}
