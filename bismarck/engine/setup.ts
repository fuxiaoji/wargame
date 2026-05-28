import { GameState, ShipState } from './types'
import {
  ALL_GERMAN_SHIPS,
  ALL_BRITISH_TOKENS,
  createShipState,
} from './units'
import { Randomizer } from './random'

// ========== 英军固定初始位置 ==========
// 有名字的舰船在指定格，同一格可放多个算子
export const BRITISH_FIXED_POSITIONS: Record<string, string[]> = {
  'C6': ['king-george-v', 'repulse', 'victorious'],
  'D6': ['rodney'],
  'F4': ['renown', 'ark-royal'],
  'F1': ['ramillies'],
}
  
/** 获取所有固定位置的舰船 ID */
export function getFixedBritishShipIds(): Set<string> {
  const ids = new Set<string>()
  for (const ships of Object.values(BRITISH_FIXED_POSITIONS)) {
    for (const id of ships) ids.add(id)
  }
  return ids
}

// ========== 初始化 ==========

/** 初始化德军位置 (待玩家选择) */
export function createInitialGermanShips(): ShipState[] {
  return ALL_GERMAN_SHIPS.map(def => createShipState(def))
}

/** 初始化英军算子 */
export function createInitialBritishTokens(): ShipState[] {
  return ALL_BRITISH_TOKENS.map(def => createShipState(def))
}

/** 创建默认游戏初始状态 */
export function createGameState(_rng?: Randomizer): GameState {
  return {
    germanShips: createInitialGermanShips(),
    britishShips: createInitialBritishTokens(),

    germanPositions: new Map(),
    britishPositions: new Map(),

    movedThisTurn: new Set(),

    turn: 1,
    phase: 'setup-german',
    phaseStep: 0,

    vp: { german: 0, british: 0 },

    bismarckFound: false,
    combatPending: false,
    transportPending: false,

    germanPositionPublic: false,
    lastSightingHex: null,
    lastSightingTurn: 0,
    failedDummies: new Set(),
    transportRevealedHex: null,
    airSearchDone: false,

    gameOver: false,
    winner: null,
    victoryReason: '',
  }
}

/** 获取英军自由布置可选格 */
export function getBritishSetupLabels(): string[] {
  return ['E7', 'E6', 'E5', 'E3', 'E2', 'E1', 'D7', 'D5', 'D1', 'C7', 'C1', 'B6', 'F6', 'F5', 'F3', 'F2']
}
