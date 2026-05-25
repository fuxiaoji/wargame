#!/usr/bin/env npx tsx
/** V1/V2/V3 交叉对战 — Top个体互相评估 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const DATA = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', '状态机个体')
const V3 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v3')
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

async function battle(gerW:any,britW:any,n:number):Promise<{gw:number,vg:number,vb:number,t:number}>{
  const ga=createStateMachineAI(gerW),ba=createStateMachineAI(britW)
  let gw=0,tt=0,vg=0,vb=0
  for(let g=0;g<n;g++){const e=new BismarckEnv();let s=0,st=0,ls=''
    while(!e.game.state.gameOver&&s<500){const o=e.getObservation();(o as any).raw=e.game.state
      if(o.phase!=='setup-british'&&o.actions.length===0)break
      if(o.phase===ls)st++;else{st=0;ls=o.phase}
      if(st>15){const f=o.actions.find(a=>a.type==='finish-phase');if(f){e.step(f);st=0;continue}}
      if(o.phase==='setup-british'){setupBritish(e);s++;continue}
      const r=o.activePlayer==='german'?ga.selectGerman(o):ba.selectBritish(o)
      if(r.actionId!=null){const a=o.actions.find(x=>x.id===r.actionId);if(a)e.step(a)}else if(o.actions.length>0)e.step(o.actions[0])
      s++}
    if(e.game.state.winner==='german')gw++;tt+=e.game.state.turn;vg+=e.game.state.vp.german;vb+=e.game.state.vp.british}
  return{gw,vg:vg/n,vb:vb/n,t:tt/n}
}

function loadPop(f:string):any[]{return JSON.parse(fs.readFileSync(f,'utf-8'))}

async function main(){
  // 选取各版本Top-3
  const ger:{v:string,i:number,w:any,l:string}[]=[]
  const brit:{v:string,i:number,w:any,l:string}[]=[]

  // V1: README排名 #1, #6, #7
  {const p=loadPop(path.join(DATA,'training_v1','gen_019','ger_population.json'));for(const i of[1,6,7])ger.push({v:'V1',i,w:p[i],l:`V1德#${i}`})}
  {const p=loadPop(path.join(DATA,'training_v1','gen_019','brit_population.json'));for(const i of[1,6,0])brit.push({v:'V1',i,w:p[i],l:`V1英#${i}`})}
  // V2: #6, #2, #5
  {const p=loadPop(path.join(DATA,'training_v2','gen_019','ger_population.json'));for(const i of[6,2,5])ger.push({v:'V2',i,w:p[i],l:`V2德#${i}`})}
  {const p=loadPop(path.join(DATA,'training_v2','gen_019','brit_population.json'));for(const i of[6,1,8])brit.push({v:'V2',i,w:p[i],l:`V2英#${i}`})}
  // V3: individual_stats排名Top-3
  {const p=loadPop(path.join(V3,'gen_019','ger_population.json'));const s=JSON.parse(fs.readFileSync(path.join(V3,'gen_019','individual_stats.json'),'utf-8'));const r=s.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr);for(const x of r.slice(0,3))ger.push({v:'V3',i:x.i,w:p[x.i],l:`V3德#${x.i}`})}
  {const p=loadPop(path.join(V3,'gen_019','brit_population.json'));const s=JSON.parse(fs.readFileSync(path.join(V3,'gen_019','individual_stats.json'),'utf-8'));const r=s.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr);for(const x of r.slice(0,3))brit.push({v:'V3',i:x.i,w:p[x.i],l:`V3英#${x.i}`})}
  // V4: gen_009 (最后一代) Top-3
  const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4')
  {const gf=path.join(V4,'gen_009','ger_population.json');const bf=path.join(V4,'gen_009','brit_population.json')
   if(fs.existsSync(gf)){const p=loadPop(gf);const sf=path.join(V4,'gen_009','individual_stats.json');const s=fs.existsSync(sf)?JSON.parse(fs.readFileSync(sf,'utf-8')):p.map((_:any,i:number)=>({i,wr:0}));const r=s.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr);for(const x of r.slice(0,3))ger.push({v:'V4',i:x.i,w:p[x.i],l:`V4德#${x.i}`})}
   if(fs.existsSync(bf)){const p=loadPop(bf);const sf=path.join(V4,'gen_009','individual_stats.json');const s=fs.existsSync(sf)?JSON.parse(fs.readFileSync(sf,'utf-8')):p.map((_:any,i:number)=>({i,wr:0}));const r=s.map((x:any,i:number)=>({i,wr:x.wr})).sort((a:any,b:any)=>b.wr-a.wr);for(const x of r.slice(0,3))brit.push({v:'V4',i:x.i,w:p[x.i],l:`V4英#${x.i}`})}}

  const G=ger.length,B=brit.length
  console.log(`V1/V2/V3 交叉对战: ${G}德 × ${B}英 × ${GAMES}局 = ${G*B*GAMES}局\n`)

  // 打印矩阵
  const h='| 德军 \\ 英军 |'+brit.map(b=>b.l.padEnd(10)).join('|')+'| 均 |'
  console.log(h);console.log('|'+'-'.repeat(h.length-2)+'|')

  const matrix:number[][]=[]
  for(const ge of ger){
    let row=`| ${ge.l.padEnd(12)}|`;let tw=0
    for(const be of brit){
      process.stdout.write(`\r${ge.l} vs ${be.l}...`)
      const{ gw }=await battle(ge.w,be.w,GAMES)
      const wr=gw/GAMES;tw+=gw
      row+=` ${(wr*100).toFixed(0).padStart(3)}%`.padEnd(8)+'|'
    }
    matrix.push(tw/(B*GAMES)>0.5?[tw/(B*GAMES)]:[])
    row+=` ${(tw/(B*GAMES)*100).toFixed(0)}% |`
    console.log('\r'+row)
  }

  // 英军列平均
  let brow='| 英军均胜率'.padEnd(15)+'|'
  for(let bi=0;bi<B;bi++){let bw=0;for(const ge of ger){const{ gw }=await battle(ge.w,brit[bi].w,10);bw+=(10-gw)};brow+=` ${(bw/(G*10)*100).toFixed(0).padStart(3)}%`.padEnd(8)+'|'}
  console.log(brow)

  // 权重对比
  console.log('\n===== 德军权重 =====')
  console.log('| 个体 | w1冲港 | w5打工 | w12躲藏 | temp |')
  for(const g of ger) console.log(`| ${g.l} | ${g.w.w1.toFixed(1)} | ${g.w.w5.toFixed(1)} | ${g.w.w12.toFixed(1)} | ${g.w.temperature.toFixed(2)} |`)

  console.log('\n===== 英军权重 =====')
  console.log('| 个体 | s1搜索 | h1猎杀 | d1防守 |')
  for(const b of brit) console.log(`| ${b.l} | ${b.w.s1.toFixed(1)} | ${b.w.h1.toFixed(1)} | ${b.w.d1.toFixed(1)} |`)
}

main().catch(e=>{console.error(e);process.exit(1)})
