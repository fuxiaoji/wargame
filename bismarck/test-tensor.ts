/** TS 张量日志测试 —— 跑一局输出二进制，用 Python 脚本验证可读 */
import { BismarckGame } from './engine/game'
import { fillStateSlice, writeGameLog, ActionRecord, GameLogResult } from './engine/tensor'
import { hexToLabel, labelToHex } from './engine/map'
import { GERMAN_START_HEXES } from './engine/map'
import * as fs from 'fs'

const OUT = '../deeplearn/data/ts_test'
fs.mkdirSync(OUT, { recursive: true })

const game = new BismarckGame()
const COL = ['A','B','C','D','E','F']
const T = 73, SLICE = 128 * 8 * 6

const PHASE_MAP: Record<string, number> = {
  'setup-german': 0, 'setup-british': 1, 'german-move': 2, 'british-move': 3,
  'british-search': 4, 'combat': 5, 'transport-attack': 6, 'game-over': 7,
}

const stateBuf = new Float32Array(T * SLICE)
const actions: ActionRecord[] = []
let stepIdx = 0

function labelToRC(label: string): [number, number] {
  return [label.charCodeAt(0) - 65, parseInt(label.slice(1)) - 1]
}

// 简单随机策略
while (!game.state.gameOver && stepIdx < T) {
  // 填当前切片
  const slice = fillStateSlice(game.state)
  stateBuf.set(slice, stepIdx * SLICE)

  const player = game.getActivePlayer()
  const s = game.state
  let actionType = 0, shipId = 0, tq = -1, tr = -1

  if (s.phase === 'setup-german') {
    const label = GERMAN_START_HEXES[Math.floor(Math.random() * 3)]
    game.setGermanStart(label)
    const [c, r] = labelToRC(label)
    tq = c; tr = r; actionType = 0
  } else if (s.phase === 'setup-british') {
    // 自动放
    const labels = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
    for (const sh of s.britishShips) {
      if (!s.britishPositions.has(sh.def.id)) {
        const l = labels[Math.floor(Math.random() * labels.length)]
        game.placeBritishToken(sh.def.id, l)
      }
    }
    game.finishSetup()
    actionType = 1
  } else if (s.phase === 'german-move') {
    let moved = false
    for (const gShip of s.germanShips) {
      if (gShip.steps <= 0 || s.movedThisTurn.has(gShip.def.id)) continue
      const from = s.germanPositions.get(gShip.def.id)
      if (!from) continue
      // 简单：随机选一个邻格或不动
      const opts = [hexToLabel(from)!]
      const neighbors = [/* 简化: 只加几个固定方向 */]
      const pick = opts[Math.floor(Math.random() * opts.length)]
      game.germanMove(gShip.def.id, pick)
      const [c, r] = labelToRC(pick)
      tq = c; tr = r; shipId = 1; actionType = 0; moved = true; break
    }
    if (!moved) { game.finishGermanMove(); actionType = 1 }
  } else if (s.phase === 'british-move') {
    let moved = false
    for (const bShip of s.britishShips) {
      if (bShip.steps <= 0 || s.movedThisTurn.has(bShip.def.id)) continue
      const from = s.britishPositions.get(bShip.def.id)
      if (!from) continue
      const opts = [hexToLabel(from)!]
      const pick = opts[Math.floor(Math.random() * opts.length)]
      game.britishMove(bShip.def.id, pick)
      const [c, r] = labelToRC(pick)
      tq = c; tr = r; actionType = 0; moved = true; break
    }
    if (!moved) { game.finishBritishMove(); actionType = 1 }
  } else if (s.phase === 'british-search') {
    game.doSearch(); game.finishSearch(); actionType = 1
  } else if (s.phase === 'combat') {
    game.doCombat(); actionType = 3
  } else if (s.phase === 'transport-attack') {
    game.skipTransportAttack(); actionType = 4
  }

  actions.push({ step_index: stepIdx, phase: PHASE_MAP[s.phase] ?? 7,
    side: player === 'german' ? 0 : 1, action_type: actionType,
    ship_id: shipId, target_q: tq, target_r: tr })
  stepIdx++
}

// 补零
const zeroSlice = new Float32Array(SLICE)
while (stepIdx < T) {
  stateBuf.set(zeroSlice, stepIdx * SLICE)
  actions.push({ step_index: stepIdx, phase: 7, side: 0, action_type: 0, ship_id: 0, target_q: -1, target_r: -1 })
  stepIdx++
}

const s = game.state
const result: GameLogResult = {
  winner: s.winner === 'german' ? 'german' : 'british',
  vp_german: s.vp.german, vp_british: s.vp.british,
  turns: s.turn, total_steps: stepIdx, seed: -1,
  bismarck_sunk: (s.germanShips.find(sh => sh.def.id === 'bismarck')?.steps ?? 1) <= 0,
  brest_reached: s.victoryReason.includes('布雷斯特'),
}

writeGameLog(OUT, 'game_ts', stateBuf, actions, result)
console.log('TS 张量日志已写入:', OUT + '/game_ts')
console.log('胜者:', result.winner, '| 回合:', result.turns, '| 德VP:', result.vp_german, '英VP:', result.vp_british)
