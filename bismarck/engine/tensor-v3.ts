/** RL tensor v3 exporter.
 *
 * Final-standard files for staged RL experiments:
 *   state.bin  [73,128,8,6] float32 + 20 byte BSMB header
 *   mask.bin   [73,16,128] uint8
 *   action.bin [73,16,8] uint8/int8-compatible fixed records
 *   target.bin [73,10] float32 + 12 byte header
 *   result.json metadata
 */

import * as fs from 'fs'
import * as path from 'path'
import type { GameState, HexCoord, ShipState } from './types'
import type { GameAction, GameObservation } from './env'
import {
  BREST_HEX,
  GERMAN_START_HEXES,
  getAllLabels,
  hexDistance,
  hexToLabel,
  isSeaRoute,
  labelToHex,
} from './map'
import { getShipSpeed } from './movement'

export const RL_TENSOR_V3 = {
  schema: 'rl_tensor_v3',
  T: 73,
  C: 128,
  H: 8,
  W: 6,
  UNIT_SLOTS: 16,
  ACTIONS: 128,
  TARGET_FIELDS: 10,
  MAGIC_STATE: 0x42534D42,
  MAGIC_TARGET: 0x524C5433, // "RLT3"
} as const

const SHIP_IDS: Record<string, number> = {
  'bismarck': 1,
  'prinz-eugen': 2,
  'hood': 10,
  'prince-of-wales': 11,
  'ark-royal': 12,
  'king-george-v': 13,
  'rodney': 14,
  'renown': 15,
  'repulse': 16,
  'victorious': 17,
  'ramillies': 18,
  'norfolk': 19,
  'suffolk': 20,
  'dummy-1': 30,
  'dummy-2': 31,
  'dummy-3': 32,
  'dummy-4': 33,
}

const PHASE_IDS: Record<string, number> = {
  'setup-german': 0,
  'setup-british': 1,
  'german-move': 2,
  'british-move': 3,
  'british-search': 4,
  combat: 5,
  'transport-attack': 6,
  'game-over': 7,
}

const ACTION_TYPE_IDS: Record<string, number> = {
  move: 0,
  'finish-phase': 1,
  'air-search': 2,
  combat: 3,
  transport: 4,
}

const SEA_ROUTES = ['D2', 'D3', 'C4', 'C3', 'D5', 'E1', 'F4', 'E4', 'E5']
const RUSH_PATH = ['D8', 'E7', 'F6', 'D7', 'C7', 'C6', 'D6', 'F7']

export interface RlTensorV3Step {
  timeIndex?: number
  slotIndex?: number
  observation: GameObservation
  action: GameAction
  rewardGerman: number
  rewardBritish: number
  nextEnemyTargetPos: number
}

export interface RlTensorV3Result {
  game_id: string
  winner: string | null
  victory_reason: string
  vp_german: number
  vp_british: number
  turns: number
  total_steps: number
  recorded_steps: number
  action_records?: number
  truncated: boolean
  seed: number
  policy_source_german: string
  policy_source_british: string
  tensor_schema: string
  state_shape: [number, number, number, number]
  mask_shape: [number, number, number]
  action_shape: [number, number, number]
  target_shape: [number, number]
}

function labelIndex(label: string | null | undefined): number {
  if (!label || label.length < 2) return -1
  const q = label.charCodeAt(0) - 65
  const r = parseInt(label.slice(1)) - 1
  if (q < 0 || q >= RL_TENSOR_V3.W || r < 0 || r >= RL_TENSOR_V3.H) return -1
  return r * RL_TENSOR_V3.W + q
}

function coordIndex(coord: HexCoord | undefined): number {
  return coord ? labelIndex(hexToLabel(coord)) : -1
}

function rowCol(label: string | null | undefined): [number, number] | null {
  const idx = labelIndex(label)
  if (idx < 0) return null
  return [Math.floor(idx / RL_TENSOR_V3.W), idx % RL_TENSOR_V3.W]
}

function set(slice: Float32Array, ch: number, row: number, col: number, val: number) {
  if (ch < 0 || ch >= RL_TENSOR_V3.C) return
  if (row < 0 || row >= RL_TENSOR_V3.H || col < 0 || col >= RL_TENSOR_V3.W) return
  slice[ch * RL_TENSOR_V3.H * RL_TENSOR_V3.W + row * RL_TENSOR_V3.W + col] = val
}

function fill(slice: Float32Array, ch: number, val: number) {
  const off = ch * RL_TENSOR_V3.H * RL_TENSOR_V3.W
  for (let i = 0; i < RL_TENSOR_V3.H * RL_TENSOR_V3.W; i++) slice[off + i] = val
}

function add(slice: Float32Array, ch: number, label: string | null | undefined, val: number) {
  const rc = rowCol(label)
  if (rc) set(slice, ch, rc[0], rc[1], val)
}

function normalizeDist(dist: number) {
  if (!Number.isFinite(dist)) return 1
  return Math.min(1, dist / 8)
}

function minDistToLabels(from: HexCoord | undefined, labels: string[]) {
  if (!from) return Infinity
  let best = Infinity
  for (const label of labels) {
    const to = labelToHex(label)
    if (to) best = Math.min(best, hexDistance(from, to))
  }
  return best
}

function viewerCanSeeBritishIdentity(state: GameState, ship: ShipState, viewer: 'german' | 'british') {
  return viewer === 'british' || ship.revealed
}

function viewerCanSeeGermanIdentity(state: GameState, viewer: 'german' | 'british') {
  return viewer === 'german' || state.germanPositionPublic || state.combatPending
}

function fillShip(slice: Float32Array, baseCh: number, pos: HexCoord | undefined, ship: ShipState, mode: 'locked' | 'speed') {
  const label = pos ? hexToLabel(pos) : null
  const rc = rowCol(label)
  if (!rc || ship.steps <= 0) return
  set(slice, baseCh, rc[0], rc[1], 1)
  set(slice, baseCh + 1, rc[0], rc[1], ship.steps / Math.max(1, ship.def.maxSteps))
  set(slice, baseCh + 2, rc[0], rc[1], ship.def.attack / 4)
  set(slice, baseCh + 3, rc[0], rc[1], mode === 'speed' ? getShipSpeed(ship) / 3 : 0)
}

function getCurrentShip(state: GameState, actions: GameAction[]): ShipState | undefined {
  const shipId = actions.find(a => a.params?.shipId)?.params?.shipId
  if (!shipId) return undefined
  return [...state.germanShips, ...state.britishShips].find(s => s.def.id === shipId)
}

export function actionToIndex(action: GameAction): number {
  if (action.type === 'move') return labelIndex(action.params?.targetLabel)
  if (action.type === 'air-search') {
    const idx = labelIndex(action.params?.targetLabel)
    return idx >= 0 ? 48 + idx : -1
  }
  if (action.type === 'finish-phase') return 96
  if (action.type === 'combat') return 97
  if (action.type === 'transport') return 98
  return -1
}

export function buildActionMask(actions: GameAction[]): Uint8Array {
  const mask = new Uint8Array(RL_TENSOR_V3.ACTIONS)
  for (const action of actions) {
    const idx = actionToIndex(action)
    if (idx >= 0 && idx < mask.length) mask[idx] = 1
  }
  return mask
}

export function encodeObservationV3(observation: GameObservation): Float32Array {
  const state = observation.raw
  const viewer = observation.activePlayer
  const slice = new Float32Array(RL_TENSOR_V3.C * RL_TENSOR_V3.H * RL_TENSOR_V3.W)

  // 0-15: public map/global.
  for (const label of getAllLabels()) add(slice, 0, label, 1)
  for (const label of SEA_ROUTES) add(slice, 1, label, 1)
  add(slice, 2, BREST_HEX, 1)
  for (const label of GERMAN_START_HEXES) add(slice, 3, label, 1)
  fill(slice, 4, state.phase === 'german-move' ? 1 : 0)
  fill(slice, 5, state.phase === 'british-move' ? 1 : 0)
  fill(slice, 6, state.phase === 'british-search' ? 1 : 0)
  fill(slice, 7, state.phase === 'combat' || state.phase === 'transport-attack' ? 1 : 0)
  fill(slice, 8, state.turn / 18)
  fill(slice, 9, state.vp.british / 6)
  fill(slice, 10, state.vp.german / 6)
  fill(slice, 11, Math.max(0, 18 - state.turn) / 18)
  fill(slice, 12, viewer === 'german' ? 1 : 0)
  fill(slice, 13, state.bismarckFound ? 1 : 0)
  fill(slice, 14, state.germanPositionPublic ? 1 : 0)
  fill(slice, 15, 1)

  // 16-47: British state, identity masked for German unless revealed.
  const fillNamedBritish = (base: number, id: string) => {
    const ship = state.britishShips.find(s => s.def.id === id)
    if (!ship || !viewerCanSeeBritishIdentity(state, ship, viewer)) return
    fillShip(slice, base, state.britishPositions.get(id), ship, 'locked')
    const pos = state.britishPositions.get(id)
    if (pos && !state.bismarckFound && !ship.def.isDummy && id !== 'hood' && id !== 'prince-of-wales') {
      const label = hexToLabel(pos); const rc = rowCol(label)
      if (rc) set(slice, base + 3, rc[0], rc[1], 1)
    }
  }
  fillNamedBritish(16, 'hood')
  fillNamedBritish(20, 'prince-of-wales')
  fillNamedBritish(24, 'ark-royal')

  for (const ship of state.britishShips) {
    if (ship.steps <= 0) continue
    const pos = state.britishPositions.get(ship.def.id)
    const label = pos ? hexToLabel(pos) : null
    const rc = rowCol(label)
    if (!rc) continue

    add(slice, 40, label, 1)
    set(slice, 41, rc[0], rc[1], Math.min(1, slice[41 * 48 + rc[0] * 6 + rc[1]] + 1 / 15))

    if (viewerCanSeeBritishIdentity(state, ship, viewer)) {
      if (ship.revealed && !ship.def.isDummy) set(slice, 42, rc[0], rc[1], 1)
      if (ship.revealed && ship.def.isDummy) set(slice, 43, rc[0], rc[1], 1)
      set(slice, 44, rc[0], rc[1], Math.min(1, slice[44 * 48 + rc[0] * 6 + rc[1]] + ship.def.attack / 12))
      set(slice, 45, rc[0], rc[1], Math.min(1, slice[45 * 48 + rc[0] * 6 + rc[1]] + ship.steps / 16))
      if (!state.bismarckFound && !ship.def.isDummy && ship.def.id !== 'hood' && ship.def.id !== 'prince-of-wales') {
        set(slice, 46, rc[0], rc[1], Math.min(1, slice[46 * 48 + rc[0] * 6 + rc[1]] + 1 / 15))
      }

      if (!['hood', 'prince-of-wales', 'ark-royal'].includes(ship.def.id) && !ship.def.isDummy) {
        const base = ship.def.maxSteps === 1 ? 32 : 28
        set(slice, base, rc[0], rc[1], Math.min(1, slice[base * 48 + rc[0] * 6 + rc[1]] + 1 / 5))
        set(slice, base + 1, rc[0], rc[1], Math.max(slice[(base + 1) * 48 + rc[0] * 6 + rc[1]], ship.steps / ship.def.maxSteps))
        set(slice, base + 2, rc[0], rc[1], Math.min(1, slice[(base + 2) * 48 + rc[0] * 6 + rc[1]] + ship.def.attack / 12))
      }
      if (ship.def.isDummy) {
        set(slice, 36, rc[0], rc[1], Math.min(1, slice[36 * 48 + rc[0] * 6 + rc[1]] + 0.25))
        set(slice, 37, rc[0], rc[1], 1)
        set(slice, 38, rc[0], rc[1], 3 / 3)
        if (ship.revealed) set(slice, 39, rc[0], rc[1], 1)
      }
    }
  }

  const arkPos = state.britishPositions.get('ark-royal')
  const arkRoyal = state.britishShips.find(s => s.def.id === 'ark-royal')
  if (arkPos && arkRoyal && arkRoyal.steps > 0 && viewerCanSeeBritishIdentity(state, arkRoyal, viewer)) {
    for (const label of getAllLabels()) {
      const coord = labelToHex(label)
      if (coord && hexDistance(arkPos, coord) === 1) add(slice, 47, label, 1)
    }
  }

  // 48-63: German state, hidden from British unless public/event-revealed.
  if (viewerCanSeeGermanIdentity(state, viewer)) {
    for (const ship of state.germanShips) {
      if (ship.steps <= 0) continue
      const pos = state.germanPositions.get(ship.def.id)
      const label = pos ? hexToLabel(pos) : null
      const base = ship.def.id === 'bismarck' ? 48 : 52
      fillShip(slice, base, pos, ship, 'speed')
      add(slice, 56, label, 1)
      const rc = rowCol(label)
      if (rc) {
        set(slice, 57, rc[0], rc[1], Math.min(1, slice[57 * 48 + rc[0] * 6 + rc[1]] + 0.5))
        set(slice, 58, rc[0], rc[1], Math.min(1, slice[58 * 48 + rc[0] * 6 + rc[1]] + ship.def.attack / 8))
        set(slice, 59, rc[0], rc[1], Math.min(1, slice[59 * 48 + rc[0] * 6 + rc[1]] + ship.steps / 6))
      }
    }
  }
  for (const label of GERMAN_START_HEXES) add(slice, 60, label, 1)
  add(slice, 61, state.lastSightingHex, state.lastSightingHex ? 1 : 0)
  add(slice, 62, state.transportRevealedHex, state.transportRevealedHex ? 1 : 0)
  if (state.lastSightingHex) {
    const last = labelToHex(state.lastSightingHex)
    const brest = labelToHex(BREST_HEX)
    if (last && brest && hexDistance(last, brest) <= 2 && state.vp.german > state.vp.british) add(slice, 63, BREST_HEX, 1)
  }

  // 64-79: events/history.
  if (state.bismarckFound && state.combatPending) {
    for (const ship of state.germanShips) {
      const pos = state.germanPositions.get(ship.def.id)
      if (pos) add(slice, 64, hexToLabel(pos), 1)
    }
  }
  if (state.combatPending && arkPos) {
    for (const ship of state.germanShips) {
      const gp = state.germanPositions.get(ship.def.id)
      if (gp && hexDistance(arkPos, gp) === 1) add(slice, 65, hexToLabel(gp), 1)
    }
  }
  add(slice, 66, state.transportRevealedHex, state.transportRevealedHex ? 1 : 0)
  for (const id of state.failedDummies) {
    const p = state.britishPositions.get(id)
    if (p) add(slice, 67, hexToLabel(p), 1)
  }
  if (state.phase === 'british-search' && !state.combatPending) {
    for (const ship of state.britishShips) {
      const pos = state.britishPositions.get(ship.def.id)
      if (ship.steps > 0 && pos) add(slice, 68, hexToLabel(pos), 1)
    }
  }
  if (state.lastSightingHex) {
    const age = Math.max(0, state.turn - state.lastSightingTurn)
    add(slice, 69 + Math.min(4, age), state.lastSightingHex, Math.max(0.2, 1 - age * 0.2))
  }
  if (state.transportRevealedHex) add(slice, 70, state.transportRevealedHex, 1)
  if (state.combatPending) {
    for (const ship of state.germanShips) {
      const pos = state.germanPositions.get(ship.def.id)
      if (pos) add(slice, 79, hexToLabel(pos), 1)
    }
  }

  // 80-95: current decision context.
  const currentShip = getCurrentShip(state, observation.actions)
  const currentPos = currentShip
    ? (currentShip.def.side === 'german' ? state.germanPositions : state.britishPositions).get(currentShip.def.id)
    : undefined
  if (currentShip) {
    const label = currentPos ? hexToLabel(currentPos) : null
    add(slice, 80, label, 1)
    const rc = rowCol(label)
    if (rc) {
      set(slice, 81, rc[0], rc[1], currentShip.steps / Math.max(1, currentShip.def.maxSteps))
      set(slice, 82, rc[0], rc[1], currentShip.def.attack / 4)
      set(slice, 83, rc[0], rc[1], getShipSpeed(currentShip) / 3)
      if (currentShip.def.id === 'bismarck') set(slice, 84, rc[0], rc[1], 1)
      if (currentShip.def.id === 'prinz-eugen') set(slice, 85, rc[0], rc[1], 1)
      if (!currentShip.def.isDummy && currentShip.def.maxSteps >= 2) set(slice, 86, rc[0], rc[1], 1)
      if (currentShip.def.isCarrier) set(slice, 87, rc[0], rc[1], 1)
      if (currentShip.def.isDummy) set(slice, 88, rc[0], rc[1], 1)
      if (state.movedThisTurn.has(currentShip.def.id)) set(slice, 94, rc[0], rc[1], 1)
    }
  }
  for (const action of observation.actions) {
    if (action.type === 'move') add(slice, 89, action.params?.targetLabel, 1)
    if (action.type === 'air-search') add(slice, 90, action.params?.targetLabel, 1)
    if (action.type === 'transport' && action.params?.shipId) {
      const pos = state.germanPositions.get(action.params.shipId)
      if (pos) add(slice, 91, hexToLabel(pos), 1)
    }
    if (action.type === 'finish-phase') fill(slice, 92, 1)
    if (action.type === 'combat') fill(slice, 93, 1)
  }
  fill(slice, 95, observation.actions.length > 0 ? 1 : 0)

  // 96-111: reusable rule priors.
  const brest = labelToHex(BREST_HEX)
  const lastGermanClue = state.lastSightingHex ? labelToHex(state.lastSightingHex) : undefined
  for (const label of getAllLabels()) {
    const coord = labelToHex(label)
    if (!coord) continue
    const rc = rowCol(label)!
    set(slice, 96, rc[0], rc[1], 1 - normalizeDist(brest ? hexDistance(coord, brest) : Infinity))
    set(slice, 97, rc[0], rc[1], 1 - normalizeDist(minDistToLabels(coord, SEA_ROUTES)))
    set(slice, 98, rc[0], rc[1], 1 - normalizeDist(minDistToBritishAnon(state, coord)))
    set(slice, 99, rc[0], rc[1], 1 - normalizeDist(lastGermanClue ? hexDistance(coord, lastGermanClue) : Infinity))
    set(slice, 100, rc[0], rc[1], britishDensity(state, coord))
    set(slice, 101, rc[0], rc[1], possibleGermanField(state, coord))
    set(slice, 102, rc[0], rc[1], RUSH_PATH.includes(label) ? 1 : 0)
    set(slice, 103, rc[0], rc[1], SEA_ROUTES.includes(label) ? 1 : 0)
    set(slice, 104, rc[0], rc[1], brest && hexDistance(coord, brest) <= 1 ? 1 : 0)
    set(slice, 105, rc[0], rc[1], SEA_ROUTES.includes(label) ? Math.max(0, 1 - state.vp.german / 6) : 0)
    set(slice, 106, rc[0], rc[1], localCombatExpectation(state, coord, viewer))
    set(slice, 107, rc[0], rc[1], localCombatRisk(state, coord))
    set(slice, 108, rc[0], rc[1], exposureRisk(state, coord))
    set(slice, 109, rc[0], rc[1], crowdPenalty(state, coord, viewer))
    set(slice, 110, rc[0], rc[1], explorationValue(state, coord))
  }

  // 112-127: reserved for model predictions/new architecture.
  return slice
}

function minDistToBritishAnon(state: GameState, coord: HexCoord) {
  let best = Infinity
  for (const ship of state.britishShips) {
    if (ship.steps <= 0) continue
    const pos = state.britishPositions.get(ship.def.id)
    if (pos) best = Math.min(best, hexDistance(coord, pos))
  }
  return best
}

function britishDensity(state: GameState, coord: HexCoord) {
  let n = 0
  for (const ship of state.britishShips) {
    const pos = state.britishPositions.get(ship.def.id)
    if (ship.steps > 0 && pos && hexDistance(coord, pos) <= 1) n++
  }
  return Math.min(1, n / 6)
}

function possibleGermanField(state: GameState, coord: HexCoord) {
  const center = state.lastSightingHex ? labelToHex(state.lastSightingHex) : null
  if (center) {
    const radius = Math.max(1, (state.turn - state.lastSightingTurn + 1) * 2)
    return hexDistance(center, coord) <= radius ? 1 : 0
  }
  return GERMAN_START_HEXES.some(label => {
    const start = labelToHex(label)
    return start && hexDistance(start, coord) <= Math.min(8, state.turn * 2)
  }) ? 1 : 0
}

function localCombatExpectation(state: GameState, coord: HexCoord, viewer: 'german' | 'british') {
  let britAtk = 0, gerAtk = 0
  for (const ship of state.britishShips) {
    const pos = state.britishPositions.get(ship.def.id)
    if (ship.steps > 0 && pos && hexDistance(coord, pos) <= 1 && !ship.def.isDummy) britAtk += ship.def.attack
  }
  for (const ship of state.germanShips) {
    const pos = state.germanPositions.get(ship.def.id)
    if (ship.steps > 0 && pos && hexDistance(coord, pos) <= 1) gerAtk += ship.def.attack
  }
  const raw = viewer === 'german' ? gerAtk - britAtk : britAtk - gerAtk
  return Math.max(0, Math.min(1, (raw + 8) / 16))
}

function localCombatRisk(state: GameState, coord: HexCoord) {
  let threat = 0
  for (const ship of state.britishShips) {
    const pos = state.britishPositions.get(ship.def.id)
    if (ship.steps > 0 && pos && hexDistance(coord, pos) <= 1 && !ship.def.isDummy) threat += ship.def.attack
  }
  return Math.min(1, threat / 12)
}

function exposureRisk(state: GameState, coord: HexCoord) {
  return britishDensity(state, coord)
}

function crowdPenalty(state: GameState, coord: HexCoord, viewer: 'german' | 'british') {
  const ships = viewer === 'german' ? state.germanShips : state.britishShips
  const positions = viewer === 'german' ? state.germanPositions : state.britishPositions
  let n = 0
  for (const ship of ships) {
    const pos = positions.get(ship.def.id)
    if (ship.steps > 0 && pos && hexDistance(coord, pos) === 0) n++
  }
  return Math.min(1, Math.max(0, n - 1) / 4)
}

function explorationValue(state: GameState, coord: HexCoord) {
  if (!state.lastSightingHex) return 0.5
  const last = labelToHex(state.lastSightingHex)
  return last ? normalizeDist(hexDistance(coord, last)) : 0.5
}

export function encodeActionRecord(stepIndex: number, observation: GameObservation, action: GameAction): Uint8Array {
  const out = new Uint8Array(8)
  out[0] = stepIndex & 0xff
  out[1] = (PHASE_IDS[observation.raw.phase] ?? 7) & 0xff
  out[2] = observation.activePlayer === 'german' ? 0 : 1
  out[3] = (SHIP_IDS[action.params?.shipId ?? ''] ?? 0) & 0xff
  out[4] = Math.max(0, actionToIndex(action)) & 0xff
  const target = action.params?.targetLabel ? labelIndex(action.params.targetLabel) : -1
  out[5] = target < 0 ? 255 : target & 0xff
  out[6] = (ACTION_TYPE_IDS[action.type] ?? 0) & 0xff
  out[7] = 0
  return out
}

export function truthPositions(state: GameState) {
  return {
    bismarck: coordIndex(state.germanPositions.get('bismarck')),
    eugen: coordIndex(state.germanPositions.get('prinz-eugen')),
  }
}

export function writeRlTensorV3Game(dir: string, result: RlTensorV3Result, steps: RlTensorV3Step[]) {
  const gameDir = path.join(dir, result.game_id)
  fs.mkdirSync(gameDir, { recursive: true })

  const stateBuf = new Float32Array(RL_TENSOR_V3.T * RL_TENSOR_V3.C * RL_TENSOR_V3.H * RL_TENSOR_V3.W)
  const maskBuf = new Uint8Array(RL_TENSOR_V3.T * RL_TENSOR_V3.UNIT_SLOTS * RL_TENSOR_V3.ACTIONS)
  const actionBuf = new Uint8Array(RL_TENSOR_V3.T * RL_TENSOR_V3.UNIT_SLOTS * 8)
  const targetBuf = new Float32Array(RL_TENSOR_V3.T * RL_TENSOR_V3.TARGET_FIELDS)

  const orderedSteps = [...steps]
    .filter(step => (step.timeIndex ?? 0) >= 0 && (step.timeIndex ?? 0) < RL_TENSOR_V3.T)
    .filter(step => (step.slotIndex ?? 0) >= 0 && (step.slotIndex ?? 0) < RL_TENSOR_V3.UNIT_SLOTS)
    .sort((a, b) => (a.timeIndex ?? 0) - (b.timeIndex ?? 0) || (a.slotIndex ?? 0) - (b.slotIndex ?? 0))

  const rewardG = new Array(RL_TENSOR_V3.T).fill(0)
  const rewardB = new Array(RL_TENSOR_V3.T).fill(0)
  const stateWritten = new Array(RL_TENSOR_V3.T).fill(false)
  for (const step of orderedSteps) {
    const t = step.timeIndex ?? 0
    rewardG[t] += step.rewardGerman
    rewardB[t] += step.rewardBritish
  }

  const retG = new Array(RL_TENSOR_V3.T).fill(0)
  const retB = new Array(RL_TENSOR_V3.T).fill(0)
  for (let t = RL_TENSOR_V3.T - 1; t >= 0; t--) {
    retG[t] = rewardG[t] + 0.995 * (t + 1 < RL_TENSOR_V3.T ? retG[t + 1] : 0)
    retB[t] = rewardB[t] + 0.995 * (t + 1 < RL_TENSOR_V3.T ? retB[t + 1] : 0)
  }

  for (const step of orderedSteps) {
    const t = step.timeIndex ?? 0
    const slot = step.slotIndex ?? 0
    if (!stateWritten[t]) {
      stateBuf.set(encodeObservationV3(step.observation), t * RL_TENSOR_V3.C * RL_TENSOR_V3.H * RL_TENSOR_V3.W)
      stateWritten[t] = true
    }
    maskBuf.set(
      buildActionMask(step.observation.actions),
      (t * RL_TENSOR_V3.UNIT_SLOTS + slot) * RL_TENSOR_V3.ACTIONS
    )
    actionBuf.set(encodeActionRecord(t, step.observation, step.action), (t * RL_TENSOR_V3.UNIT_SLOTS + slot) * 8)
  }

  for (const step of orderedSteps) {
    const t = step.timeIndex ?? 0
    const off = t * RL_TENSOR_V3.TARGET_FIELDS
    if (targetBuf[off + 9] > 0.5) continue
    const truth = truthPositions(step.observation.raw)
    targetBuf[off] = truth.bismarck
    targetBuf[off + 1] = truth.eugen
    targetBuf[off + 2] = step.nextEnemyTargetPos
    targetBuf[off + 3] = rewardG[t]
    targetBuf[off + 4] = rewardB[t]
    targetBuf[off + 5] = retG[t]
    targetBuf[off + 6] = retB[t]
    targetBuf[off + 7] = result.winner === 'german' ? 0 : result.winner === 'british' ? 1 : -1
    targetBuf[off + 8] = result.vp_german - result.vp_british
    targetBuf[off + 9] = 1
  }

  writeStateBin(path.join(gameDir, 'state.bin'), stateBuf)
  fs.writeFileSync(path.join(gameDir, 'mask.bin'), maskBuf)
  fs.writeFileSync(path.join(gameDir, 'action.bin'), actionBuf)
  writeTargetBin(path.join(gameDir, 'target.bin'), targetBuf)
  fs.writeFileSync(path.join(gameDir, 'result.json'), JSON.stringify(result, null, 2))
}

function writeStateBin(file: string, data: Float32Array) {
  const header = new ArrayBuffer(20)
  const dv = new DataView(header)
  dv.setUint32(0, RL_TENSOR_V3.MAGIC_STATE, true)
  dv.setInt32(4, RL_TENSOR_V3.T, true)
  dv.setInt32(8, RL_TENSOR_V3.C, true)
  dv.setInt32(12, RL_TENSOR_V3.H, true)
  dv.setInt32(16, RL_TENSOR_V3.W, true)
  const out = new Uint8Array(20 + data.byteLength)
  out.set(new Uint8Array(header), 0)
  out.set(new Uint8Array(data.buffer), 20)
  fs.writeFileSync(file, out)
}

function writeTargetBin(file: string, data: Float32Array) {
  const header = new ArrayBuffer(12)
  const dv = new DataView(header)
  dv.setUint32(0, RL_TENSOR_V3.MAGIC_TARGET, true)
  dv.setInt32(4, RL_TENSOR_V3.T, true)
  dv.setInt32(8, RL_TENSOR_V3.TARGET_FIELDS, true)
  const out = new Uint8Array(12 + data.byteLength)
  out.set(new Uint8Array(header), 0)
  out.set(new Uint8Array(data.buffer), 12)
  fs.writeFileSync(file, out)
}
