import { GameState, HexCoord, ShipState } from './types'
import { hexEquals, hexNeighbors, hexToLabel, labelToHex } from './map'
import { Randomizer } from './random'

export interface SearchResult {
  type: 'none' | 'co-locate' | 'air-search'
  germanLabel?: string
  foundShips: ShipState[]
  revealedBritish: ShipState[]
  searchedAdjacent?: string
}

/** 同格索敌 (6.0): 德军与英军同格时必须告知格号 */
export function checkCoLocationSearch(state: GameState): SearchResult {
  const found: ShipState[] = []
  const revealed: ShipState[] = []

  for (const gShip of state.germanShips) {
    if (gShip.steps <= 0) continue
    const gPos = state.germanPositions.get(gShip.def.id)
    if (!gPos) continue

    for (const bShip of state.britishShips) {
      if (bShip.steps <= 0) continue
      // 伪装算子也要参与同格索敌——规则 6.0："英军"包括伪装
      const bPos = state.britishPositions.get(bShip.def.id)
      if (!bPos) continue

      if (hexEquals(gPos, bPos)) {
        if (!bShip.revealed) {
          bShip.revealed = true
          revealed.push(bShip)
        }
        found.push(gShip)
      }
    }
  }

  if (found.length > 0) {
    const gPos = state.germanPositions.get(found[0].def.id)!
    return {
      type: 'co-locate',
      germanLabel: hexToLabel(gPos) ?? undefined,
      foundShips: found,
      revealedBritish: revealed,
    }
  }

  return { type: 'none', foundShips: [], revealedBritish: [] }
}

/** 航空索敌 (6.1): Ark Royal 对相邻格搜索 */
export function performAirSearch(
  state: GameState,
  adjacentLabel: string,
): SearchResult {
  const targetCoord = labelToHex(adjacentLabel)
  if (!targetCoord) {
    return { type: 'none', foundShips: [], revealedBritish: [] }
  }

  const found: ShipState[] = []
  for (const gShip of state.germanShips) {
    if (gShip.steps <= 0) continue
    const gPos = state.germanPositions.get(gShip.def.id)
    if (!gPos) continue
    if (hexEquals(gPos, targetCoord)) {
      found.push(gShip)
    }
  }

  return {
    type: 'air-search',
    searchedAdjacent: adjacentLabel,
    germanLabel: found.length > 0 ? adjacentLabel : undefined,
    foundShips: found,
    revealedBritish: [],
  }
}

/** 获取航空索敌可选邻格 (Ark Royal 周边有效格) */
export function getAirSearchTargets(
  _state: GameState,
  arkRoyalPos: HexCoord,
): string[] {
  return hexNeighbors(arkRoyalPos)
    .map(c => hexToLabel(c))
    .filter((l): l is string => l !== null)
}

/** 伪装算子鉴定 (6.2): 投骰决定伪装算子是否移除 */
export function checkDummyIdentification(
  _state: GameState,
  dummy: ShipState,
  rng: Randomizer,
): { removed: boolean } {
  if (!dummy.def.isDummy) return { removed: false }

  const bismarck = _state.germanShips.find(s => s.def.id === 'bismarck')
  const speed = bismarck
    ? (bismarck.steps >= bismarck.def.maxSteps ? 2 : 1)
    : 2

  const roll = rng.d6()
  const threshold = speed === 2 ? 4 : 2

  return { removed: roll <= threshold }
}

/** 获取指定格的德军舰船 */
export function getGermanShipsAt(state: GameState, coord: HexCoord): ShipState[] {
  const result: ShipState[] = []
  for (const ship of state.germanShips) {
    if (ship.steps <= 0) continue
    const pos = state.germanPositions.get(ship.def.id)
    if (pos && hexEquals(pos, coord)) result.push(ship)
  }
  return result
}

/** 获取指定格的英军舰船 */
export function getBritishShipsAt(state: GameState, coord: HexCoord): ShipState[] {
  const result: ShipState[] = []
  for (const ship of state.britishShips) {
    if (ship.steps <= 0) continue
    const pos = state.britishPositions.get(ship.def.id)
    if (pos && hexEquals(pos, coord)) result.push(ship)
  }
  return result
}
