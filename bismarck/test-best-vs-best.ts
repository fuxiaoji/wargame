import { BismarckEnv } from './engine/env'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import * as fs from 'fs'

// Load weights
const gerPop1 = JSON.parse(fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_001/ger_population.json', 'utf-8'))
const britPop4 = JSON.parse(fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_004/brit_population.json', 'utf-8'))

// Gen1 best German #9 vs Gen4 best British #15
const gerW = gerPop1[9]
const britW = britPop4[15]

function doBritishSetup(game: any) {
  const s = game.state
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
    for (const l of getGermanReachableLabels(dummyShip as any, h)) {
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

const G = 100
let gerWins = 0, britWins = 0, sumTurns = 0, sumVpGer = 0, sumVpBrit = 0

for (let g = 0; g < G; g++) {
  const ai = createStateMachineAI(gerW, 'off', 'off', britW)
  const env = new BismarckEnv()
  const game = env.game

  const setupObs = env.getObservation(); (setupObs as any).raw = game.state
  const setupId = ai.selectGerman(setupObs).actionId!
  const setupAct = setupObs.actions.find((x: any) => x.id === setupId)
  if (setupAct) env.step(setupAct)
  doBritishSetup(game)

  let steps = 0, stuck = 0, lastPhase = ''
  while (!game.state.gameOver && steps < 500) {
    const obs = env.getObservation(); (obs as any).raw = game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
    if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) { env.step(f); stuck = 0; continue } }

    const isGerman = obs.activePlayer === 'german'
    const r = isGerman ? ai.selectGerman(obs) : ai.selectBritish(obs)
    const actionId = r.actionId ?? obs.actions[Math.floor(Math.random() * obs.actions.length)]?.id
    const a = obs.actions.find((x: any) => x.id === actionId)
    if (a) env.step(a)
    steps++
  }
  if (game.state.winner === 'german') gerWins++
  else britWins++
  sumTurns += game.state.turn
  sumVpGer += game.state.vp.german
  sumVpBrit += game.state.vp.british
}

console.log(`Gen1最佳德军#9 vs Gen4最佳英军#15 (${G}局):`)
console.log(`德军 ${gerWins}胜 英军 ${britWins}胜 (德军 ${(gerWins/G*100).toFixed(0)}%)`)
console.log(`均T${(sumTurns/G).toFixed(1)} VP德${(sumVpGer/G).toFixed(1)}/英${(sumVpBrit/G).toFixed(1)}`)
