import { BismarckEnv } from './engine/env'
import { createStateMachineAI } from './cli/state-machine'
import { GERMAN_START_HEXES } from './engine/map'
import { BRITISH_FIXED_POSITIONS } from './engine/setup'
import { getGermanReachableLabels } from './engine/movement'
import * as fs from 'fs'

const baseDir = '/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v11'
const outDir = '/tmp/v11_cross'
fs.mkdirSync(outDir, { recursive: true })

const germans: { name: string; weights: any; isRandom: boolean }[] = []
const british: { name: string; weights: any; isRandom: boolean }[] = []

// Base defaults
const baseW = JSON.parse(fs.readFileSync(`${baseDir}/gen_000/ger_population.json`, 'utf-8'))[0]
germans.push({ name: '基准德军', weights: baseW, isRandom: false })
british.push({ name: '基准英军', weights: baseW, isRandom: false })
germans.push({ name: '乱打德军', weights: null, isRandom: true })
british.push({ name: '乱打英军', weights: null, isRandom: true })

for (let gen = 0; gen < 5; gen++) {
  const gerPop = JSON.parse(fs.readFileSync(`${baseDir}/gen_00${gen}/ger_population.json`, 'utf-8'))
  const britPop = JSON.parse(fs.readFileSync(`${baseDir}/gen_00${gen}/brit_population.json`, 'utf-8'))
  const resDir = `${baseDir}/gen_00${gen}/results/`
  const gerWR: Record<number, {w:number,t:number}> = {}
  const britWR: Record<number, {w:number,t:number}> = {}
  for (const fn of fs.readdirSync(resDir)) {
    if (!fn.startsWith('pair_g') || fn.includes('b-1') || fn.includes('g-1')) continue
    const parts = fn.replace('pair_g','').replace('.json','').split('_b')
    const gi = parseInt(parts[0]); const bi = parseInt(parts[1])
    const games = JSON.parse(fs.readFileSync(resDir+fn, 'utf-8'))
    if (!gerWR[gi]) gerWR[gi] = {w:0, t:0}
    if (!britWR[bi]) britWR[bi] = {w:0, t:0}
    gerWR[gi].w += games.filter((g:any) => g.gerWins > 0).length
    gerWR[gi].t += games.length
    britWR[bi].w += games.filter((g:any) => g.britWins > 0).length
    britWR[bi].t += games.length
  }
  const gerTop = Object.entries(gerWR).map(([gi,d]) => ({gi:parseInt(gi), wr:d.w/d.t})).sort((a,b) => b.wr - a.wr).slice(0,3)
  const britTop = Object.entries(britWR).map(([bi,d]) => ({bi:parseInt(bi), wr:d.w/d.t})).sort((a,b) => b.wr - a.wr).slice(0,3)
  for (const g of gerTop) germans.push({ name: `G${gen}#${g.gi}`, weights: gerPop[g.gi], isRandom: false })
  for (const b of britTop) british.push({ name: `G${gen}#${b.bi}`, weights: britPop[b.bi], isRandom: false })
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
      game.placeBritishToken(sh.def.id, avail[Math.floor(Math.random() * avail.length)]); used.add(avail[0])
    }
  }
  const fallback = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips)
    if (!s.britishPositions.has(sh.def.id))
      game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random()*fallback.length)])
  return game.finishSetup()
}

const gerIdx = parseInt(process.argv[2] || '0')
const ger = germans[gerIdx]
if (!ger) { console.log('Invalid index'); process.exit(1) }

const GAMES = 20
const results: {ger:string, brit:string, gerWins:number, britWins:number}[] = []

for (let bi = 0; bi < british.length; bi++) {
  const brit = british[bi]
  let gerW = 0, britW = 0
  for (let g = 0; g < GAMES; g++) {
    const ai = ger.isRandom ? null : createStateMachineAI(ger.weights, 'off', 'off', brit.weights)
    const britOnlyAi = brit.isRandom ? null : createStateMachineAI(baseW, 'off', 'off', brit.weights)
    const env = new BismarckEnv()
    const game = env.game
    const setupObs = env.getObservation(); (setupObs as any).raw = game.state
    let setupId: number
    if (ger.isRandom) {
      setupId = setupObs.actions[Math.floor(Math.random() * setupObs.actions.length)].id
    } else {
      setupId = ai!.selectGerman(setupObs).actionId!
    }
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
      let actionId: number
      if (isGerman && ger.isRandom) {
        actionId = obs.actions[Math.floor(Math.random() * obs.actions.length)].id
      } else if (!isGerman && brit.isRandom) {
        actionId = obs.actions[Math.floor(Math.random() * obs.actions.length)].id
      } else {
        const r = isGerman ? ai?.selectGerman(obs) : britOnlyAi?.selectBritish(obs)
        actionId = r?.actionId ?? obs.actions[Math.floor(Math.random() * obs.actions.length)]?.id
      }
      const act = obs.actions.find((x: any) => x.id === actionId)
      if (act) env.step(act)
      steps++
    }
    if (game.state.winner === 'german') gerW++; else britW++
  }
  results.push({ ger: ger.name, brit: brit.name, gerWins: gerW, britWins: britW })
}

fs.writeFileSync(`${outDir}/ger_${gerIdx}.json`, JSON.stringify(results))
console.log(`Done: ${ger.name} (${gerIdx}/${germans.length})`)
