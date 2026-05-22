/** 张量日志记录器 —— 与 C++ tensor_logger.hpp 二进制兼容 */

import type { GameState } from './types'
import { hexToLabel, hexDistance, getAllLabels } from './map'
import { getShipSpeed } from './movement'
import { GERMAN_START_HEXES } from './map'
import * as fs from 'fs'
import * as path from 'path'

const T = 73, C = 128, H = 8, W = 6
const SLICE = C * H * W
const MAGIC = 0x42534D42

function labelToRowCol(label: string): [number, number] | null {
  if (!label || label === '?') return null
  const col = label.charCodeAt(0) - 65
  const row = parseInt(label.slice(1)) - 1
  if (col < 0 || col >= W || row < 0 || row >= H) return null
  return [row, col]
}

// ========== 跨步状态追踪 ==========
interface TrackerState {
  bismarckTrail: [number, number][]   // [row, col]，新→旧
  eugenTrail: [number, number][]
  prevDummyCount: number
}

function createTracker(): TrackerState {
  return { bismarckTrail: [], eugenTrail: [], prevDummyCount: 0 }
}

// ========== 填充单步切片 ==========
export function fillStateSlice(state: GameState, tracker?: TrackerState): Float32Array {
  const slice = new Float32Array(SLICE)
  const set = (ch: number, row: number, col: number, val: number) => {
    if (row >= 0 && row < H && col >= 0 && col < W)
      slice[ch * H * W + row * W + col] = val
  }
  const fillCh = (ch: number, val: number) => {
    for (let i = 0; i < H * W; i++) slice[ch * H * W + i] = val
  }

  // === Block 1: 静态地理与全局 (Ch 0-15) ===
  for (const label of getAllLabels()) {
    const rc = labelToRowCol(label); if (rc) set(0, rc[0], rc[1], 1)
  }
  for (const label of ['D2','D3','C4','C3','D5','E1','E4','E5']) {
    const rc = labelToRowCol(label); if (rc) set(1, rc[0], rc[1], 1)
  }
  { const rc = labelToRowCol('F7'); if (rc) set(2, rc[0], rc[1], 1) }
  for (const label of GERMAN_START_HEXES) {
    const rc = labelToRowCol(label); if (rc) set(3, rc[0], rc[1], 1)
  }
  fillCh(4, state.phase === 'german-move' ? 1 : 0)
  fillCh(5, state.phase === 'british-move' ? 1 : 0)
  fillCh(6, state.phase === 'british-search' ? 1 : 0)
  fillCh(7, (state.phase === 'combat' || state.phase === 'transport-attack') ? 1 : 0)
  fillCh(8, state.turn / 18)
  fillCh(9, state.vp.british / 6)
  fillCh(10, state.vp.german / 6)

  // === Block 2: 英军实体 (Ch 16-47) ===
  const fillBrit = (baseCh: number, id: string) => {
    const pos = state.britishPositions.get(id); if (!pos) return
    const label = hexToLabel(pos); if (!label) return
    const rc = labelToRowCol(label); if (!rc) return
    const ship = state.britishShips.find(s => s.def.id === id)
    if (!ship || ship.steps <= 0) return
    set(baseCh,   rc[0], rc[1], 1)
    set(baseCh+1, rc[0], rc[1], ship.steps / ship.def.maxSteps)
    set(baseCh+2, rc[0], rc[1], ship.def.attack / 4)
    const locked = (!state.bismarckFound && !ship.def.isDummy
      && id !== 'hood' && id !== 'prince-of-wales') ? 1 : 0
    set(baseCh+3, rc[0], rc[1], locked)
  }
  fillBrit(16, 'hood'); fillBrit(20, 'prince-of-wales'); fillBrit(24, 'ark-royal')

  // Ch28-31: 2Step舰聚合
  for (const sh of state.britishShips) {
    if (sh.steps <= 0 || sh.def.isDummy) continue
    if (['hood','prince-of-wales','ark-royal'].includes(sh.def.id)) continue
    if (sh.def.maxSteps !== 2) continue
    const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
    const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
    set(28, rc[0], rc[1], 1); set(29, rc[0], rc[1], sh.steps / 2)
    set(30, rc[0], rc[1], sh.def.attack / 4)
  }
  // Ch32-35: 1Step舰聚合
  for (const sh of state.britishShips) {
    if (sh.steps <= 0 || sh.def.isDummy) continue
    if (sh.def.maxSteps !== 1) continue
    const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
    const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
    set(32, rc[0], rc[1], 1); set(33, rc[0], rc[1], 1); set(34, rc[0], rc[1], sh.def.attack / 4)
  }
  // Ch36-39: 伪装算子
  for (const sh of state.britishShips) {
    if (sh.steps <= 0 || !sh.def.isDummy) continue
    const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
    const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
    set(36, rc[0], rc[1], 1); set(37, rc[0], rc[1], 1)
    set(38, rc[0], rc[1], 0); set(39, rc[0], rc[1], 3)
  }
  // Ch40: 英军匿名位置
  for (const sh of state.britishShips) {
    if (sh.steps <= 0) continue
    const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
    const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
    set(40, rc[0], rc[1], 1)
  }

  // === Block 3: 德军实体 (Ch 48-63) ===
  const fillGer = (baseCh: number, id: string) => {
    const pos = state.germanPositions.get(id); if (!pos) return
    const label = hexToLabel(pos); if (!label) return
    const rc = labelToRowCol(label); if (!rc) return
    const ship = state.germanShips.find(s => s.def.id === id)
    if (!ship || ship.steps <= 0) return
    const spd = getShipSpeed(ship)
    set(baseCh, rc[0], rc[1], 1)
    set(baseCh+1, rc[0], rc[1], ship.steps / ship.def.maxSteps)
    set(baseCh+2, rc[0], rc[1], ship.def.attack / 4)
    set(baseCh+3, rc[0], rc[1], spd / 3)
  }
  fillGer(48, 'bismarck'); fillGer(52, 'prinz-eugen')

  // === Block 4: 战场事件 (Ch 64-95) ===
  // Ch64: 同格索敌暴露
  if (state.bismarckFound && state.combatPending) {
    for (const gShip of state.germanShips) {
      if (gShip.steps <= 0) continue
      const pos = state.germanPositions.get(gShip.def.id); if (!pos) continue
      const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
      set(64, rc[0], rc[1], 1)
    }
  }
  // Ch65: 航空侦察暴露 (Ark Royal 邻格命中)
  if (state.bismarckFound && state.combatPending) {
    const arkRoyal = state.britishShips.find(s => s.def.id === 'ark-royal' && s.steps > 0)
    if (arkRoyal) {
      const arPos = state.britishPositions.get('ark-royal')
      if (arPos) {
        for (const gShip of state.germanShips) {
          if (gShip.steps <= 0) continue
          const gPos = state.germanPositions.get(gShip.def.id)
          if (gPos && hexDistance(arPos, gPos) === 1) {
            const rc = labelToRowCol(hexToLabel(gPos)!); if (!rc) continue
            set(65, rc[0], rc[1], 1)
          }
        }
      }
    }
  }
  // Ch66: 运输信号泄露
  if (state.transportRevealedHex) {
    const rc = labelToRowCol(state.transportRevealedHex)
    if (rc) set(66, rc[0], rc[1], 1)
  }
  // Ch67: 伪装移除 — 检测存活数变化
  if (tracker) {
    const curDummies = state.britishShips.filter(s => s.def.isDummy && s.steps > 0).length
    if (curDummies < tracker.prevDummyCount) {
      for (const sh of state.britishShips) {
        if (!sh.def.isDummy || sh.steps > 0) continue
        if (!state.britishPositions.has(sh.def.id)) set(67, 0, 0, 1) // 标记有移除
      }
    }
    tracker.prevDummyCount = curDummies
  }
  // Ch68: 索敌未发现区域
  if (state.phase === 'british-search' && !state.bismarckFound && !state.combatPending) {
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
      set(68, rc[0], rc[1], 1)
    }
  }
  // Ch69-79: 德军轨迹衰减
  if (tracker) {
    for (const gShip of state.germanShips) {
      if (gShip.steps <= 0) continue
      const pos = state.germanPositions.get(gShip.def.id); if (!pos) continue
      const rc = labelToRowCol(hexToLabel(pos)!); if (!rc) continue
      if (gShip.def.id === 'bismarck') {
        tracker.bismarckTrail.unshift([rc[0], rc[1]])
        if (tracker.bismarckTrail.length > 10) tracker.bismarckTrail.pop()
      } else if (gShip.def.id === 'prinz-eugen') {
        tracker.eugenTrail.unshift([rc[0], rc[1]])
        if (tracker.eugenTrail.length > 10) tracker.eugenTrail.pop()
      }
    }
    const applyTrail = (trail: [number,number][], offset: number) => {
      for (let i = 0; i < trail.length && i < 10; i++) {
        const [r, c] = trail[i]
        const decay = 1 - i * 0.1
        const cur = slice[(69 + offset + i) * H * W + r * W + c]
        set(69 + i, r, c, Math.max(cur, decay))
      }
    }
    applyTrail(tracker.bismarckTrail, 0)
    applyTrail(tracker.eugenTrail, 0)
  }

  return slice
}

// ========== 动作记录 ==========
export interface ActionRecord {
  step_index: number; phase: number; side: number
  action_type: number; ship_id: number
  target_q: number; target_r: number
}

const SHIP_IDS: Record<string, number> = {
  'bismarck':1,'prinz-eugen':2,'hood':10,'prince-of-wales':11,'ark-royal':12,
  'king-george-v':13,'rodney':14,'renown':15,'repulse':16,'victorious':17,
  'ramillies':18,'norfolk':19,'suffolk':20,
  'dummy-1':30,'dummy-2':31,'dummy-3':32,'dummy-4':33,
}

function encodeActionRecord(rec: ActionRecord): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeUInt8(rec.step_index, 0); buf.writeUInt8(rec.phase, 1)
  buf.writeUInt8(rec.side, 2); buf.writeUInt8(rec.action_type, 3)
  buf.writeInt8(rec.ship_id ?? 0, 4)
  buf.writeInt8(rec.target_q ?? -1, 5)
  buf.writeInt8(rec.target_r ?? -1, 6)
  buf.writeInt8(0, 7)
  return buf
}

// ========== 写入 API ==========
export interface GameLogResult {
  winner: string; vp_german: number; vp_british: number
  turns: number; total_steps: number; seed: number
  bismarck_sunk: boolean; brest_reached: boolean
}

export function writeGameLog(dir: string, gameId: string,
  stateBuf: Float32Array, actions: ActionRecord[], result: GameLogResult) {
  const gameDir = path.join(dir, gameId)
  fs.mkdirSync(gameDir, { recursive: true })

  const hdr = Buffer.alloc(20)
  hdr.writeUInt32LE(MAGIC, 0)
  hdr.writeInt32LE(T, 4); hdr.writeInt32LE(C, 8)
  hdr.writeInt32LE(H, 12); hdr.writeInt32LE(W, 16)
  fs.writeFileSync(path.join(gameDir, 'state.bin'),
    Buffer.concat([hdr, Buffer.from(stateBuf.buffer)]))

  fs.writeFileSync(path.join(gameDir, 'action.bin'),
    Buffer.concat(actions.map(encodeActionRecord)))

  fs.writeFileSync(path.join(gameDir, 'result.json'),
    JSON.stringify({ game_id: gameId, ...result }, null, 2))
}
