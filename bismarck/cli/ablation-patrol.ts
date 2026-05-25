#!/usr/bin/env npx tsx
/** 消融实验：Patrol 策略是否提升了英军胜率 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES, hexNeighbors, hexToLabel } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4', 'gen_009')
const GAMES = 50

function setupBritish(env: BismarckEnv) {
  const s=env.game.state,used=new Set<string>(GERMAN_START_HEXES)
  for(const [hex,ids] of Object.entries(BRITISH_FIXED_POSITIONS)){used.add(hex);for(const id of ids)env.game.placeBritishToken(id,hex)}
  const R=new Set<string>(),dummyShip={def:{speed:2},steps:2}as any
  for(const l of GERMAN_START_HEXES){const h={q:l.charCodeAt(0)-65,r:parseInt(l.slice(1))};if(h.q<0||h.q>5||h.r<1||h.r>8)continue;for(const rl of getGermanReachableLabels(dummyShip,h)){if(!used.has(rl))R.add(rl)}}
  const pf=(d:boolean)=>{for(const sh of s.britishShips){if(sh.def.isDummy!==d||s.britishPositions.has(sh.def.id))continue;const a=[...R].filter(h=>!used.has(h));if(a.length){const p=a[Math.floor(Math.random()*a.length)];env.game.placeBritishToken(sh.def.id,p);used.add(p)}}}
  pf(false);pf(true)
  const fb=['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for(const sh of s.britishShips)if(!s.britishPositions.has(sh.def.id))env.game.placeBritishToken(sh.def.id,fb[Math.floor(Math.random()*fb.length)])
  env.game.finishSetup()
}

async function evalPair(gerW:any,britW:any,n:number):Promise<number>{
  const ga=createStateMachineAI(gerW),ba=createStateMachineAI(britW);let gw=0
  for(let g=0;g<n;g++){const e=new BismarckEnv();let s=0,st=0,ls=''
    while(!e.game.state.gameOver&&s<500){const o=e.getObservation()
      if(o.phase!=='setup-british'&&o.actions.length===0)break
      if(o.phase===ls)st++;else{st=0;ls=o.phase}
      if(st>15){const f=o.actions.find(a=>a.type==='finish-phase');if(f){e.step(f);st=0;continue}}
      if(o.phase==='setup-british'){setupBritish(e);s++;continue}
      const r=o.activePlayer==='german'?ga.selectGerman(o):ba.selectBritish(o)
      if(r.actionId!=null){const a=o.actions.find(x=>x.id===r.actionId);if(a)e.step(a)}else if(o.actions.length>0)e.step(o.actions[0])
      s++}
    if(e.game.state.winner==='german')gw++}
  return gw/n
}

async function main(){
  const gerPop=JSON.parse(fs.readFileSync(path.join(V4,'ger_population.json'),'utf-8'))
  const britPop=JSON.parse(fs.readFileSync(path.join(V4,'brit_population.json'),'utf-8'))
  // 无 Patrol 版: 复制权重，p1=p2=p3=0
  const britNoPatrol=britPop.map((w:any)=>({...w,p1:0,p2:0,p3:0}))

  console.log(`消融实验: V4 Gen9 20德 × 20英 × ${GAMES}局 = ${20*20*GAMES}局/组\n`)

  let withP=0,withoutP=0,total=0
  for(let gi=0;gi<20;gi++){
    for(let bi=0;bi<20;bi++){
      total++
      const [wp,np]=await Promise.all([
        evalPair(gerPop[gi],britPop[bi],GAMES),
        evalPair(gerPop[gi],britNoPatrol[bi],GAMES)
      ])
      withP+=wp; withoutP+=np
      process.stdout.write(`\r${total}/${400}  有Patrol:${(withP/total*100).toFixed(1)}%  无Patrol:${(withoutP/total*100).toFixed(1)}%  Δ${((withP-withoutP)/total*100).toFixed(1)}%`)
    }
  }
  withP/=total; withoutP/=total
  console.log(`\n\n===== 结果 =====`)
  console.log(`有 Patrol 德军胜率: ${(withP*100).toFixed(1)}%`)
  console.log(`无 Patrol 德军胜率: ${(withoutP*100).toFixed(1)}%`)
  console.log(`差异 (Patrol 让德军少赢): ${((withoutP-withP)*100).toFixed(1)}%`)
  console.log(withoutP>withP ? '✅ Patrol 有效！英军更强了' : '⚠️ Patrol 无效或反向')
}

main().catch(e=>{console.error(e);process.exit(1)})
