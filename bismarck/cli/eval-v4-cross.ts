#!/usr/bin/env npx tsx
/** V4 交叉评估: V4 best vs V1-V4 opponents, 10局/组, 含张量保存 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import { fillStateSlice } from '../engine/tensor'
import * as fs from 'fs'; import * as path from 'path'

const DATA = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', '状态机个体')
const V3 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v3')
const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4')
const OUT = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'v4_cross_eval')
const GAMES = 10

const T=73, C=128, H=8, W=6
const MAGIC=0x42534D42

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

function writeTensor(dir: string, stateBuf: Float32Array[], result: any) {
  fs.mkdirSync(dir, {recursive:true})
  // state.bin: 20-byte header + T × C×H×W float32
  const buf=Buffer.alloc(20+T*C*H*W*4)
  buf.writeUInt32LE(MAGIC,0); buf.writeInt32LE(T,4); buf.writeInt32LE(C,8); buf.writeInt32LE(H,12); buf.writeInt32LE(W,16)
  for(let t=0;t<T;t++){
    const sl=t<stateBuf.length?stateBuf[t]:new Float32Array(C*H*W)
    Buffer.from(sl.buffer).copy(buf,20+t*C*H*W*4)
  }
  fs.writeFileSync(path.join(dir,'state.bin'),buf)
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result))
}

function loadPop(f:string):any[]{return JSON.parse(fs.readFileSync(f,'utf-8'))}

// Find best individual by stats
function bestIdx(genDir:string,side:'ger'|'brit'):number {
  const sf=path.join(genDir,'individual_stats.json')
  if(fs.existsSync(sf)){const s=JSON.parse(fs.readFileSync(sf,'utf-8'));let best=0,bestWr=0;for(const x of s){if(x.wr>bestWr){bestWr=x.wr;best=x.i}};return best}
  const pf=path.join(genDir,`${side}_population.json`);return 0
}

async function runOne(gerW:any,britW:any,label:string,gameIdx:number):Promise<any>{
  const ga=createStateMachineAI(gerW),ba=createStateMachineAI(britW)
  const env=new BismarckEnv()
  const stateBuf:Float32Array[]=[]
  let steps=0,st=0,ls=''

  while(!env.game.state.gameOver&&steps<500){
    const o=env.getObservation();(o as any).raw=env.game.state
    if(o.phase!=='setup-british'&&o.actions.length===0)break
    if(o.phase===ls)st++;else{st=0;ls=o.phase}
    if(st>15){const f=o.actions.find(a=>a.type==='finish-phase');if(f){env.step(f);st=0;continue}}

    // 记录张量
    if(steps<T) stateBuf.push(fillStateSlice(env.game.state))

    if(o.phase==='setup-british'){setupBritish(env);steps++;continue}
    const r=o.activePlayer==='german'?ga.selectGerman(o):ba.selectBritish(o)
    const chosen=r.actionId!=null?o.actions.find(x=>x.id===r.actionId):o.actions[0]
    console.log(`  T${env.game.state.turn} ${o.phase} ${o.activePlayer} → ${r.rawResponse?.slice(0,50)||'?'} | ${chosen?.label?.slice(0,30)||'?'}`)
    if(chosen)env.step(chosen)
    steps++
  }

  const result={
    game:label+'_'+gameIdx,winner:env.game.state.winner||'draw',
    vp_g:env.game.state.vp.german,vp_b:env.game.state.vp.british,
    turns:env.game.state.turn,steps
  }
  const dir=path.join(OUT,label,`game_${gameIdx}`)
  writeTensor(dir,stateBuf,result)
  return result
}

async function main(){
  fs.mkdirSync(OUT,{recursive:true})

  // 加载各版本最佳个体
  const gerV1=loadPop(path.join(DATA,'training_v1','gen_019','ger_population.json'))[1]  // #1 best
  const gerV2=loadPop(path.join(DATA,'training_v2','gen_019','ger_population.json'))[6]  // #6 best
  const gerV3=loadPop(path.join(V3,'gen_019','ger_population.json'))[bestIdx(path.join(V3,'gen_019'),'ger')]
  const gerV4=loadPop(path.join(V4,'gen_009','ger_population.json'))[bestIdx(path.join(V4,'gen_009'),'ger')]
  const britV1=loadPop(path.join(DATA,'training_v1','gen_019','brit_population.json'))[1]
  const britV2=loadPop(path.join(DATA,'training_v2','gen_019','brit_population.json'))[6]
  const britV3=loadPop(path.join(V3,'gen_019','brit_population.json'))[bestIdx(path.join(V3,'gen_019'),'brit')]
  const britV4=loadPop(path.join(V4,'gen_009','brit_population.json'))[bestIdx(path.join(V4,'gen_009'),'brit')]

  const matchups:{ger:any,brit:any,label:string}[]=[
    // V4德 vs 各代英
    {ger:gerV4,brit:britV1,label:'V4德_vs_V1英'},
    {ger:gerV4,brit:britV2,label:'V4德_vs_V2英'},
    {ger:gerV4,brit:britV3,label:'V4德_vs_V3英'},
    {ger:gerV4,brit:britV4,label:'V4德_vs_V4英'},
    // V4英 vs 各代德
    {ger:gerV1,brit:britV4,label:'V1德_vs_V4英'},
    {ger:gerV2,brit:britV4,label:'V2德_vs_V4英'},
    {ger:gerV3,brit:britV4,label:'V3德_vs_V4英'},
    {ger:gerV4,brit:britV4,label:'V4德_vs_V4英'},
  ]

  const results:any[]=[]
  for(const m of matchups){
    console.log(`\n===== ${m.label} =====`)
    let gerW=0
    for(let g=0;g<GAMES;g++){
      console.log(`--- Game ${g+1}/${GAMES} ---`)
      const r=await runOne(m.ger,m.brit,m.label,g)
      if(r.winner==='german')gerW++
      console.log(`  结果: ${r.winner} VP ${r.vp_g}-${r.vp_b} T${r.turns}`)
    }
    results.push({matchup:m.label,gerWins:gerW,total:GAMES,wr:gerW/GAMES})
    console.log(`  >> 德军 ${gerW}/${GAMES} (${(gerW/GAMES*100).toFixed(0)}%)`)
  }

  // 汇总
  console.log('\n\n========== 交叉评估汇总 ==========')
  console.log('| 德军 | 英军 | 德军胜 | 胜率 |')
  for(const r of results) console.log(`| ${r.matchup.replace('_vs_',' vs ')} | ${r.gerWins}/${r.total} | ${(r.wr*100).toFixed(0)}% |`)
  console.log(`\n张量数据: ${OUT}/`)
}

main().catch(e=>{console.error(e);process.exit(1)})
