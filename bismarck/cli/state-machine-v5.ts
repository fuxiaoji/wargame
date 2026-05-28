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
  // 德军热力图强度 (可训练)
  rushF7Pull: number     // F7引力强度 (默认-10)
  rushPathPull: number   // 路径引导强度缩放 (默认1.0)
  farmBasePull: number   // 航路基础引力 (默认2)
  farmVPScale: number    // VP缩放系数 (默认0.5)
  huntPull: number       // 孤立目标引力 (默认3)
  hidePush: number       // 英军排斥力 (默认8)
  rushVPPenalty: number  // VP落后时rush扣分系数 (默认4.0)
  rushVPReward: number   // VP领先时rush加分 (默认3.0)
  // 英军 Search
  s1: number; s2: number; s3: number
  // 英军 Hunt
  h1: number; h2: number; h3: number
  // 英军 Patrol (护航/守株待兔)
  p1: number; p2: number; p3: number
  // 英军 Defend
  d1: number; d2: number; d3: number
  // 通用
  temperature: number
}

export const DEFAULT_WEIGHTS: Weights = {
  w1:8, w2:3, w3:2, w4:4, w5:3, w6:2, w7:2, w8:1,
  w9:4, w10:2, w11:2, w12:1, w13:2, w14:1, w15:2,
  rushF7Pull: -10, rushPathPull: 1.0, farmBasePull: 2, farmVPScale: 0.5,
  huntPull: 3, hidePush: 8, rushVPPenalty: 4.0, rushVPReward: 3.0,
  s1:10, s2:0.5, s3:1, h1:10, h2:5, h3:3,
  p1:3, p2:2, p3:2, d1:5, d2:3, d3:4, temperature: 1.0
}

// ========== 热力图传播开关 ==========
export type PropMode = 'off' | 'full' | 'neg' | 'pos'
export const HEATMAP_CONFIG: { propagated: PropMode } = { propagated: 'off' }

/** 热力图距离衰减传播 */
function propagateHeatmap(hm: Float32Array, reachableLabels: string[], mode: PropMode): Map<string, number> {
  const result = new Map<string, number>()
  const W = 6, H = 8
  const reachRC: [number, number][] = []
  for (const l of reachableLabels) {
    const c = l.charCodeAt(0) - 65; const r = parseInt(l.slice(1)) - 1
    if (c >= 0 && c < W && r >= 0 && r < H) reachRC.push([r, c])
  }
  for (let i = 0; i < reachRC.length; i++) {
    const [rr, cc] = reachRC[i]
    let propagated = hm[rr * W + cc]
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        if (r === rr && c === cc) continue
        const v = hm[r * W + c]
        if (Math.abs(v) < 0.1) continue
        // 模式过滤
        if (mode === 'neg' && v >= 0) continue  // 仅负值(吸引)
        if (mode === 'pos' && v <= 0) continue  // 仅正值(排斥)
        const dist = Math.abs(r - rr) + Math.abs(c - cc)
        propagated += v / ((1 + dist) * (1 + dist))
      }
    }
    result.set(reachableLabels[i], propagated)
  }
  return result
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

  getData(): Float32Array { return new Float32Array(this.data) }
  get(r: number, c: number) { return this.data[r * W + c] }
  add(r: number, c: number, v: number) { this.data[r * W + c] += v }
  set(r: number, c: number, v: number) { this.data[r * W + c] = v }

  addBritishShips(state: GameState, scale = 1.0) {
    // 德军所见所有英军算子均为"?", 不区分真船和伪装
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
      const label = hexToLabel(pos); if (!label) continue
      const rc = rcOf(label); if (!rc) continue
      this.add(rc[0], rc[1], 2 * scale)
      for (const nb of hexNeighbors(pos)) {
        const nl = hexToLabel(nb); if (!nl) continue
        const nrc = rcOf(nl); if (nrc) this.add(nrc[0], nrc[1], 1 * scale)
      }
    }
  }

  addThreatRange(state: GameState) {
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
    if (visits >= 2) this.add(rc[0], rc[1], (visits - 1) * 4) // 连停2回合才排斥
  }

  recordVisit(label: string) {
    this.recentVisits.set(label, (this.recentVisits.get(label) || 0) + 1)
    // 衰减旧记录 (新格从1开始, 停在原地累积, 动了就衰减到0)
    for (const [k, v] of this.recentVisits) {
      if (k !== label) this.recentVisits.set(k, Math.max(0, v - 1)) // 动了就快速清零
    }
  }
}

// ========== 调试数据结构 ==========
export interface AIDebugInfo {
  heatmap: Float32Array
  strategyScores: { name: string; raw: number; prob: number }[]
  moveScores: { label: string; heat: number; score: number }[]
  pickedStrategy: string
  curShip: string
}

// ========== 德军 AI ==========
class GermanBrain {
  private w: Weights
  private lastBismarckPos: HexCoord | null = null
  private turnsSinceSeen = 0
  lastStrategy = 'farm'  // 追踪当前策略, transport-attack 用
  usePropagation: PropMode

  constructor(weights: Weights = DEFAULT_WEIGHTS, usePropagation: PropMode = 'off') { this.w = weights; this.usePropagation = usePropagation }

  selectAction(obs: any, debug?: boolean): { actionId: number | null; rawResponse: string; debug?: AIDebugInfo } {
    const state = obs.raw as GameState
    const phase = state.phase
    if (phase === 'setup-german') return this.handleSetup(obs)
    if (phase === 'german-move') return this.handleMove(obs, state, debug)
    if (phase === 'transport-attack') return this.handleTransport(obs, state)
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

  private handleMove(obs: any, state: GameState, debug?: boolean) {
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

    // VP领先→可冲港(占F7即赢); VP落后→先破交; F7守军多→攒6VP必胜
    const vpLead = state.vp.german > state.vp.british
    const vpGap = Math.max(0, state.vp.british - state.vp.german) // 落后多少
    const rush = this.w.w1 * Math.max(0, (8 - distToF7) / 8) + this.w.w2 * ((currentShip.steps)/(currentShip.def.maxSteps))
               + this.w.w3 * (1 - britNearF7/5) - this.w.w4 * (state.bismarckFound ? 1 : 0)
               + (vpLead ? this.w.rushVPReward : -vpGap * this.w.rushVPPenalty) // 领先加分, 落后扣分
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
    // 直接传原始得分，避免双重softmax；5%均匀混合在得分中实现
    const blend = probs.map(p => p * 0.95 + uniform * 0.05)
    const picked = strategies[weightedPick(strategies.map((_, i) => i), finalScores, this.w.temperature)]
    this.lastStrategy = picked

    // 策略修正热力图
    if (picked === 'rush') {
      // F7终点强力吸引 (可训练强度)
      hm.set(6, 5, hm.get(6, 5) + this.w.rushF7Pull)
      for (const nb of hexNeighbors({ q: 5, r: 6 })) {
        const nl = hexToLabel(nb); if (nl) { const rc = rcOf(nl); if (rc) hm.set(rc[0], rc[1], hm.get(rc[0], rc[1]) + this.w.rushF7Pull * 0.5) }
      }
      // 冲港路径引导点 (按距离递增, 强度可缩放)
      for (const [l, v] of [['D8',-4],['E7',-5],['F6',-7],['D6',-3],['C6',-2],['C7',-2]] as [string,number][]) {
        const rc = rcOf(l); if (rc) hm.set(rc[0], rc[1], hm.get(rc[0], rc[1]) + v * this.w.rushPathPull)
      }
    } else if (picked === 'farm') {
      const farmPull = -(this.w.farmBasePull + (6 - state.vp.german) * this.w.farmVPScale) // 可训练
      for (const l of ['D2','D3','C3','C4','D5','E1','E4','E5']) {
        const rc = rcOf(l); if (rc) hm.set(rc[0], rc[1], hm.get(rc[0], rc[1]) + farmPull)
      }
    } else if (picked === 'hunt') {
      // 主动猎杀: 孤立英军目标周围强力吸引
      for (const sh of state.britishShips) {
        if (sh.steps <= 0) continue
        const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
        let nearby = 0
        for (const sh2 of state.britishShips) {
          if (sh2.steps <= 0 || sh2.def.id === sh.def.id) continue
          const p2 = state.britishPositions.get(sh2.def.id); if (!p2) continue
          if (hexDistance(pos, p2) <= 3) nearby++
        }
        if (nearby === 0) { // 孤立目标 → 吸引
          for (let r = 0; r < H; r++)
            for (let c = 0; c < W; c++) {
              const dist = hexDistance(pos, { q: c, r })
              hm.add(r, c, -this.w.huntPull / (1 + dist))
            }
        }
      }
    } else if (picked === 'hide') {
      // 英军周围排斥力 (可训练强度)
      for (const sh of state.britishShips) {
        if (sh.steps <= 0) continue
        const pos = state.britishPositions.get(sh.def.id); if (!pos) continue
        for (let dr = -3; dr <= 3; dr++) {
          for (let dc = -3; dc <= 3; dc++) {
            const q = pos.q + dc, r = pos.r + dr
            if (q >= 0 && q < W && r >= 0 && r < H) hm.add(r, q, this.w.hidePush)
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

    const moveLabels = moveActions.map((a: any) => a.params?.targetLabel || '')
    const propagated = this.usePropagation !== 'off' ? propagateHeatmap(hm.data, moveLabels, this.usePropagation) : null
    const scores = moveActions.map((a: any) => {
      const rc = rcOf(a.params?.targetLabel || '')
      if (!rc) return 0
      const heat = propagated ? propagated.get(a.params?.targetLabel) ?? hm.get(rc[0], rc[1]) : hm.get(rc[0], rc[1])
      return -heat + (Math.random() - 0.5) * 0.1
    })
    const pick = weightedPick(moveActions, scores, 0.5)
    if (pick.params?.targetLabel) hm.recordVisit(pick.params.targetLabel)

    // 调试数据
    let debugInfo: AIDebugInfo | undefined
    if (debug) {
      debugInfo = {
        heatmap: hm.getData(),
        strategyScores: strategies.map((s, i) => ({ name: s, raw: finalScores[i], prob: blend[i] })),
        moveScores: moveActions.map((a: any, i: number) => {
          const rc = rcOf(a.params?.targetLabel || '')
          return { label: a.params?.targetLabel || '?', heat: rc ? hm.get(rc[0], rc[1]) : 0, score: scores[i] }
        }),
        pickedStrategy: picked,
        curShip: currentShip.def.name,
      }
    }
    return { actionId: pick.id, rawResponse: `${picked}:${pick.label}`, debug: debugInfo }
  }

  private handleTransport(obs: any, state: GameState) {
    // 根据当前策略决定是否攻击运输: rush/hide跳过, farm/hunt必打
    const attackers = obs.actions.filter((a: any) => a.type === 'transport')
    if (attackers.length > 0 && this.lastStrategy !== 'rush' && this.lastStrategy !== 'hide') {
      return { actionId: attackers[0].id, rawResponse: `transport:${attackers[0].label}` }
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
    // 德军所见所有算子均为"?", 不区分真船/伪装
    let count = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
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
  usePropagation: PropMode

  constructor(weights: Weights = DEFAULT_WEIGHTS, usePropagation: PropMode = 'off') { this.w = weights; this.usePropagation = usePropagation }

  selectAction(obs: any, debug?: boolean): { actionId: number | null; rawResponse: string; debug?: AIDebugInfo } {
    const state = obs.raw as GameState
    const phase = state.phase

    if (phase === 'setup-british') return this.handleSetup(obs, state)
    if (phase === 'british-move') return this.handleMove(obs, state, debug)
    if (phase === 'british-search') return this.handleSearch(obs, state)
    if (phase === 'combat') return this.handleCombat(obs)
    if (obs.actions.length > 0) return { actionId: obs.actions[0].id, rawResponse: 'fallback' }
    return { actionId: null, rawResponse: 'no-action' }
  }

  private handleSetup(obs: any, state: GameState) {
    // 德军出生点可达范围(速2): BFS收集所有2步内可达格
    const reachable = new Set<string>()
    const visited = new Set<string>()
    const queue: {q:number;r:number;d:number}[] = []
    for (const label of GERMAN_START_HEXES) {
      const rc = rcOf(label); if (!rc) continue
      const key = `${rc[1]},${rc[0]}`; if (visited.has(key)) continue
      visited.add(key); queue.push({q:rc[1],r:rc[0],d:0})
    }
    while (queue.length > 0) {
      const cur = queue.shift()!
      if (cur.d > 0) reachable.add(`${COL[cur.q]}${cur.r+1}`)
      if (cur.d >= 2) continue
      for (const nb of hexNeighbors({q:cur.q,r:cur.r})) {
        const k = `${nb.q},${nb.r}`
        if (!visited.has(k)) { visited.add(k); queue.push({q:nb.q,r:nb.r,d:cur.d+1}) }
      }
    }
    // 可达格列表，每格只放一艘真船
    const hexList = [...reachable].sort(() => Math.random() - 0.5)
    const unplaced = state.britishShips.filter(sh => !sh.def.isDummy && !state.britishPositions.has(sh.def.id))
    const parts: string[] = []
    for (let i = 0; i < unplaced.length; i++) {
      const hex = hexList[i % hexList.length]
      parts.push(`(${unplaced[i].def.name},${hex})`)
    }
    return { actionId: null, rawResponse: parts.join('') }
  }

  private handleMove(obs: any, state: GameState, debug?: boolean) {
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
    const proactiveDefend = (state.turn >= 8 ? 1 : 0) + (vp_g >= 3 ? 1 : 0) + (vp_g >= 5 ? 2 : 0)
    // 德军可能移动范围: 从最后目击位置速2扩散(回合数)
    const inGermanRange = this.lastKnownGermanPos
      ? hexDistance(curPos, this.lastKnownGermanPos) <= this.turnsSinceSeen * 2 + 2
      : false
    const onSeaRoute = isSeaRoute(curPos)

    // 统计已在 hunt 的船数，太多则降低 hunt 吸引力
    let huntCount = 0
    for (const sh of state.britishShips) { if (sh.steps > 0) { const p = state.britishPositions.get(sh.def.id); if (p && hexDistance(p, this.lastKnownGermanPos || curPos) <= 4) huntCount++ } }
    const huntCrowdPenalty = Math.max(0, huntCount - 5) * 1.5 // 超过5艘在目标附近→扣分

    const search  = this.w.s1 * (!state.bismarckFound ? 1 : 0) - this.w.s2 * this.turnsSinceSeen - this.w.s3 * vp_g
    const hunt    = this.w.h1 * (state.bismarckFound ? 1 : 0) + this.w.h2 * (1/(distToLast+1)) + this.w.h3 * 1 - huntCrowdPenalty
    const patrol  = this.w.p1 * (onSeaRoute ? 1 : 0) + this.w.p2 * (inGermanRange ? 1 : 0) + this.w.p3 * (1 - (state.bismarckFound ? 0.5 : 0))
    const defend  = this.w.d1 * (germanNearF7 ? 1 : 0) + this.w.d2 * (vp_g >= 5 ? 1 : 0) + this.w.d3 * (1 - shipsNearF7/5) + proactiveDefend

    const picked = weightedPick(['search','hunt','patrol','defend'], [search, hunt, patrol, defend], this.w.temperature)

    // ===== 共享基图: 德军可能位置 (所有策略可见) =====
    const gCenter = this.lastKnownGermanPos
    const gTurns = this.lastKnownGermanPos ? this.turnsSinceSeen : state.turn
    const centers = gCenter ? [gCenter]
      : GERMAN_START_HEXES.map(l => { const rc = rcOf(l); return rc ? {q:rc[1], r:rc[0]} as HexCoord : null }).filter(Boolean) as HexCoord[]
    for (const center of centers) {
      const radius = Math.min(gTurns * 2, 8)
      for (let r = 0; r < H; r++)
        for (let c = 0; c < W; c++) {
          const dist = hexDistance(center, { q: c, r })
          if (dist <= radius) hm.add(r, c, -Math.max(0.2, (radius - dist) * 0.25))
        }
    }

    // ===== 策略热力图叠加 =====
    if (picked === 'search') {
      // 分散: 互相排斥
      for (const sh of state.britishShips) {
        if (sh.steps <= 0 || sh.def.id === currentShip.def.id) continue
        const p = state.britishPositions.get(sh.def.id); if (!p) continue
        hm.add(p.r, p.q, 2)
      }
    } else if (picked === 'hunt') {
      // 抱团: 与附近其他 hunting 船互相轻微吸引
      for (const sh of state.britishShips) {
        if (sh.steps <= 0 || sh.def.id === currentShip.def.id) continue
        const p = state.britishPositions.get(sh.def.id); if (!p) continue
        const d = hexDistance(curPos, p)
        if (d <= 3) hm.add(p.r, p.q, -1) // 近的抱团
      }
      // 沿扩散梯度分布: 中心强力吸引, 扩散圈梯度, 外围散开
      if (this.lastKnownGermanPos) {
        const huntRadius = Math.min(this.turnsSinceSeen * 2 + 2, 6) // 扩散圈半径随时间增长
        for (let r = 0; r < H; r++)
          for (let c = 0; c < W; c++) {
            const dist = hexDistance(this.lastKnownGermanPos!, { q: c, r })
            if (dist <= 1) hm.add(r, c, -6) // 中心强力吸引(缠住)
            else if (dist <= huntRadius) hm.add(r, c, -(4 - dist * 0.6)) // 扩散圈梯度
            else if (dist <= huntRadius + 2) hm.add(r, c, 1) // 扩散圈外围轻微排斥→散开
          }
      }
      // 如果俾斯麦与英军同格(被缠住) → 全图 swarm 到该格
      if (state.bismarckFound) {
        const bPos = state.germanPositions.get('bismarck')
        if (bPos) {
          for (const sh of state.britishShips) {
            if (sh.steps <= 0) continue
            const p = state.britishPositions.get(sh.def.id); if (!p) continue
            if (hexDistance(p, bPos) === 0) { // 同格! swarm!
              for (let r = 0; r < H; r++)
                for (let c = 0; c < W; c++) {
                  const dist = hexDistance(bPos, { q: c, r })
                  hm.add(r, c, -5 / (1 + dist)) // 高引力, 距离反比衰减
                }
              break // 一个就够了
            }
          }
        }
      }
    } else if (picked === 'patrol') {
      // 蹲航路: 专注大西洋+非洲航路，不碰F7
      for (const l of ['D2','D3','C3','C4','D5','E1','E4','E5']) {
        const rc = rcOf(l); if (rc) hm.add(rc[0], rc[1], -3)
      }
      // 德军冲港必经路口 (轻量吸引)
      for (const l of ['D7','C7','D6']) {
        const rc = rcOf(l); if (rc) hm.add(rc[0], rc[1], -1)
      }
    } else if (picked === 'defend') {
      // 死守F7 (仅在德军确实靠近时触发)
      const f7rc = rcOf('F7'); if (f7rc) { hm.set(f7rc[0], f7rc[1], -6) }
      for (const nb of hexNeighbors({ q: 5, r: 6 })) {
        const nl = hexToLabel(nb); if (nl) { const rc = rcOf(nl); if (rc) hm.add(rc[0], rc[1], -3) }
      }
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

    const moveLabels = moveActions.map((a: any) => a.params?.targetLabel || '')
    const propagated = this.usePropagation !== 'off' ? propagateHeatmap(hm.data, moveLabels, this.usePropagation) : null
    const scores = moveActions.map((a: any) => {
      const rc = rcOf(a.params?.targetLabel || '')
      if (!rc) return 0
      const heat = propagated ? propagated.get(a.params?.targetLabel) ?? hm.get(rc[0], rc[1]) : hm.get(rc[0], rc[1])
      return -heat + (Math.random() - 0.5) * 0.2
    })
    const pick = weightedPick(moveActions, scores, 0.6)
    if (pick.params?.targetLabel) hm.recordVisit(pick.params.targetLabel)

    let debugInfo: AIDebugInfo | undefined
    if (debug) {
      const sNames = ['search', 'hunt', 'patrol', 'defend']
      const britProbs = softmax([search, hunt, patrol, defend], this.w.temperature)
      debugInfo = {
        heatmap: hm.getData(),
        strategyScores: sNames.map((s, i) => ({ name: s, raw: [search, hunt, patrol, defend][i], prob: britProbs[i] })),
        moveScores: moveActions.map((a: any, i: number) => {
          const rc = rcOf(a.params?.targetLabel || '')
          return { label: a.params?.targetLabel || '?', heat: rc ? hm.get(rc[0], rc[1]) : 0, score: scores[i] }
        }),
        pickedStrategy: picked,
        curShip: currentShip.def.name,
      }
    }
    return { actionId: pick.id, rawResponse: `${picked}:${pick.label}`, debug: debugInfo }
  }

  private handleSearch(obs: any, state: GameState) {
    // 先同格索敌，再航空索敌（每次不同格）
    const airActions = obs.actions.filter((a: any) => a.type === 'air-search')
    const coLocateAction = obs.actions.find((a: any) => a.type === 'finish-phase' && a.label.includes('同格'))
    const finishAction = obs.actions.find((a: any) => a.type === 'finish-phase' && a.label.includes('完成'))

    // 航空索敌：优先搜德军冲港路线上的格
    if (airActions.length > 0) {
      const priorityHexes = new Set(['D8','E7','F6','D7','C7','E6','C6','D6','D5','E5'])
      const scores = airActions.map((a: any) => {
        const label = a.params?.targetLabel || ''
        // 冲港路线格优先，其次靠近A/B列的格
        if (priorityHexes.has(label)) return 5
        const rc = rcOf(label); if (!rc) return 0
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
export function createStateMachineAI(weights?: Weights, gerPropagation: PropMode = 'off', britPropagation: PropMode = 'off') {
  const w = weights || DEFAULT_WEIGHTS
  const german = new GermanBrain(w, gerPropagation)
  const british = new BritishBrain(w, britPropagation)
  return {
    german, british, weights: w,
    selectGerman(obs: any, debug?: boolean) { return german.selectAction(obs, debug) },
    selectBritish(obs: any, debug?: boolean) { return british.selectAction(obs, debug) },
  }
}
