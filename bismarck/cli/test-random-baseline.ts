#!/usr/bin/env npx tsx
/** 随机基线测试: V1-V4 优秀个体 vs 纯随机对手, 含传播A/B */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI, HEATMAP_CONFIG, PropMode } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const GAMES = 30
const BASE = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data')
const OUT = path.join(import.meta.dirname, '..', '..', 'test_results', '2026-05-25_random_baseline')
fs.mkdirSync(OUT, {recursive:true})

function setupBritish(env: BismarckEnv) {
  const s=env.game.state,used=new Set<string>(GERMAN_START_HEXES)
  for(const [hex,ids] of Object.entries(BRITISH_FIXED_POSITIONS)){used.add(hex);for(const id of ids)env.game.placeBritishToken(id,hex)}
  const R=new Set<string>(),dummyShip={def:{speed:2},steps:2}as any
  for(const l of GERMAN_START_HEXES){const h={q:l.charCodeAt(0)-65,r:parseInt(l.slice(1))};if(h.q<0||h.q>5||h.r<1||h.r>8)continue;for(const rl of getGermanReachableLabels(dummyShip,h)){if(!used.has(rl))R.add(rl)}}
  const pf=(d:boolean)=>{for(const sh of s.britishShips){if(sh.def.isDummy!==d||s.britishPositions.has(sh.def.id))continue;const a=[...R].filter(h=>!used.has(h));if(a.length){const p=a[Math.floor(Math.random()*a.length)];env.game.placeBritishToken(sh.def.id,p);used.add(p)}}}
  pf(false);pf(true);const fb=['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for(const sh of s.britishShips)if(!s.britishPositions.has(sh.def.id))env.game.placeBritishToken(sh.def.id,fb[Math.floor(Math.random()*fb.length)])
  env.game.finishSetup()
}

function randomSelect(obs: any): number | null {
  if (obs.actions.length === 0) return null
  return obs.actions[Math.floor(Math.random() * obs.actions.length)].id
}

async function runOne(gerW:any,britW:any,gerSmart:boolean,britSmart:boolean,mode:PropMode,n:number):Promise<number>{
  HEATMAP_CONFIG.propagated = mode
  const ga=gerSmart?createStateMachineAI(gerW,mode,mode):null
  const ba=britSmart?createStateMachineAI(britW,mode,mode):null
  let gw=0
  for(let g=0;g<n;g++){const e=new BismarckEnv();let s=0,st=0,ls=''
    while(!e.game.state.gameOver&&s<500){const o=e.getObservation()
      if(o.phase!=='setup-british'&&o.actions.length===0)break
      if(o.phase===ls)st++;else{st=0;ls=o.phase}
      if(st>15){const f=o.actions.find(a=>a.type==='finish-phase');if(f){e.step(f);st=0;continue}}
      if(o.phase==='setup-british'){setupBritish(e);s++;continue}
      const rid=gerSmart?(ga!.selectGerman(o).actionId):britSmart?(ba!.selectBritish(o).actionId):null
      const r=o.activePlayer==='german'?(gerSmart?rid:randomSelect(o)):(britSmart?rid:randomSelect(o))
      if(r!=null){const a=o.actions.find(x=>x.id===r);if(a)e.step(a)}else if(o.actions.length>0)e.step(o.actions[0])
      s++}
    if(e.game.state.winner==='german')gw++}
  return gw/n
}

async function main(){
  // Load individuals directly
  const load=(sub:string,gen:string,side:string,idx:number)=>JSON.parse(fs.readFileSync(path.join(BASE,sub,gen,`${side}_population.json`),'utf-8'))[idx]
  const entry:{v:string,gerW:any,britW:any}[] = [
    {v:'V1',gerW:load('状态机个体/training_v1','gen_019','ger',1),britW:load('状态机个体/training_v1','gen_019','brit',1)},
    {v:'V2',gerW:load('状态机个体/training_v2','gen_019','ger',6),britW:load('状态机个体/training_v2','gen_019','brit',6)},
    {v:'V3',gerW:load('training_v3','gen_019','ger',0),britW:load('training_v3','gen_019','brit',0)},
    {v:'V4',gerW:load('training_v4','gen_009','ger',0),britW:load('training_v4','gen_009','brit',0)},
  ]

  const modes:[PropMode,string][] = [['off','无传播'],['neg','仅负值传播']]
  const results:any[]=[]

  for(const e of entry){
    for(const [mode,mlabel] of modes){
      const gs = await runOne(e.gerW, e.britW, true, false, mode, GAMES)
      const bs = await runOne(e.gerW, e.britW, false, true, mode, GAMES)
      results.push({v:e.v,mode:mlabel,gerSmartWR:gs,britSmartWR:bs})
      console.log(`${e.v} ${mlabel}: 德smart vs 英random=${(gs*100).toFixed(0)}% | 德random vs 英smart=${(bs*100).toFixed(0)}%`)
    }
  }

  // Write report
  const lines:string[]=[]
  lines.push('# 随机基线测试', '')
  lines.push(`各${GAMES}局, V1-V4优秀个体 vs 纯随机对手`, '')
  lines.push('## 德军（smart）vs 英军（random）', '', '> 德军胜率越高=德军AI越强', '')
  lines.push('| 版本 | 无传播 | 仅负值传播 |')
  lines.push('|------|--------|-----------|')
  for(const v of ['V1','V2','V3','V4']){
    const r0=results.find(r=>r.v===v&&r.mode==='无传播')
    const r1=results.find(r=>r.v===v&&r.mode==='仅负值传播')
    lines.push(`| ${v} | ${r0?((r0.gerSmartWR*100).toFixed(0)+'%'):'-'} | ${r1?((r1.gerSmartWR*100).toFixed(0)+'%'):'-'} |`)
  }
  lines.push('','## 德军（random）vs 英军（smart）', '', '> 德军胜率越低=英军AI越强', '')
  lines.push('| 版本 | 无传播 | 仅负值传播 |')
  lines.push('|------|--------|-----------|')
  for(const v of ['V1','V2','V3','V4']){
    const r0=results.find(r=>r.v===v&&r.mode==='无传播')
    const r1=results.find(r=>r.v===v&&r.mode==='仅负值传播')
    lines.push(`| ${v} | ${r0?((r0.britSmartWR*100).toFixed(0)+'%'):'-'} | ${r1?((r1.britSmartWR*100).toFixed(0)+'%'):'-'} |`)
  }
  lines.push('','> 数值=德军胜率。德smart vs 英random 越高=德军AI越强。德random vs 英smart 越低=英军AI越强。')

  fs.writeFileSync(path.join(OUT,'report.md'),lines.join('\n'))
  fs.writeFileSync(path.join(OUT,'raw_data.json'),JSON.stringify(results,null,2))
  console.log('\nSaved to',OUT)
}

main().catch(e=>{console.error(e);process.exit(1)})
