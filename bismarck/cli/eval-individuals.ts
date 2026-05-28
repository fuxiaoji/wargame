#!/usr/bin/env npx tsx
/** 评估所有个体胜率 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'
import * as path from 'path'

const DATA = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', '状态机个体')
const GAMES = 50 // 每个个体打多少局

interface Result { ver: string; gen: number; side: string; idx: number; wins: number; total: number; style: string }

function gerStyle(w: any): string {
  const feats: string[] = []
  if (w.w12 < 0.3) feats.push('不躲')
  else if (w.w12 > 1.5) feats.push('躲藏')
  if (w.w1 > 3.5) feats.push('冲港狂')
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

async function evalOne(gerW: any, britW: any, games: number): Promise<{gerWins: number}> {
  const gerAI = createStateMachineAI(gerW), britAI = createStateMachineAI(britW)
  let gerWins = 0
  for (let g = 0; g < games; g++) {
    const env = new BismarckEnv()
    let steps = 0
    while (!env.game.state.gameOver && steps < 500) {
      const obs = env.getObservation(); (obs as any).raw = env.game.state
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break
      if (obs.phase === 'setup-british') {
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
        env.game.finishSetup(); steps++; continue
      }
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
  const { DEFAULT_WEIGHTS } = await import('./state-machine')
  const baselineGer = DEFAULT_WEIGHTS  // 默认德军
  const baselineBrit = DEFAULT_WEIGHTS // 默认英军

  // === 评估英军 (vs 默认德军) ===
  const allBrit: Result[] = []
  for (const ver of ['training_v1', 'training_v2']) {
    const gen = '019'
    const f = path.join(DATA, ver, `gen_${gen}`, 'brit_population.json')
    if (!fs.existsSync(f)) continue
    const pop = JSON.parse(fs.readFileSync(f, 'utf-8'))
    for (let i = 0; i < pop.length; i++) {
      process.stdout.write(`\r评估: ${ver} 英军#${i}...`)
      const { gerWins } = await evalOne(baselineGer, pop[i], GAMES)
      // gerWins 是德军胜场 → 英军胜率 = 1 - gerWins/GAMES
      allBrit.push({ ver, gen: 19, side: '英军', idx: i, wins: GAMES - gerWins, total: GAMES, style: britStyle(pop[i]) })
    }
  }
  allBrit.sort((a, b) => (b.wins/b.total) - (a.wins/a.total))

  console.log('\n===== 英军个体胜率排名 (vs 默认德军) =====')
  console.log('| # | 版本 | # | 胜率 | 风格 | s1 | h1 | d1 |')
  for (let i = 0; i < allBrit.length; i++) {
    const r = allBrit[i]
    const f = path.join(DATA, r.ver, `gen_019`, 'brit_population.json')
    const w = JSON.parse(fs.readFileSync(f, 'utf-8'))[r.idx]
    console.log(`| ${i+1} | ${r.ver} | ${r.idx} | ${(r.wins/r.total*100).toFixed(0)}% | ${r.style} | ${w.s1.toFixed(1)} | ${w.h1.toFixed(1)} | ${w.d1.toFixed(1)} |`)
  }
  console.log(`\n基线德军: 默认权重 | 每场${GAMES}局`)
}

main().catch(e => { console.error(e); process.exit(1) })
