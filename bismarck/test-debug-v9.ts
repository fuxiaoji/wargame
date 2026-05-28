import { BismarckEnv } from './engine/env'
import { createStateMachineAI, DEFAULT_WEIGHTS } from './cli/state-machine'
import { V8_GERMAN_BEST } from './cli/presets'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'

function randomPick(actions: any[]): number {
  return actions[Math.floor(Math.random() * actions.length)].id
}

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

// 用默认权重 vs 乱打英军
const gerAI = createStateMachineAI(DEFAULT_WEIGHTS)
const env = new BismarckEnv()
const game = env.game

// German setup
const setupObs = env.getObservation(); (setupObs as any).raw = game.state
const setupId = gerAI.selectGerman(setupObs).actionId!
const setupAct = setupObs.actions.find((x: any) => x.id === setupId)
if (setupAct) env.step(setupAct)
console.log(`德军起始格: ${setupAct?.params?.targetLabel || '?'}`)

// British random setup
const r = doBritishSetup(game)
console.log(`英军初设: ${r.ok ? 'OK' : 'FAIL: '+r.error}`)

let steps = 0, stuck = 0, lastPhase = ''
const log: string[] = []

while (!game.state.gameOver && steps < 500) {
  const obs = env.getObservation(); (obs as any).raw = game.state
  if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
  if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
  if (stuck > 30) {
    const f = obs.actions.find((a: any) => a.type === 'finish-phase')
    if (f) { env.step(f); stuck = 0; continue }
  }

  const isGerman = obs.activePlayer === 'german'
  let actionId: number | null = null
  let strategy = ''
  if (isGerman) {
    const result = gerAI.selectGerman(obs, true)
    actionId = result.actionId
    strategy = (result as any).debug?.pickedStrategy || ''
  } else {
    actionId = randomPick(obs.actions)
  }
  if (actionId == null) actionId = randomPick(obs.actions)
  const a = obs.actions.find((x: any) => x.id === actionId)
  if (a) env.step(a); else if (obs.actions.length > 0) env.step(obs.actions[0])

  if (isGerman) {
    const s = game.state
    const bPos = s.germanPositions.get('bismarck')
    const ePos = s.germanPositions.get('prinz-eugen')
    log.push(`T${s.turn} ${s.phase.padEnd(16)} ${strategy.padEnd(6)} B:${bPos?`${String.fromCharCode(65+bPos.q)}${bPos.r}`:'?'} E:${ePos?`${String.fromCharCode(65+ePos.q)}${ePos.r}`:'?'} VP德${s.vp.german}/英${s.vp.british} found:${s.bismarckFound}`)
  }
  steps++
}

console.log(`\n结果: ${game.state.winner==='german'?'德军胜':'英军胜'} T${game.state.turn} VP德${game.state.vp.german}/英${game.state.vp.british}`)
console.log(game.state.victoryReason)
console.log(`\n德军行动:`)
log.forEach(l => console.log('  '+l))
