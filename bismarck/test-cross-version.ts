import { BismarckEnv } from './engine/env'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import { V8_GERMAN_BEST, V8_BRITISH_BEST } from './cli/presets'
import * as fs from 'fs'

const baseDir = '/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data'

// Load top weights from each version
function loadBest(version: string, side: 'ger'|'brit', topN=1) {
  const popDir = `${baseDir}/training_${version}`
  const gens = fs.readdirSync(popDir).filter(d => d.startsWith('gen_')).sort()
  const lastGen = gens[gens.length-1]
  const popFile = `${popDir}/${lastGen}/${side === 'ger' ? 'ger' : 'brit'}_population.json`
  if (!fs.existsSync(popFile)) return []

  const pop = JSON.parse(fs.readFileSync(popFile, 'utf-8'))

  // Find top by co-evolved WR
  const wrMap: Record<number,{w:number,t:number}> = {}
  const resDir = `${popDir}/${lastGen}/results/`
  if (fs.existsSync(resDir)) {
    for (const fn of fs.readdirSync(resDir)) {
      if (!fn.startsWith('pair_g') || fn.includes('b-1') || fn.includes('g-1')) continue
      const parts = fn.replace('pair_g','').replace('.json','').split('_b')
      const gi = parseInt(parts[0]); const bi = parseInt(parts[1])
      const games = JSON.parse(fs.readFileSync(resDir+fn, 'utf-8'))
      if (side === 'ger') {
        if (!wrMap[gi]) wrMap[gi] = {w:0,t:0}
        wrMap[gi].w += games.filter((g:any)=>g.gerWins>0).length
        wrMap[gi].t += games.length
      } else {
        if (!wrMap[bi]) wrMap[bi] = {w:0,t:0}
        wrMap[bi].w += games.filter((g:any)=>g.britWins>0).length
        wrMap[bi].t += games.length
      }
    }
  }

  const ranked = Object.entries(wrMap).map(([idx,d]) => ({idx:parseInt(idx), wr:d.w/d.t})).sort((a,b)=>b.wr-a.wr)
  return ranked.slice(0, topN).map(r => ({
    name: `${version}${side==='ger'?'德':'英'}#${r.idx}`,
    weights: pop[r.idx],
  }))
}

// Collect players
const germans: {name:string, weights:any}[] = []
const british: {name:string, weights:any}[] = []

// V8 presets
germans.push({name: 'V8德预设', weights: V8_GERMAN_BEST})
british.push({name: 'V8英预设', weights: V8_BRITISH_BEST})

// V11 top-3
for (const g of loadBest('v11', 'ger', 3)) germans.push(g)
for (const b of loadBest('v11', 'brit', 3)) british.push(b)

// V10 top-1
for (const g of loadBest('v10', 'ger', 1)) germans.push(g)
for (const b of loadBest('v10', 'brit', 1)) british.push(b)

// V8 last gen top-1
for (const g of loadBest('v8', 'ger', 1)) germans.push(g)
for (const b of loadBest('v8', 'brit', 1)) british.push(b)

// V7 top-1
for (const g of loadBest('v7', 'ger', 1)) germans.push(g)
for (const b of loadBest('v7', 'brit', 1)) british.push(b)

// V3 top-1
for (const g of loadBest('v3', 'ger', 1)) germans.push(g)
for (const b of loadBest('v3', 'brit', 1)) british.push(b)

// Base defaults
const baseW = germans[0].weights // Use first as template, but actually all defaults same
// Actually, base weights are the struct defaults. Let me create them from any pop[0]

console.log(`德军: ${germans.map(g=>g.name).join(', ')}`)
console.log(`英军: ${british.map(b=>b.name).join(', ')}`)
console.log(`共 ${germans.length}×${british.length}×10局 = ${germans.length*british.length*10} 局\n`)

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
      game.placeBritishToken(sh.def.id, avail[Math.floor(Math.random() * avail.length)]); used.add(avail[0])
    }
  }
  const fallback = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips)
    if (!s.britishPositions.has(sh.def.id))
      game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random()*fallback.length)])
  return game.finishSetup()
}

const G = 10
const gerIdx = parseInt(process.argv[2] || '0')
const ger = germans[gerIdx]
if (!ger) { console.log('Invalid ger index'); process.exit(1) }

const results: {ger:string, brit:string, gerWins:number, britWins:number}[] = []

for (const brit of british) {
  let gerW = 0, britW = 0
  for (let g = 0; g < G; g++) {
    const ai = createStateMachineAI(ger.weights, 'off', 'off', brit.weights)
    const env = new BismarckEnv(); const game = env.game
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
      const aid = r.actionId ?? obs.actions[Math.floor(Math.random()*obs.actions.length)]?.id
      const act = obs.actions.find((x: any) => x.id === aid)
      if (act) env.step(act)
      steps++
    }
    if (game.state.winner === 'german') gerW++; else britW++
  }
  results.push({ ger: ger.name, brit: brit.name, gerWins: gerW, britWins: britW })
}

const outDir = '/tmp/v11_cross_ver'
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(`${outDir}/ger_${gerIdx}.json`, JSON.stringify(results))
console.log(`Done: ${ger.name}`)
