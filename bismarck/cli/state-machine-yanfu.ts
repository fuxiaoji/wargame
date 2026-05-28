/** 严父状态机 — 硬编码脚本化策略，零权重，与训练AI完全隔离 */
import type { GameState, ShipState, HexCoord } from '../engine/types'
import { hexToLabel, labelToHex, hexDistance, hexNeighbors } from '../engine/map'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'

// ========== 航路格 ==========
const SEA_ROUTES = ['D2','D3','C3','C4','D5','E1','F4','E4','E5']
const seaRouteSet = new Set(SEA_ROUTES)

function rcOf(label: string): [number, number] | null {
  if (label.length < 2) return null
  const c = label.charCodeAt(0) - 65; const r = parseInt(label.slice(1)) - 1
  return (c >= 0 && c < 6 && r >= 0 && r < 8) ? [r, c] : null
}

// ========== 德军 严父 ==========
class YanfuGermanBrain {
  private phase = 0  // 0=to D8, 1=to F7/E5, 2=at destination
  private bismarckAtF7 = false
  private eugenRouteIdx = 0  // 欧根当前航路索引
  private eugenRoutes = ['E5','E4','D5','F4','D3','C3']  // 备用航路

  selectAction(obs: any): { actionId: number | null; rawResponse: string } {
    const state = obs.raw as GameState
    const phase = state.phase
    const bismarck = state.germanShips.find(s => s.def.id === 'bismarck' && s.steps > 0)
    const eugen = state.germanShips.find(s => s.def.id === 'prinz-eugen' && s.steps > 0)

    if (phase === 'setup-german') {
      const b7 = obs.actions.find((a: any) => a.label?.includes('B7'))
      return { actionId: b7?.id ?? obs.actions[0]?.id, rawResponse: '严父:初设B7' }
    }

    if (phase === 'german-move') {
      const bPos = state.germanPositions.get('bismarck')
      const ePos = state.germanPositions.get('prinz-eugen')
      const curShipId = obs.actions[0]?.params?.shipId
      const isBismarck = curShipId === 'bismarck'
      const curPos = isBismarck ? bPos : ePos
      const curShip = isBismarck ? bismarck : eugen

      if (!curPos || !curShip) {
        const f = obs.actions.find((a: any) => a.type === 'finish-phase')
        return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父:finish' }
      }

      const curLabel = hexToLabel(curPos)
      const bLabel = bPos ? hexToLabel(bPos) : '?'

      if (isBismarck) {
        // 俾斯麦固定路线: B7 → D8 → F7 → 蹲
        if (bLabel === 'F7') {
          this.bismarckAtF7 = true
          const f = obs.actions.find((a: any) => a.type === 'finish-phase')
          return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父:B蹲F7' }
        }
        if (bLabel === 'D8' || this.phase >= 0) {
          // D8 → F7
          const toF7 = obs.actions.find((a: any) => a.type === 'move' && a.params?.targetLabel === 'F7')
          if (toF7) { this.phase = 1; this.bismarckAtF7 = true; return { actionId: toF7.id, rawResponse: '严父:B→F7' } }
          const toE7 = obs.actions.find((a: any) => a.type === 'move' && a.params?.targetLabel === 'E7')
          if (toE7) return { actionId: toE7.id, rawResponse: '严父:B→E7' }
        }
        // B7 → D8
        const toD8 = obs.actions.find((a: any) => a.type === 'move' && a.params?.targetLabel === 'D8')
        if (toD8) { this.phase = 0; return { actionId: toD8.id, rawResponse: '严父:B→D8' } }
        // fallback: toward F7
        const toC7 = obs.actions.find((a: any) => a.type === 'move' && a.params?.targetLabel === 'C7')
        if (toC7) return { actionId: toC7.id, rawResponse: '严父:B→C7' }
        const f = obs.actions.find((a: any) => a.type === 'finish-phase')
        return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父:B-fallback' }
      } else {
        // 欧根亲王: 先跟俾斯麦到 F7(抱团安全), 再到 F7 后分头去航路袭击
        const moveActions = obs.actions.filter((a: any) => a.type === 'move')
        if (moveActions.length > 0) {
          // 已经在航路格 → 蹲着等运输
          if (curLabel && seaRouteSet.has(curLabel)) {
            const f2 = obs.actions.find((a: any) => a.type === 'finish-phase')
            return { actionId: f2?.id ?? obs.actions[0]?.id, rawResponse: `严父:E守${curLabel}` }
          }
          // 到 F7 了 → 分手，去最近航路
          if (curLabel === 'F7') {
            let best = moveActions[0]; let bestDist = 99
            for (const a of moveActions) {
              const arc = rcOf(a.params?.targetLabel || ''); if (!arc) continue
              for (const route of SEA_ROUTES) {
                const trc = rcOf(route); if (!trc) continue
                const d = Math.abs(arc[0] - trc[0]) + Math.abs(arc[1] - trc[1])
                if (d < bestDist) { bestDist = d; best = a }
              }
            }
            return { actionId: best.id, rawResponse: `严父:E→${best.params?.targetLabel}` }
          }
          // 还没到 F7 → 抱团去 F7
          if (curLabel !== 'F7' && (bLabel === 'F7' || this.bismarckAtF7)) {
            const toF7 = obs.actions.find((a: any) => a.type === 'move' && a.params?.targetLabel === 'F7')
            if (toF7) { this.bismarckAtF7 = true; return { actionId: toF7.id, rawResponse: '严父:E→F7' } }
            // F7 不可直达，向 F7 靠拢
            let best = moveActions[0]; let bestDist = 99
            for (const a of moveActions) {
              const arc = rcOf(a.params?.targetLabel || ''); if (!arc) continue
              const d = Math.abs(arc[0]-5)+Math.abs(arc[1]-6)  // F7(5,6)
              if (d < bestDist) { bestDist = d; best = a }
            }
            return { actionId: best.id, rawResponse: `严父:E→${best.params?.targetLabel}` }
          }
          // 抱团走: D8 → C7 → F7 固定顺序, 必须和俾斯麦在一起
          for (const target of ['D8','C7','F7','E7','D7','E6']) {
            const a = obs.actions.find((x: any) => x.type === 'move' && x.params?.targetLabel === target)
            if (a) return { actionId: a.id, rawResponse: `严父:E→${target}` }
          }
          // 实在跟不上了
          return { actionId: moveActions[0].id, rawResponse: `严父:E→${moveActions[0].params?.targetLabel}` }
        }
        const f = obs.actions.find((a: any) => a.type === 'finish-phase')
        return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父:E-finish' }
      }
    }

    if (phase === 'transport-attack') {
      // 欧根袭击运输
      const tActs = obs.actions.filter((a: any) => a.type === 'transport')
      if (tActs.length > 0 && eugen && eugen.steps > 0) {
        const eugenAttack = tActs.find((a: any) => a.params?.shipId === 'prinz-eugen')
        if (eugenAttack) return { actionId: eugenAttack.id, rawResponse: '严父:E运输' }
        // If position revealed and VP not leading, switch route
        if (state.vp.german <= state.vp.british) {
          this.eugenRouteIdx++
          const skip = obs.actions.find((a: any) => a.type === 'finish-phase')
          if (skip) return { actionId: skip.id, rawResponse: '严父:换航路' }
        }
        return { actionId: tActs[0].id, rawResponse: '严父:运输' }
      }
      const skip = obs.actions.find((a: any) => a.type === 'finish-phase')
      return { actionId: skip?.id ?? obs.actions[0]?.id, rawResponse: '严父:skip运输' }
    }

    // Fallback
    return { actionId: obs.actions[0]?.id ?? null, rawResponse: '严父:fallback' }
  }
}

// ========== 英军 严父 ==========
class YanfuBritishBrain {
  // 计算当前各航路格的英军船数
  private countRouteShips(state: GameState): Record<string, number> {
    const cnt: Record<string, number> = {}
    for (const r of SEA_ROUTES) cnt[r] = 0
    for (const sh of state.britishShips) {
      if (sh.steps <= 0) continue
      const p = state.britishPositions.get(sh.def.id)
      if (p) { const l = hexToLabel(p); if (l && cnt[l] !== undefined) cnt[l]++ }
    }
    return cnt
  }

  selectAction(obs: any): { actionId: number | null; rawResponse: string } {
    const state = obs.raw as GameState
    const phase = state.phase

    if (phase === 'setup-british') {
      const s = state
      const used = new Set<string>(GERMAN_START_HEXES)
      for (const [hex, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) {
        used.add(hex)
        for (const id of shipIds) (obs as any).game?.placeBritishToken?.(id, hex)
      }
      const act = obs.actions.find((a: any) => a.type === 'finish-phase')
      const parts: string[] = []
      const unplaced = s.britishShips.filter(sh => !s.britishPositions.has(sh.def.id))
      for (let i = 0; i < unplaced.length; i++) {
        const route = SEA_ROUTES[i % SEA_ROUTES.length]
        parts.push(`(${unplaced[i].def.name},${route})`)
      }
      return { actionId: act?.id ?? null, rawResponse: parts.join('') }
    }

    if (phase === 'british-move') {
      const curShipId = obs.actions[0]?.params?.shipId
      const curShip = state.britishShips.find(s => s.def.id === curShipId && s.steps > 0)
      if (!curShip) {
        const f = obs.actions.find((a: any) => a.type === 'finish-phase')
        return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父英:finish' }
      }
      const curPos = state.britishPositions.get(curShip.def.id)
      const curLabel = curPos ? hexToLabel(curPos) : null

      // 统计各航路实际船数, 找出空航路
      const routeCnt = this.countRouteShips(state)
      const emptyRoutes = SEA_ROUTES.filter(r => routeCnt[r] === 0)

      // 已经在航路上 → 蹲着不动
      if (curLabel && seaRouteSet.has(curLabel)) {
        const f = obs.actions.find((a: any) => a.type === 'finish-phase')
        return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: `严父英:守${curLabel}` }
      }

      // 不在航路上 → 优先去空航路
      const moveActions = obs.actions.filter((a: any) => a.type === 'move')
      if (moveActions.length > 0) {
        const targets = emptyRoutes.length > 0 ? emptyRoutes : SEA_ROUTES
        let best = moveActions[0]; let bestDist = 999
        for (const a of moveActions) {
          const arc = rcOf(a.params?.targetLabel || ''); if (!arc) continue
          for (const t of targets) {
            const trc = rcOf(t); if (!trc) continue
            const d = Math.abs(arc[0] - trc[0]) + Math.abs(arc[1] - trc[1])
            if (d < bestDist) { bestDist = d; best = a }
          }
        }
        return { actionId: best.id, rawResponse: `严父英:→${best.params?.targetLabel}` }
      }

      const f = obs.actions.find((a: any) => a.type === 'finish-phase')
      return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父英:finish2' }
    }

    if (phase === 'british-search') {
      // Reset route coverage for next turn
      const airActs = obs.actions.filter((a: any) => a.type === 'air-search')
      if (airActs.length > 0) {
        // Air search F7 and nearby rush path
        for (const pri of ['F7','F6','E7','D8']) {
          const a = airActs.find((x: any) => x.params?.targetLabel === pri)
          if (a) return { actionId: a.id, rawResponse: `严父英:空搜${pri}` }
        }
        return { actionId: airActs[0].id, rawResponse: '严父英:空搜' }
      }
      const f = obs.actions.find((a: any) => a.type === 'finish-phase')
      return { actionId: f?.id ?? obs.actions[0]?.id, rawResponse: '严父英:搜完' }
    }

    if (phase === 'combat') {
      const c = obs.actions.find((a: any) => a.type === 'combat')
      return { actionId: c?.id ?? obs.actions[0]?.id, rawResponse: '严父英:战斗' }
    }

    return { actionId: obs.actions[0]?.id ?? null, rawResponse: '严父英:fallback' }
  }
}

// ========== 导出 ==========
export function createYanfuAI() {
  const german = new YanfuGermanBrain()
  const british = new YanfuBritishBrain()
  return {
    german, british,
    selectGerman(obs: any) { return german.selectAction(obs) },
    selectBritish(obs: any) { return british.selectAction(obs) },
  }
}
