import { BismarckEnv } from './engine/env'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import * as fs from 'fs'

// Load weights
const gerPop1 = JSON.parse(fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_001/ger_population.json', 'utf-8'))
const gerPop3 = JSON.parse(fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_003/ger_population.json', 'utf-8'))
const britPop3 = JSON.parse(fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_003/brit_population.json', 'utf-8'))

// Find best/worst from pair results
import * as glob from 'fs'

function findBritRank(gen: string) {
  const britWR: Record<number, {w:number,t:number}> = {}
  const dir = `/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_${gen}/results/`
  for (const fn of fs.readdirSync(dir)) {
    if (!fn.startsWith('pair_g') || fn.includes('b-1') || fn.includes('g-1')) continue
    const parts = fn.replace('pair_g','').replace('.json','').split('_b')
    const bi = parseInt(parts[1])
    const games = JSON.parse(fs.readFileSync(dir+fn, 'utf-8'))
    const bw = games.filter((g:any) => g.britWins > 0).length
    if (!britWR[bi]) britWR[bi] = {w:0, t:0}
    britWR[bi].w += bw; britWR[bi].t += games.length
  }
  return Object.entries(britWR).map(([bi,d]) => ({bi:parseInt(bi), wr:d.w/d.t})).sort((a,b) => b.wr - a.wr)
}

const britRank3 = findBritRank('003')
console.log('Gen3 英军排名:')
britRank3.forEach(b => console.log(`  #${b.bi}: ${(b.wr*100).toFixed(0)}%`))
const worstBrit3 = britRank3[britRank3.length-1]
console.log(`最弱英军: #${worstBrit3.bi} (${(worstBrit3.wr*100).toFixed(0)}%)`)

// Find best Germans
function findGerRank(gen: string) {
  const gerWR: Record<number, {w:number,t:number}> = {}
  const dir = `/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11/gen_${gen}/results/`
  for (const fn of fs.readdirSync(dir)) {
    if (!fn.startsWith('pair_g') || fn.includes('b-1') || fn.includes('g-1')) continue
    const parts = fn.replace('pair_g','').replace('.json','').split('_b')
    const gi = parseInt(parts[0])
    const games = JSON.parse(fs.readFileSync(dir+fn, 'utf-8'))
    const gw = games.filter((g:any) => g.gerWins > 0).length
    if (!gerWR[gi]) gerWR[gi] = {w:0, t:0}
    gerWR[gi].w += gw; gerWR[gi].t += games.length
  }
  return Object.entries(gerWR).map(([gi,d]) => ({gi:parseInt(gi), wr:d.w/d.t})).sort((a,b) => b.wr - a.wr)
}

const gerRank1 = findGerRank('001')
const gerRank3 = findGerRank('003')
const bestGer1 = gerRank1[0]
const bestGer3 = gerRank3[0]
console.log(`\nGen1 最强德军: #${bestGer1.gi} (${(bestGer1.wr*100).toFixed(0)}%)`)
console.log(`Gen3 最强德军: #${bestGer3.gi} (${(bestGer3.wr*100).toFixed(0)}%)`)

// Run games
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

function runMatch(label: string, gerW: any, britW: any, games: number) {
  let gerWins = 0, britWins = 0, sumT = 0
  for (let g = 0; g < games; g++) {
    const ai = createStateMachineAI(gerW, 'off', 'off', britW)
    const env = new BismarckEnv()
    const game = env.game
    const setupObs = env.getObservation(); (setupObs as any).raw = game.state
    const setupId = ai.selectGerman(setupObs).actionId!
    const a = setupObs.actions.find((x: any) => x.id === setupId)
    if (a) env.step(a)
    doBritishSetup(game)
    let steps = 0, stuck = 0, lastPhase = ''
    while (!game.state.gameOver && steps < 500) {
      const obs = env.getObservation(); (obs as any).raw = game.state
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
      if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
      if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) { env.step(f); stuck = 0; continue } }
      const isGerman = obs.activePlayer === 'german'
      const r = isGerman ? ai.selectGerman(obs) : ai.selectBritish(obs)
      const aid = r.actionId ?? obs.actions[Math.floor(Math.random() * obs.actions.length)]?.id
      const act = obs.actions.find((x: any) => x.id === aid)
      if (act) env.step(act)
      steps++
    }
    if (game.state.winner === 'german') gerWins++; else britWins++
    sumT += game.state.turn
  }
  console.log(`${label}: 德${gerWins}胜 英${britWins}胜 (德${(gerWins/games*100).toFixed(0)}%) 均T${(sumT/games).toFixed(1)}`)
}

const G = 100
console.log(`\n=== 交叉对战 ${G}局 ===`)
const britWorst3W = britPop3[worstBrit3.bi]
const gerBest1W = gerPop1[bestGer1.gi]
const gerBest3W = gerPop3[bestGer3.gi]

runMatch(`Gen1最强德#${bestGer1.gi} vs Gen3最弱英#${worstBrit3.bi}`, gerBest1W, britWorst3W, G)
runMatch(`Gen3最强德#${bestGer3.gi} vs Gen3最弱英#${worstBrit3.bi}`, gerBest3W, britWorst3W, G)
