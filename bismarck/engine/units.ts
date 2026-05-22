import { ShipDef, ShipState } from './types'

// ========== 德军舰船 ==========

export const BISMARCK: ShipDef = {
  id: 'bismarck',
  name: '俾斯麦号',
  side: 'german',
  attack: 4,
  defense: 6,
  maxSteps: 4,
  speed: 2,
  isCarrier: false,
  isDummy: false,
}

export const PRINZ_EUGEN: ShipDef = {
  id: 'prinz-eugen',
  name: '欧根亲王号',
  side: 'german',
  attack: 2,
  defense: 5,
  maxSteps: 2,
  speed: 2,
  isCarrier: false,
  isDummy: false,
}

// ========== 英军舰船 ==========

export const HOOD: ShipDef = {
  id: 'hood',
  name: '胡德号',
  side: 'british',
  attack: 4,
  defense: 6,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const PRINCE_OF_WALES: ShipDef = {
  id: 'prince-of-wales',
  name: '威尔士亲王号',
  side: 'british',
  attack: 3,
  defense: 6,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const ARK_ROYAL: ShipDef = {
  id: 'ark-royal',
  name: '皇家方舟号',
  side: 'british',
  attack: 1,
  defense: 5,
  maxSteps: 2,
  speed: 3,
  isCarrier: true,
  isDummy: false,
}

export const KING_GEORGE_V: ShipDef = {
  id: 'king-george-v',
  name: '乔治五世号',
  side: 'british',
  attack: 3,
  defense: 6,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const RODNEY: ShipDef = {
  id: 'rodney',
  name: '罗德尼号',
  side: 'british',
  attack: 3,
  defense: 6,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const RENOWN: ShipDef = {
  id: 'renown',
  name: '声望号',
  side: 'british',
  attack: 2,
  defense: 5,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const REPULSE: ShipDef = {
  id: 'repulse',
  name: '反击号',
  side: 'british',
  attack: 2,
  defense: 5,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const VICTORIOUS: ShipDef = {
  id: 'victorious',
  name: '胜利号',
  side: 'british',
  attack: 1,
  defense: 5,
  maxSteps: 2,
  speed: 3,
  isCarrier: true,
  isDummy: false,
}

export const RAMILLIES: ShipDef = {
  id: 'ramillies',
  name: '拉米伊号',
  side: 'british',
  attack: 3,
  defense: 6,
  maxSteps: 2,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const NORFOLK: ShipDef = {
  id: 'norfolk',
  name: '诺福克号',
  side: 'british',
  attack: 2,
  defense: 5,
  maxSteps: 1,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

export const SUFFOLK: ShipDef = {
  id: 'suffolk',
  name: '萨福克号',
  side: 'british',
  attack: 2,
  defense: 5,
  maxSteps: 1,
  speed: 3,
  isCarrier: false,
  isDummy: false,
}

// ========== 伪装算子 ==========

const DUMMY_NAMES = ['回声号', '伊卡洛斯号', '爱斯基摩人号', '命运女神号']

function makeDummy(index: number): ShipDef {
  return {
    id: `dummy-${index}`,
    name: DUMMY_NAMES[index - 1] || `伪装算子 ${index}`,
    side: 'british',
    attack: 0,
    defense: 0,
    maxSteps: 1,
    speed: 3,
    isCarrier: false,
    isDummy: true,
  }
}

// ========== 舰船列表 ==========

export const ALL_GERMAN_SHIPS: ShipDef[] = [BISMARCK, PRINZ_EUGEN]

export const ALL_BRITISH_SHIPS: ShipDef[] = [
  HOOD,
  PRINCE_OF_WALES,
  ARK_ROYAL,
  KING_GEORGE_V,
  RODNEY,
  RENOWN,
  REPULSE,
  VICTORIOUS,
  RAMILLIES,
  NORFOLK,
  SUFFOLK,
]

export const DUMMY_COUNT = 4
export const ALL_BRITISH_DUMMIES: ShipDef[] = Array.from({ length: DUMMY_COUNT }, (_, i) => makeDummy(i + 1))

/** 全部英军算子 (真船 + 伪装) */
export const ALL_BRITISH_TOKENS: ShipDef[] = [...ALL_BRITISH_SHIPS, ...ALL_BRITISH_DUMMIES]

// ========== ShipState 工厂 ==========

export function createShipState(def: ShipDef): ShipState {
  return {
    def,
    steps: def.maxSteps,
    revealed: false,
    moveTarget: null,
  }
}

/** 英军舰船中可提前移动的 (5.1) */
const CAN_MOVE_BEFORE_DETECTION = new Set(['hood', 'prince-of-wales'])

export function canMoveBeforeDetection(ship: ShipDef): boolean {
  return ship.isDummy || CAN_MOVE_BEFORE_DETECTION.has(ship.id)
}
