import { GameState, HexCoord, ShipState } from './types'
import { hexDistance, isLand, isValidCoord, hexNeighbors, hexToLabel, isBlocked } from './map'
import { canMoveBeforeDetection } from './units'

export interface MoveValidation {
  valid: boolean
  reason?: string
}

/** BFS: 获取指定距离内所有可达格号 */
function getReachableLabels(from: HexCoord, maxSteps: number): string[] {
  const visited = new Set<string>()
  const result: string[] = []
  const queue: { coord: HexCoord; steps: number }[] = [{ coord: from, steps: 0 }]
  visited.add(`${from.q},${from.r}`)

  while (queue.length > 0) {
    const { coord, steps } = queue.shift()!
    if (steps > 0) {
      const label = hexToLabel(coord)
      if (label) result.push(label)
    }
    if (steps >= maxSteps) continue

    for (const nb of hexNeighbors(coord)) {
      const key = `${nb.q},${nb.r}`
      if (visited.has(key)) continue
      if (!isValidCoord(nb) || isLand(nb)) continue
      if (isBlocked(coord, nb)) continue  // 被阻断的边
      visited.add(key)
      queue.push({ coord: nb, steps: steps + 1 })
    }
  }
  return result
}

/** BFS: 检查从 from 是否可不经过陆地到达 to */
function canReachBySea(from: HexCoord, to: HexCoord, maxSteps: number): boolean {
  if (!isValidCoord(from) || !isValidCoord(to)) return false
  if (isLand(to)) return false
  if (hexDistance(from, to) > maxSteps) return false

  const visited = new Set<string>()
  const queue: { coord: HexCoord; steps: number }[] = [{ coord: from, steps: 0 }]
  visited.add(`${from.q},${from.r}`)

  while (queue.length > 0) {
    const { coord, steps } = queue.shift()!
    if (coord.q === to.q && coord.r === to.r) return true
    if (steps >= maxSteps) continue

    for (const nb of hexNeighbors(coord)) {
      const key = `${nb.q},${nb.r}`
      if (visited.has(key)) continue
      if (!isValidCoord(nb) || isLand(nb)) continue
      if (isBlocked(coord, nb)) continue  // 被阻断的边
      visited.add(key)
      queue.push({ coord: nb, steps: steps + 1 })
    }
  }
  return false
}

/** 获取舰船当前速度 (考虑损伤) */
export function getShipSpeed(ship: ShipState): number {
  if (ship.steps <= 0) return 0
  if (ship.def.id === 'bismarck') {
    return ship.steps >= ship.def.maxSteps ? 2 : 1
  }
  return ship.def.speed
}

/** 验证德军舰船移动 */
export function validateGermanMove(
  ship: ShipState,
  from: HexCoord,
  to: HexCoord,
): MoveValidation {
  if (ship.def.side !== 'german') {
    return { valid: false, reason: '不是德军舰船' }
  }
  if (ship.steps <= 0) {
    return { valid: false, reason: '舰船已沉没' }
  }
  if (from.q === to.q && from.r === to.r) return { valid: true }

  const speed = getShipSpeed(ship)
  if (!canReachBySea(from, to, speed)) {
    return { valid: false, reason: `无法在 ${speed} 格内到达目标格` }
  }
  return { valid: true }
}

/** 验证英军舰船移动 */
export function validateBritishMove(
  state: GameState,
  ship: ShipState,
  from: HexCoord,
  to: HexCoord,
): MoveValidation {
  if (ship.def.side !== 'british') {
    return { valid: false, reason: '不是英军舰船' }
  }
  if (ship.steps <= 0) {
    return { valid: false, reason: '舰船已沉没' }
  }
  if (from.q === to.q && from.r === to.r) return { valid: true }

  // 每船每回合只能移动一次
  if (state.movedThisTurn.has(ship.def.id)) {
    return { valid: false, reason: '本回合已移动过此舰船' }
  }

  if (!state.bismarckFound && !canMoveBeforeDetection(ship.def)) {
    return { valid: false, reason: '发现德军前此舰船不能移动' }
  }
  if (!canReachBySea(from, to, 3)) {
    return { valid: false, reason: '无法在 3 格内到达目标格' }
  }
  return { valid: true }
}

/** 获取德军舰船可到达的格号列表 */
export function getGermanReachableLabels(ship: ShipState, from: HexCoord): string[] {
  return getReachableLabels(from, getShipSpeed(ship))
}

/** 获取英军舰船可到达的格号列表 */
export function getBritishReachableLabels(
  state: GameState,
  ship: ShipState,
  from: HexCoord,
): string[] {
  if (!state.bismarckFound && !canMoveBeforeDetection(ship.def)) return []
  if (state.movedThisTurn.has(ship.def.id)) return []  // 已移动过
  return getReachableLabels(from, 3)
}
