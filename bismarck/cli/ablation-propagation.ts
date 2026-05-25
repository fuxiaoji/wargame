#!/usr/bin/env npx tsx
/** 热力图传播全面交叉验证: 4种模式 × 多个体 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4', 'gen_009')
const GAMES = 10, N = 5 // 5个体 × 10局

type PropMode = 'off' | 'full' | 'neg' | 'pos'

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

async function runOne(gerW:any,britW:any,gm:PropMode,bm:PropMode,n:number):Promise<number>{
  const useGer = gm !== 'off', useBrit = bm !== 'off'
  // 创建 AI 时设置传播标志；实际传播逻辑在 brain 内部用 usePropagation
  const ga=createStateMachineAI(gerW,useGer,useBrit),ba=createStateMachineAI(britW,useGer,useBrit)
  let gw=0
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
  const sf=path.join(V4,'individual_stats.json');const stats=JSON.parse(fs.readFileSync(sf,'utf-8'))
  const gerRank=stats.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr).slice(0,N)
  const britRank=stats.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr).slice(0,N)

  const modes:PropMode[] = ['off', 'full', 'neg', 'pos']
  const modeNames:Record<string,string> = {off:'关闭',full:'全传播',neg:'仅负值',pos:'仅正值'}

  console.log(`交叉验证: ${N}德 × ${N}英 × 4×4模式 × ${GAMES}局 = ${N*N*16*GAMES}局\n`)

  // 对每个模式组合跑所有个体对
  const matrix:Record<string,number> = {}
  for(const gm of modes){
    for(const bm of modes){
      let total=0,count=0
      for(const gi of gerRank){
        for(const bi of britRank){
          count++
          const wr=await runOne(gerPop[gi.i],britPop[bi.i],gm,bm,GAMES)
          total+=wr
          process.stdout.write(`\r${gm}/${bm} ${count}/${N*N} 德军均${(total/count*100).toFixed(0)}%`)
        }
      }
      matrix[`${gm}_${bm}`] = total/count
      console.log()
    }
  }

  console.log('\n===== 德军均胜率矩阵 =====')
  console.log('| 德军 \\ 英军 | 关闭 | 全传播 | 仅负值 | 仅正值 |')
  for(const gm of modes){
    let row=`| ${modeNames[gm]} |`
    for(const bm of modes){
      const v=matrix[`${gm}_${bm}`]
      row+=` ${(v*100).toFixed(1)}% |`
    }
    console.log(row)
  }

  console.log('\n===== 边际效应 =====')
  const base=matrix['off_off']
  for(const gm of modes){
    for(const bm of modes){
      if(gm==='off'&&bm==='off')continue
      const v=matrix[`${gm}_${bm}`]
      console.log(`德${modeNames[gm]} 英${modeNames[bm]}: ${(v*100).toFixed(1)}% (vs 基准${(base*100).toFixed(1)}%, Δ${((v-base)*100).toFixed(1)}%)`)
    }
  }
}

main().catch(e=>{console.error(e);process.exit(1)})
