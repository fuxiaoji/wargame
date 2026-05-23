/** 启发式状态机 AI —— 热力图 + 策略概率 + 双引擎兼容 */

import type { GameState, ShipState, HexCoord } from '../engine/types'
import { hexToLabel, labelToHex, hexDistance, hexNeighbors } from '../engine/map'
import { getShipSpeed, getGermanReachableLabels } from '../engine/movement'
import { isSeaRoute, isBrest } from '../engine/map'
import { GERMAN_START_HEXES } from '../engine/map'

// ========== 权重配置 ==========
export interface Weights {
  // 德军 RushBrest
  w1: number; w2: number; w3: number; w4: number
  // 德军 FarmRoutes
  w5: number; w6: number; w7: number; w8: number
  // 德军 HuntShips
  w9: number; w10: number; w11: number
  // 德军 HideDeep
  w12: number; w13: number; w14: number; w15: number
  // 英军 Search
  s1: number; s2: number; s3: number
  // 英军 Hunt
  h1: number; h2: number; h3: number
  // 英军 Defend
  d1: number; d2: number; d3: number
  // 通用
  temperature: number
}

export const DEFAULT_WEIGHTS: Weights = {
  w1:3, w2:2, w3:1, w4:4, w5:2, w6:3, w7:2, w8:1,
  w9:4, w10:2, w11:1, w12:2, w13:3, w14:1, w15:2,  // w9↑鼓励狩猎, w12↓别太怂
  s1:10, s2:0.5, s3:1, h1:10, h2:5, h3:3,
  d1:5, d2:3, d3:4, temperature: 1.0
}

// ========== 概率工具 ==========
function softmax(scores: number[], temp = 1.0): number[] {
  const max = Math.max(...scores)
  const exp = scores.map(s => Math.exp((s - max) / temp))
  const sum = exp.reduce((a, b) => a + b, 0) || 1
  return exp.map(e => e / sum)
}

function weightedPick<T>(items: T[], scores: number[], temp = 1.0): T {
  const probs = softmax(scores, temp)
  const r = Math.random()
  let cum = 0
  for (let i = 0; i < items.length; i++) { cum += probs[i]; if (r <= cum) return items[i] }
  return items[items.length - 1]
}

// ========== 热力图 ==========
const H = 8, W = 6
const COL = ['A','B','C','D','E','F']
function rcOf(label: string): [number, number] | null {
  if (!label || label.length < 2) return null
  const c = label.charCodeAt(0) - 65; const r = parseInt(label.slice(1)) - 1
  return (c >= 0 && c < W && r >= 0 && r < H) ? [r, c] : null
}
function labelOf(rc: [number, number]): string { return COL[rc[1]] + (rc[0] + 1) }

class Heatmap {
  data = new Float32Array(H * W)
  recentVisits = new Map<string, number>()

  clear() { this.data.fill(0) }

  get(r: number, c: number) { return this.data[r * W + c] }
  add(r: number, c: number, v: number) { this.data[r * W + c] += v }
  set(r: number, c: number, v: number) { this.data[r * W + c] = v }

  addBritishShips(state: GameState, scale = 1.0) {
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      const label = hexToLabel(pos); if (!label) continue
      const rc = rcOf(label); if (!rc) continue
      this.add(rc[0], rc[1], 2 * scale) // 本格 +2
      for (const nb of hexNeighbors(pos)) {
        const nl = hexToLabel(nb); if (!nl) continue
        const nrc = rcOf(nl); if (nrc) this.add(nrc[0], nrc[1], 1 * scale) // 邻格 +1
      }
    }
  }

  addThreatRange(state: GameState) {
    // 英军下回合能到的范围（速3=周围3格）
    for (const sh of state.britishShips) {
      if (sh.steps <= 0 || !sh.def) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      // 简化为 BFS 3 层
      const visited = new Set<string>()
      const queue: { q: number; r: number; d: number }[] = [{ q: pos.q, r: pos.r, d: 0 }]
      visited.add(`${pos.q},${pos.r}`)
      while (queue.length > 0) {
        const cur = queue.shift()!
        if (cur.d > 0) { const rc = rcOf(`${COL[cur.q]}${cur.r+1}`); if (rc) this.add(rc[0], rc[1], 0.5) }
        if (cur.d >= 3) continue
        for (const nb of hexNeighbors({ q: cur.q, r: cur.r })) {
          const k = `${nb.q},${nb.r}`
          if (!visited.has(k)) { visited.add(k); queue.push({ q: nb.q, r: nb.r, d: cur.d + 1 }) }
        }
      }
    }
  }

  addSpawnZone() {
    for (const l of GERMAN_START_HEXES) { const rc = rcOf(l); if (rc) this.add(rc[0], rc[1], 3) }
  }

  addLastKnown(pos: HexCoord, turnsSince: number) {
    const radius = Math.min(turnsSince * 2, 8)
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const dist = hexDistance(pos, { q: c, r })
        if (dist <= radius) this.add(r, c, Math.max(0, (radius - dist) * 0.5))
      }
    }
  }

  applyAntiStuck(label: string) {
    const rc = rcOf(label); if (!rc) return
    const visits = this.recentVisits.get(label) || 0
    if (visits > 0) this.add(rc[0], rc[1], visits * 3)
  }

  recordVisit(label: string) {
    this.recentVisits.set(label, (this.recentVisits.get(label) || 0) + 1)
    // 衰减旧记录
    for (const [k, v] of this.recentVisits) {
      if (k !== label) this.recentVisits.set(k, Math.max(0, v - 0.5))
    }
  }
}

// ========== 德军 AI ==========
class GermanBrain {
  private w: Weights
  private lastBismarckPos: HexCoord | null = null
  private turnsSinceSeen = 0

  constructor(weights: Weights = DEFAULT_WEIGHTS) { this.w = weights }

  selectAction(obs: any): { actionId: number | null; rawResponse: string } {
    const state = obs.raw as GameState
    const phase = state.phase

    if (phase === 'setup-german') return this.handleSetup(obs)
    if (phase === 'german-move') return this.handleMove(obs, state)
    if (phase === 'transport-attack') return this.handleTransport(obs, state)
    // 其他阶段（不应该出现）fallback
    if (obs.actions.length > 0) return { actionId: obs.actions[0].id, rawResponse: 'fallback' }
    return { actionId: null, rawResponse: 'no-action' }
  }

  private handleSetup(obs: any) {
    const actions = obs.actions
    // 倾向选 B7（最近 F7）
    const scores = actions.map((a: any) => a.label.includes('B7') ? 3 : a.label.includes('A6') ? 2 : 1)
    const pick = weightedPick(actions, scores, 0.5)
    return { actionId: pick.id, rawResponse: `setup:${pick.label}` }
  }

  private handleMove(obs: any, state: GameState) {
    const hm = new Heatmap()
    // 找俾斯麦
    const bismarck = state.germanShips.find(s => s.def.id === 'bismarck' && s.steps > 0)
    const eugen = state.germanShips.find(s => s.def.id === 'prinz-eugen' && s.steps > 0)
    const currentShip = obs.actions[0]?.params?.shipId
      ? (state.germanShips.find(s => s.def.id === obs.actions[0].params.shipId) || bismarck)
      : bismarck

    if (!currentShip) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
    }

    const curPos = state.germanPositions.get(currentShip.def.id)
    if (!curPos) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish-nopos' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
    }

    // 更新追踪
    if (currentShip.def.id === 'bismarck') {
      this.lastBismarckPos = curPos
      this.turnsSinceSeen = 0
    }

    // 构建热力图
    hm.addBritishShips(state)
    hm.addThreatRange(state)

    // 策略得分
    const bPos = this.lastBismarckPos || curPos
    const distToF7 = hexDistance(curPos, { q: 5, r: 6 }) // F7
    const onRoute = isSeaRoute(curPos)
    const britNearF7 = this.countBritNear(state, 'F7', 3)
    const isolatedTargets = this.countIsolated(state)

    const rush = this.w.w1 * (1/(distToF7+1)) + this.w.w2 * ((currentShip.steps)/(currentShip.def.maxSteps))
               + this.w.w3 * (1 - britNearF7/5) - this.w.w4 * (state.bismarckFound ? 2 : 0)
    const farm = this.w.w5 * (onRoute ? 1 : 0) + this.w.w6 * (1 - state.vp.german/6)
               + this.w.w7 * (state.bismarckFound ? 0 : 1) + this.w.w8 * 0.3
    const hunt = this.w.w9 * isolatedTargets + this.w.w10 * 0.5 - this.w.w11 * this.countBritNear(state, hexToLabel(curPos)!, 3)
    const hide = this.w.w12 * (state.bismarckFound ? 1 : 0) + this.w.w13 * (currentShip.steps < 2 ? 1 : 0)
               + this.w.w14 * this.avgBritProximity(state, curPos) - this.w.w15 * (1 - state.vp.german/6)

    // 船特定修正：俾斯麦倾向冲港/躲，欧根倾向打工/冒险
    const isBismarck = currentShip.def.id === 'bismarck'
    const shipBonus = isBismarck
      ? [2, 0, -3, 1]   // 俾斯麦: Rush+2, Hunt-3(别冒险), Hide+1
      : [-2, 1, 3, 0]   // 欧根:   Rush-2, Farm+1, Hunt+3(可牺牲), Hide+0

    const strategies = ['rush', 'farm', 'hunt', 'hide']
    const finalScores = [rush + shipBonus[0], farm + shipBonus[1], hunt + shipBonus[2], hide + shipBonus[3]]
    // 混合 5% 均匀分布, 确保每种策略至少有探索机会
    const probs = softmax(finalScores, this.w.temperature)
    const uniform = 0.25  // 均匀分布每个 25%
    const blend = probs.map(p => p * 0.95 + uniform * 0.05)  // 95%策略+5%均匀
    const picked = strategies[weightedPick(strategies.map((_, i) => i), blend, 0.5)]

    // 策略修正热力图
    if (picked === 'rush') {
      hm.set(6, 5, hm.get(6, 5) - 10) // F7=-10
      for (const nb of hexNeighbors({ q: 5, r: 6 })) {
        const nl = hexToLabel(nb); if (nl) { const rc = rcOf(nl); if (rc) hm.set(rc[0], rc[1], hm.get(rc[0], rc[1]) - 5) }
      }
    } else if (picked === 'farm') {
      for (const l of ['D2','D3','C3','C4','D5','E1','E4','E5']) {
        const rc = rcOf(l); if (rc) hm.set(rc[0], rc[1], hm.get(rc[0], rc[1]) - 2)
      }
    } else if (picked === 'hide') {
      // 英军周围 +8 斥力
      for (const sh of state.britishShips) {
        if (sh.steps <= 0) continue
        const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
        for (let dr = -3; dr <= 3; dr++) {
          for (let dc = -3; dc <= 3; dc++) {
            const q = pos.q + dc, r = pos.r + dr
            if (q >= 0 && q < W && r >= 0 && r < H) hm.add(r, q, 8)
          }
        }
      }
    }

    // 防死锁
    for (const a of obs.actions) {
      if (a.type === 'move' && a.params?.targetLabel) hm.applyAntiStuck(a.params.targetLabel)
    }

    // 得分 = -heat (热力越低越好)
    const moveActions = obs.actions.filter((a: any) => a.type === 'move')
    if (moveActions.length === 0) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish2' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback2' }
    }

    const scores = moveActions.map((a: any) => {
      const rc = rcOf(a.params?.targetLabel || '')
      return rc ? -hm.get(rc[0], rc[1]) + (Math.random() - 0.5) * 0.1 : 0
    })
    const pick = weightedPick(moveActions, scores, 0.5)
    if (pick.params?.targetLabel) hm.recordVisit(pick.params.targetLabel)
    return { actionId: pick.id, rawResponse: `${picked}:${pick.label}` }
  }

  private handleTransport(obs: any, state: GameState) {
    // 航路上→攻击(70%概率), 否则跳过
    const attackers = obs.actions.filter((a: any) => a.type === 'transport')
    if (attackers.length > 0 && Math.random() < 0.7) {
      const pick = weightedPick(attackers, attackers.map((_: any, i: number) => 1), 1.0)
      return { actionId: pick.id, rawResponse: `transport:${pick.label}` }
    }
    const skip = obs.actions.find((a: any) => a.type === 'finish-phase')
    return skip ? { actionId: skip.id, rawResponse: 'skip-transport' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
  }

  private countBritNear(state: GameState, label: string, dist: number): number {
    const rc = rcOf(label); if (!rc) return 0
    let count = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      if (hexDistance(pos, { q: rc[1], r: rc[0] }) <= dist) count++
    }
    return count
  }

  private countIsolated(state: GameState): number {
    let count = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0 || sh.def.isDummy) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      let nearby = 0
      for (const sh2 of state.britishShips) {
        if (sh2.steps <= 0 || sh2.def.id === sh.def.id) continue
        const p2 = state.britishPositions.get(sh2.def.id); if (!p2) continue
        if (hexDistance(pos, p2) <= 3) nearby++
      }
      if (nearby === 0) count++
    }
    return count
  }

  private avgBritProximity(state: GameState, pos: HexCoord): number {
    let sum = 0, count = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const bp = state.britishPositions.get(sh.def.id); if (!bp) continue
      sum += hexDistance(pos, bp); count++
    }
    return count > 0 ? sum / count / 8 : 0
  }
}

// ========== 英军 AI ==========
class BritishBrain {
  private w: Weights
  private lastKnownGermanPos: HexCoord | null = null
  private turnsSinceSeen = 0

  constructor(weights: Weights = DEFAULT_WEIGHTS) { this.w = weights }

  selectAction(obs: any): { actionId: number | null; rawResponse: string } {
    const state = obs.raw as GameState
    const phase = state.phase

    if (phase === 'setup-british') return this.handleSetup(obs, state)
    if (phase === 'british-move') return this.handleMove(obs, state)
    if (phase === 'british-search') return this.handleSearch(obs, state)
    if (phase === 'combat') return this.handleCombat(obs)
    if (obs.actions.length > 0) return { actionId: obs.actions[0].id, rawResponse: 'fallback' }
    return { actionId: null, rawResponse: 'no-action' }
  }

  private handleSetup(obs: any, state: GameState) {
    // 真船放靠近德军出生点
    const germanZone = ['A5','A6','B7','B6','C6','C7','B5','C5']
    const unplaced = state.britishShips.filter(sh => !sh.def.isDummy && !state.britishPositions.has(sh.def.id))
    const parts: string[] = []
    for (const sh of unplaced) {
      const hex = germanZone[Math.floor(Math.random() * Math.min(germanZone.length, 6))]
      parts.push(`(${sh.def.name},${hex})`)
    }
    return { actionId: null, rawResponse: parts.join('') }
  }

  private handleMove(obs: any, state: GameState) {
    const hm = new Heatmap()
    const currentShip = this.getCurrentShip(obs, state)
    if (!currentShip) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
    }

    const curPos = state.britishPositions.get(currentShip.def.id)
    if (!curPos) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish-nopos' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
    }

    // 找到德军最后位置
    const bismarck = state.germanShips.find(s => s.def.id === 'bismarck' && s.steps > 0)
    if (bismarck) {
      const bp = state.germanPositions.get('bismarck')
      if (bp && (state.germanPositionPublic || state.bismarckFound)) {
        this.lastKnownGermanPos = bp
        this.turnsSinceSeen = 0
      } else {
        this.turnsSinceSeen++
      }
    }

    // 策略得分
    const vp_g = state.vp.german
    const germanNearF7 = this.germanNearF7(state)
    const shipsNearF7 = this.countShipsNear(state, 'F7', 3)
    const distToLast = this.lastKnownGermanPos ? hexDistance(curPos, this.lastKnownGermanPos) : 8

    const search = this.w.s1 * (!state.bismarckFound ? 1 : 0) - this.w.s2 * this.turnsSinceSeen - this.w.s3 * vp_g
    const hunt = this.w.h1 * (state.bismarckFound ? 1 : 0) + this.w.h2 * (1/(distToLast+1)) + this.w.h3 * 1
    const defend = this.w.d1 * (germanNearF7 ? 1 : 0) + this.w.d2 * (vp_g >= 4 ? 1 : 0) + this.w.d3 * (1 - shipsNearF7/5)

    const picked = weightedPick(['search','hunt','defend'], [search, hunt, defend], this.w.temperature)

    // 热力图
    if (picked === 'search' || (picked === 'hunt' && this.lastKnownGermanPos)) {
      hm.addSpawnZone()
      if (this.lastKnownGermanPos) hm.addLastKnown(this.lastKnownGermanPos, this.turnsSinceSeen + 1)
    } else if (picked === 'defend') {
      const f7rc = rcOf('F7'); if (f7rc) hm.set(f7rc[0], f7rc[1], -10)
    }

    // 防死锁
    for (const a of obs.actions) {
      if (a.type === 'move' && a.params?.targetLabel) hm.applyAntiStuck(a.params.targetLabel)
    }

    const moveActions = obs.actions.filter((a: any) => a.type === 'move')
    if (moveActions.length === 0) {
      const finish = obs.actions.find((a: any) => a.type === 'finish-phase')
      return finish ? { actionId: finish.id, rawResponse: 'finish2' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback2' }
    }

    const scores = moveActions.map((a: any) => {
      const rc = rcOf(a.params?.targetLabel || '')
      return rc ? -hm.get(rc[0], rc[1]) + (Math.random() - 0.5) * 0.2 : 0
    })
    const pick = weightedPick(moveActions, scores, 0.6)
    if (pick.params?.targetLabel) hm.recordVisit(pick.params.targetLabel)
    return { actionId: pick.id, rawResponse: `${picked}:${pick.label}` }
  }

  private handleSearch(obs: any, state: GameState) {
    // 先同格索敌，再航空索敌（每次不同格）
    const airActions = obs.actions.filter((a: any) => a.type === 'air-search')
    const coLocateAction = obs.actions.find((a: any) => a.type === 'finish-phase' && a.label.includes('同格'))
    const finishAction = obs.actions.find((a: any) => a.type === 'finish-phase' && a.label.includes('完成'))

    // 航空索敌：优先搜靠德国出生点方向的
    if (airActions.length > 0 && Math.random() < 0.6) {
      const scores = airActions.map((a: any) => {
        const rc = rcOf(a.params?.targetLabel || '')
        if (!rc) return 0
        // 偏北(A/B列)的格得分高
        return (rc[1] <= 1 ? 3 : 1)
      })
      const pick = weightedPick(airActions, scores, 0.8)
      return { actionId: pick.id, rawResponse: `air:${pick.label}` }
    }
    if (coLocateAction) return { actionId: coLocateAction.id, rawResponse: 'co-locate' }
    if (finishAction) return { actionId: finishAction.id, rawResponse: 'finish-search' }
    return { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
  }

  private handleCombat(obs: any) {
    const action = obs.actions.find((a: any) => a.type === 'combat')
    return action ? { actionId: action.id, rawResponse: 'combat' } : { actionId: obs.actions[0]?.id, rawResponse: 'fallback' }
  }

  private getCurrentShip(obs: any, state: GameState): ShipState | undefined {
    const firstAction = obs.actions[0]
    if (firstAction?.params?.shipId) return state.britishShips.find(s => s.def.id === firstAction.params.shipId)
    return state.britishShips.find(s => s.steps > 0 && !state.movedThisTurn.has(s.def.id) &&
      (state.bismarckFound || s.def.isDummy || s.def.id === 'hood' || s.def.id === 'prince-of-wales'))
  }

  private germanNearF7(state: GameState): boolean {
    const f7 = rcOf('F7'); if (!f7) return false
    for (const gs of state.germanShips) {
      if (gs.steps <= 0) continue
      const pos = state.germanPositions.get(gs.def.id); if (!pos) continue
      if (hexDistance(pos, { q: f7[1], r: f7[0] }) <= 4) return true
    }
    return false
  }

  private countShipsNear(state: GameState, label: string, dist: number): number {
    const rc = rcOf(label); if (!rc) return 0
    let count = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      if (hexDistance(pos, { q: rc[1], r: rc[0] }) <= dist) count++
    }
    return count
  }
}

// ========== 导出 ==========
export function createStateMachineAI(weights?: Weights) {
  const w = weights || DEFAULT_WEIGHTS
  const german = new GermanBrain(w)
  const british = new BritishBrain(w)
  return {
    german, british, weights: w,
    selectGerman(obs: any) { return german.selectAction(obs) },
    selectBritish(obs: any) { return british.selectAction(obs) },
  }
}
