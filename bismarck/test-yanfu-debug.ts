import { BismarckEnv } from './engine/env'
import { createYanfuAI } from './cli/state-machine-yanfu'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import * as fs from 'fs'

const baseDir = '/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11'
const gens = fs.readdirSync(baseDir).filter(d => d.startsWith('gen_')).sort()
const gen = gens[0]
const gerPop = JSON.parse(fs.readFileSync(`${baseDir}/${gen}/ger_population.json`, 'utf-8'))
const britPop = JSON.parse(fs.readFileSync(`${baseDir}/${gen}/brit_population.json`, 'utf-8'))

// Use gen_004 British #3 (strongest vs Yanfu, only 50% win rate for Yanfu)
const oppWeights = JSON.parse(fs.readFileSync(`${baseDir}/gen_004/brit_population.json`, 'utf-8'))[3]

const yanfuAI = createYanfuAI()
const smAI = createStateMachineAI(oppWeights, 'off', 'off', oppWeights)

function doBritishSetup(game: any) {
  const s = game.state; const used = new Set<string>(GERMAN_START_HEXES)
  for (const [hex, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) { used.add(hex); for (const id of shipIds) game.placeBritishToken(id, hex) }
  const dummyShip = { def: { speed: 2 }, steps: 2 } as any; const reachable = new Set<string>()
  for (const label of GERMAN_START_HEXES) {
    const h = { q: label.charCodeAt(0) - 65, r: parseInt(label.slice(1)) }
    if (h.q < 0 || h.q >= 6 || h.r < 1 || h.r > 8) continue
    for (const l of getGermanReachableLabels(dummyShip as any, h)) { if (!used.has(l)) reachable.add(l) }
  }
  for (const sh of s.britishShips) {
    if (s.britishPositions.has(sh.def.id)) continue
    const avail = [...reachable].filter(h => !used.has(h))
    if (avail.length > 0) { game.placeBritishToken(sh.def.id, avail[Math.floor(Math.random()*avail.length)]); used.add(avail[0]) }
  }
  const fallback = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips) if (!s.britishPositions.has(sh.def.id)) game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random()*fallback.length)])
  return game.finishSetup()
}

// Run until we find a Yanfu German loss
for (let attempt = 0; attempt < 30; attempt++) {
  const env = new BismarckEnv(); const game = env.game
  const setupObs = env.getObservation(); (setupObs as any).raw = game.state
  const setupR = yanfuAI.selectGerman(setupObs)
  const setupAct = setupObs.actions.find((x: any) => x.id === setupR.actionId)
  if (setupAct) env.step(setupAct)
  doBritishSetup(game)

  let steps = 0, stuck = 0, lastPhase = ''
  const log: string[] = []
  while (!game.state.gameOver && steps < 500) {
    const obs = env.getObservation(); (obs as any).raw = game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
    if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) { env.step(f); stuck = 0; continue } }
    const isGerman = obs.activePlayer === 'german'
    const r = isGerman ? yanfuAI.selectGerman(obs) : smAI.selectBritish(obs)
    const aid = r.actionId ?? obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id
    const act = obs.actions.find((x: any) => x.id === aid)

    const s = game.state
    const bPos = s.germanPositions.get('bismarck')
    const ePos = s.germanPositions.get('prinz-eugen')
    const bLabel = bPos ? `${String.fromCharCode(65+bPos.q)}${bPos.r}` : '?'
    const eLabel = ePos ? `${String.fromCharCode(65+ePos.q)}${ePos.r}` : '?'
    log.push(`T${s.turn.toString().padStart(2)} ${s.phase.padEnd(16)} ${r.rawResponse.padEnd(20)} B:${bLabel} E:${eLabel} VP德${s.vp.german}/英${s.vp.british}`)

    if (act) env.step(act)
    steps++
  }

  if (game.state.winner !== 'german') {
    console.log(`=== 严父德军 败局 (vs gen_004英#3, attempt=${attempt}) ===`)
    console.log(`结果: ${game.state.winner==='german'?'德军胜':'英军胜'} T${game.state.turn} VP德${game.state.vp.german}/英${game.state.vp.british}`)
    console.log(game.state.victoryReason)
    console.log()
    log.forEach(l => console.log(l))
    process.exit(0)
  }
}
console.log('未找到败局!')
