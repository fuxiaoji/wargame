import { BismarckEnv } from './engine/env'
import { createStateMachineAI, DEFAULT_WEIGHTS } from './cli/state-machine'
import { V8_GERMAN_BEST, V8_BRITISH_BEST } from './cli/presets'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import { GameState } from './engine/types'

function randomPick(actions: any[]): number {
  return actions[Math.floor(Math.random() * actions.length)].id
}

function doBritishSetup(game: any) {
  const s = game.state as GameState
  const used = new Set<string>(GERMAN_START_HEXES)
  for (const [hex, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) {
    used.add(hex)
    for (const id of shipIds) game.placeBritishToken(id, hex)
  }
  const dummyShip = { def: { speed: 2 }, steps: 2 } as any
  const reachable = new Set<string>()
  for (const label of GERMAN_START_HEXES) {
    const h = { q: label.charCodeAt(0) - 65, r: parseInt(label.slice(1)) }
    if (h.q < 0 || h.q >= 6 || h.r < 1 || h.r > 8) continue
    for (const l of getGermanReachableLabels(dummyShip, h)) {
      if (!used.has(l)) reachable.add(l)
    }
  }
  for (const sh of s.britishShips) {
    if (s.britishPositions.has(sh.def.id)) continue
    const avail = [...reachable].filter(h => !used.has(h))
    if (avail.length > 0) {
      const picked = avail[Math.floor(Math.random() * avail.length)]
      game.placeBritishToken(sh.def.id, picked); used.add(picked)
    }
  }
  const fallback = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips)
    if (!s.britishPositions.has(sh.def.id))
      game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random()*fallback.length)])
  return game.finishSetup()
}

function runGames(games: number, gerAI: any, britAI: any, label: string) {
  let gerWins = 0, britWins = 0, sumTurns = 0, sumVpGer = 0, sumVpBrit = 0
  for (let g = 0; g < games; g++) {
    const env = new BismarckEnv()
    const game = env.game
    let steps = 0, stuck = 0, lastPhase = ''
    // German setup - AI or random
    const setupObs = env.getObservation(); (setupObs as any).raw = game.state
    const setupId = gerAI ? gerAI.selectGerman(setupObs).actionId! : randomPick(setupObs.actions)
    const setupAct = setupObs.actions.find((x: any) => x.id === setupId)
    if (setupAct) env.step(setupAct)
    steps++

    // British setup
    const r = doBritishSetup(game)
    if (!r.ok) { console.log(`SETUP FAIL: ${r.error}`); continue }
    steps++

    while (!game.state.gameOver && steps < 500) {
      const obs = env.getObservation(); (obs as any).raw = game.state
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
      if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
      if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) env.step(f); stuck = 0; continue }

      const isGerman = obs.activePlayer === 'german'
      const ai = isGerman ? gerAI : britAI
      let actionId: number | null = null
      if (ai) {
        const r = isGerman ? gerAI!.selectGerman(obs) : britAI!.selectBritish(obs)
        actionId = r.actionId
      }
      if (actionId == null) actionId = randomPick(obs.actions)
      const a = obs.actions.find((x: any) => x.id === actionId)
      if (a) env.step(a); else if (obs.actions.length > 0) env.step(obs.actions[0])
      steps++
    }
    if (game.state.winner === 'german') gerWins++
    else britWins++
    sumTurns += game.state.turn
    sumVpGer += game.state.vp.german
    sumVpBrit += game.state.vp.british
  }
  console.log(`${label}: 德${gerWins}胜 英${britWins}胜 (德${(gerWins/G*100).toFixed(0)}%) 均T${(sumTurns/games).toFixed(1)} VP德${(sumVpGer/games).toFixed(1)}/英${(sumVpBrit/games).toFixed(1)}`)
}

const defAI = createStateMachineAI(DEFAULT_WEIGHTS)
const v8GerAI = createStateMachineAI(V8_GERMAN_BEST)
const v8BritAI = createStateMachineAI(V8_GERMAN_BEST, 'off', 'off', V8_BRITISH_BEST)
const defBritAI = createStateMachineAI(DEFAULT_WEIGHTS, 'off', 'off', DEFAULT_WEIGHTS)

const G = 30
console.log(`权重对比 (${G}局/组, 新框架):\n`)

runGames(G, v8GerAI, null, 'V8德军 vs 随机英军  ')
runGames(G, defAI, null, '默认德军 vs 随机英军')
runGames(G, null, v8BritAI, '随机德军 vs V8英军  ')
runGames(G, null, defBritAI, '随机德军 vs 默认英军')
runGames(G, null, null, '随机德军 vs 随机英军')
