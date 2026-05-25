#!/usr/bin/env npx tsx
/** 评估 V3 训练个体 vs 默认权重 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI, DEFAULT_WEIGHTS } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'
import * as path from 'path'

const DATA = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v3')
const GAMES = 50

interface Result { ver: string; gen: number; side: string; idx: number; wins: number; total: number; style: string }

function gerStyle(w: any): string {
  const feats: string[] = []
  if (w.w12 < 0.3) feats.push('不躲')
  else if (w.w12 > 1.5) feats.push('躲藏')
  if (w.w1 > 6) feats.push('冲港狂')
  else if (w.w1 > 4) feats.push('冲港倾向')
  if (w.w5 > 3) feats.push('打工仔')
  if (w.w9 > 5) feats.push('猎手')
  if (w.temperature > 1.5) feats.push('高探索')
  if (w.temperature < 0.3) feats.push('贪心')
  return feats.length > 0 ? feats.join('·') : '均衡派'
}

function britStyle(w: any): string {
  if (w.s1 > 12) return '雷达兵'
  if (w.h1 > 12) return '猎犬'
  if (w.d1 > 6) return '守门员'
  if (w.d1 < 3) return '不守家'
  return '均衡派'
}

function setupBritish(env: BismarckEnv) {
  const s = env.game.state
  const used = new Set<string>(GERMAN_START_HEXES)
  for (const [hex, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) {
    used.add(hex)
    for (const id of shipIds) env.game.placeBritishToken(id, hex)
  }
  const dummyShip = { def: { speed: 2 }, steps: 2 } as any
  const reachable = new Set<string>()
  for (const label of GERMAN_START_HEXES) {
    const h = { q: label.charCodeAt(0)-65, r: parseInt(label.slice(1)) }
    if (h.q<0||h.q>=6||h.r<1||h.r>8) continue
    for (const l of getGermanReachableLabels(dummyShip, h)) { if (!used.has(l)) reachable.add(l) }
  }
  const placeFree=(isDummy:boolean)=>{
    for(const sh of s.britishShips){
      if(sh.def.isDummy!==isDummy||s.britishPositions.has(sh.def.id)) continue
      const avail=[...reachable].filter(h=>!used.has(h))
      if(avail.length>0){const p=avail[Math.floor(Math.random()*avail.length)]; env.game.placeBritishToken(sh.def.id,p); used.add(p)}
    }
  }
  placeFree(false); placeFree(true)
  const fb=['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for(const sh of s.britishShips) if(!s.britishPositions.has(sh.def.id)) env.game.placeBritishToken(sh.def.id,fb[Math.floor(Math.random()*fb.length)])
  env.game.finishSetup()
}

async function evalOne(gerW: any, britW: any, games: number): Promise<{gerWins: number}> {
  const gerAI = createStateMachineAI(gerW), britAI = createStateMachineAI(britW)
  let gerWins = 0
  for (let g = 0; g < games; g++) {
    const env = new BismarckEnv()
    let steps = 0
    while (!env.game.state.gameOver && steps < 500) {
      const obs = env.getObservation(); (obs as any).raw = env.game.state
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
      if (obs.phase === 'setup-british') { setupBritish(env); steps++; continue }
      const res = obs.activePlayer === 'german' ? gerAI.selectGerman(obs) : britAI.selectBritish(obs)
      if (res.actionId != null) { const a = obs.actions.find(x => x.id === res.actionId); if (a) env.step(a) }
      else if (obs.actions.length > 0) env.step(obs.actions[0])
      steps++
    }
    if (env.game.state.winner === 'german') gerWins++
  }
  return { gerWins }
}

async function main() {
  // 评估第19代 (最后一代)
  const gen = 19
  const genDir = path.join(DATA, `gen_${String(gen).padStart(3,'0')}`)
  const gerPop: any[] = JSON.parse(fs.readFileSync(path.join(genDir, 'ger_population.json'), 'utf-8'))
  const britPop: any[] = JSON.parse(fs.readFileSync(path.join(genDir, 'brit_population.json'), 'utf-8'))

  const baselineGer = DEFAULT_WEIGHTS
  const baselineBrit = DEFAULT_WEIGHTS

  // === 评估德军 (vs 默认英军) ===
  console.log('评估 V3 德军个体...')
  const gerResults: Result[] = []
  for (let i = 0; i < gerPop.length; i++) {
    process.stdout.write(`\r德军 #${i}/${gerPop.length}...`)
    const { gerWins } = await evalOne(gerPop[i], baselineBrit, GAMES)
    gerResults.push({ ver: 'V3', gen, side: '德军', idx: i, wins: gerWins, total: GAMES, style: gerStyle(gerPop[i]) })
  }
  console.log()

  // === 评估英军 (vs 默认德军) ===
  console.log('评估 V3 英军个体...')
  const britResults: Result[] = []
  for (let i = 0; i < britPop.length; i++) {
    process.stdout.write(`\r英军 #${i}/${britPop.length}...`)
    const { gerWins } = await evalOne(baselineGer, britPop[i], GAMES)
    britResults.push({ ver: 'V3', gen, side: '英军', idx: i, wins: GAMES - gerWins, total: GAMES, style: britStyle(britPop[i]) })
  }
  console.log()

  gerResults.sort((a, b) => (b.wins/b.total) - (a.wins/a.total))
  britResults.sort((a, b) => (b.wins/b.total) - (a.wins/a.total))

  // 输出
  console.log('\n===== V3 德军个体 (vs 默认英军) =====')
  console.log('| # | idx | 胜率 | 风格 | w1 | w5 | w12 | temp |')
  for (let i = 0; i < gerResults.length; i++) {
    const r = gerResults[i]; const w = gerPop[r.idx]
    console.log(`| ${i+1} | ${r.idx} | ${(r.wins/r.total*100).toFixed(0)}% | ${r.style} | ${w.w1.toFixed(1)} | ${w.w5.toFixed(1)} | ${w.w12.toFixed(1)} | ${w.temperature.toFixed(2)} |`)
  }

  console.log('\n===== V3 英军个体 (vs 默认德军) =====')
  console.log('| # | idx | 胜率 | 风格 | s1 | h1 | d1 |')
  for (let i = 0; i < britResults.length; i++) {
    const r = britResults[i]; const w = britPop[r.idx]
    console.log(`| ${i+1} | ${r.idx} | ${(r.wins/r.total*100).toFixed(0)}% | ${r.style} | ${w.s1.toFixed(1)} | ${w.h1.toFixed(1)} | ${w.d1.toFixed(1)} |`)
  }

  // 保存 JSON
  const outDir = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', '状态机个体')
  fs.writeFileSync(path.join(outDir, 'v3_eval_ger.json'), JSON.stringify(gerResults.map(r => ({...r, weights: gerPop[r.idx]}))))
  fs.writeFileSync(path.join(outDir, 'v3_eval_brit.json'), JSON.stringify(britResults.map(r => ({...r, weights: britPop[r.idx]}))))
  console.log(`\n评估结果已保存到 ${outDir}/v3_eval_*.json`)
}

main().catch(e => { console.error(e); process.exit(1) })
