import { BismarckEnv } from './engine/env'
import { createYanfuAI } from './cli/state-machine-yanfu'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import * as fs from 'fs'

const baseDir = '/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11'
const gens = fs.readdirSync(baseDir).filter(d => d.startsWith('gen_')).sort()
const baseW = JSON.parse(fs.readFileSync(`${baseDir}/${gens[0]}/ger_population.json`, 'utf-8'))[0]

// Build opponent list
interface Opponent { name: string; weights: any; isRandom: boolean }
const gerOpps: Opponent[] = [{ name: '乱打德军', weights: baseW, isRandom: true }, { name: '基准德军', weights: baseW, isRandom: false }]
const britOpps: Opponent[] = [{ name: '乱打英军', weights: baseW, isRandom: true }, { name: '基准英军', weights: baseW, isRandom: false }]

for (const gen of gens.slice(0, 5)) {
  const gerPop = JSON.parse(fs.readFileSync(`${baseDir}/${gen}/ger_population.json`, 'utf-8'))
  const britPop = JSON.parse(fs.readFileSync(`${baseDir}/${gen}/brit_population.json`, 'utf-8'))
  const resDir = `${baseDir}/${gen}/results/`
  const gerWR: Record<number,{w:number,t:number}> = {}; const britWR: Record<number,{w:number,t:number}> = {}
  for (const fn of fs.readdirSync(resDir)) {
    if (!fn.startsWith('pair_g') || fn.includes('b-1') || fn.includes('g-1')) continue
    const parts = fn.replace('pair_g','').replace('.json','').split('_b')
    const gi = parseInt(parts[0]); const bi = parseInt(parts[1])
    const games = JSON.parse(fs.readFileSync(resDir+fn, 'utf-8'))
    if (!gerWR[gi]) gerWR[gi] = {w:0,t:0}
    if (!britWR[bi]) britWR[bi] = {w:0,t:0}
    gerWR[gi].w += games.filter((g:any)=>g.gerWins>0).length; gerWR[gi].t += games.length
    britWR[bi].w += games.filter((g:any)=>g.britWins>0).length; britWR[bi].t += games.length
  }
  const gerTop = Object.entries(gerWR).map(([gi,d]) => ({idx:parseInt(gi), wr:d.w/d.t})).sort((a,b)=>b.wr-a.wr).slice(0,3)
  const britTop = Object.entries(britWR).map(([bi,d]) => ({idx:parseInt(bi), wr:d.w/d.t})).sort((a,b)=>b.wr-a.wr).slice(0,3)
  for (const g of gerTop) gerOpps.push({ name: `${gen}德#${g.idx}`, weights: gerPop[g.idx], isRandom: false })
  for (const b of britTop) britOpps.push({ name: `${gen}英#${b.idx}`, weights: britPop[b.idx], isRandom: false })
}

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

const mode = process.argv[2] // 'ger' or 'brit'
const opps = mode === 'ger' ? britOpps : gerOpps
const yanfuAI = createYanfuAI()
const G = 100
const outDir = `/tmp/yanfu_full`; fs.mkdirSync(outDir, { recursive: true })

const oppIdx = parseInt(process.argv[3] || '0')
const opp = opps[oppIdx]
if (!opp) { console.log(`Invalid idx ${oppIdx}/${opps.length}`); process.exit(1) }

let yanfuWins = 0, oppWins = 0
for (let g = 0; g < G; g++) {
  const env = new BismarckEnv(); const game = env.game
  const smAI = opp.isRandom ? null : createStateMachineAI(opp.weights, 'off', 'off', opp.weights)

  const setupObs = env.getObservation(); (setupObs as any).raw = game.state
  let setupR: any
  if (mode === 'ger') { setupR = yanfuAI.selectGerman(setupObs) }
  else { setupR = smAI?.selectGerman(setupObs) ?? { actionId: setupObs.actions[Math.floor(Math.random()*setupObs.actions.length)]?.id } }
  const setupAct = setupObs.actions.find((x: any) => x.id === setupR.actionId)
  if (setupAct) env.step(setupAct)
  doBritishSetup(game)

  let steps = 0, stuck = 0, lastPhase = ''
  while (!game.state.gameOver && steps < 500) {
    const obs = env.getObservation(); (obs as any).raw = game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
    if (obs.phase === lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 30) { const f = obs.actions.find((a: any) => a.type === 'finish-phase'); if (f) { env.step(f); stuck = 0; continue } }
    const isGerman = obs.activePlayer === 'german'
    let r: any
    if (mode === 'ger') {
      r = isGerman ? yanfuAI.selectGerman(obs) : (opp.isRandom ? { actionId: obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id } : smAI!.selectBritish(obs))
    } else {
      r = isGerman ? (opp.isRandom ? { actionId: obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id } : smAI!.selectGerman(obs)) : yanfuAI.selectBritish(obs)
    }
    const aid = r.actionId ?? obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id
    const act = obs.actions.find((x: any) => x.id === aid)
    if (act) env.step(act)
    steps++
  }

  const yanfuWinner = mode === 'ger' ? (game.state.winner === 'german') : (game.state.winner === 'british')
  if (yanfuWinner) yanfuWins++; else oppWins++
}

fs.writeFileSync(`${outDir}/${mode}_${oppIdx}.json`, JSON.stringify({ opp: opp.name, yanfuWins, oppWins, total: G }))
console.log(`Done: 严父${mode==='ger'?'德':'英'} vs ${opp.name}: ${yanfuWins}/${G}=${(yanfuWins/G*100).toFixed(0)}%`)
