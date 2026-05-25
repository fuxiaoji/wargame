#!/usr/bin/env npx tsx
/** 单局详细调试: 每步决策+热力图 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4', 'gen_009')
const COL = ['A','B','C','D','E','F']

function hmAt(label:string, hm:Float32Array):string {
  const c=label.charCodeAt(0)-65, r=parseInt(label.slice(1))-1
  if(c<0||c>5||r<0||r>7) return '?'
  const v=hm[r*6+c]
  return (v>=0?'+':'')+v.toFixed(1)
}

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

function gerPos(state:any):string {
  const p=state.germanPositions.get('bismarck'); return p?COL[p.q]+p.r:'?'
}
function britPos(state:any, id:string):string {
  const p=state.britishPositions.get(id); return p?COL[p.q]+p.r:'?'
}

async function main(){
  const gerW=JSON.parse(fs.readFileSync(path.join(V4,'ger_population.json'),'utf-8'))[0]
  const britW=JSON.parse(fs.readFileSync(path.join(V4,'brit_population.json'),'utf-8'))[0]
  console.log('V4 德#0 vs 英#0 | 传播=off\n')

  const ga=createStateMachineAI(gerW,'neg','neg'),ba=createStateMachineAI(britW,'neg','neg')
  console.log('传播模式: neg (仅负值)')
  const env=new BismarckEnv(); let steps=0,st=0,ls='',lastGerPos='?'

  while(!env.game.state.gameOver&&steps<500){
    const obs=env.getObservation();(obs as any).raw=env.game.state
    const s=env.game.state

    if(obs.phase!=='setup-british'&&obs.actions.length===0)break
    if(obs.phase===ls)st++;else{st=0;ls=obs.phase}
    if(st>15){const f=obs.actions.find(a=>a.type==='finish-phase');if(f){env.step(f);st=0;continue}}

    const gpos=gerPos(s)
    console.log(`\n--- Step ${steps} T${s.turn} ${obs.phase} ${obs.activePlayer} ---`)
    console.log(`  俾斯麦:${gpos} VP:${s.vp.german}-${s.vp.british} found:${s.bismarckFound}`)

    if(obs.phase==='setup-british'){setupBritish(env);steps++;continue}

    const result=obs.activePlayer==='german'?ga.selectGerman(obs,true):ba.selectBritish(obs,true)
    const d=result.debug

    if(d){
      console.log(`  船:${d.curShip} 策略:${d.pickedStrategy}`)
      console.log(`  策略分:${d.strategyScores.map(s=>`${s.name}=${s.raw.toFixed(1)}(${(s.prob*100).toFixed(0)}%)`).join(' ')}`)
      // 可达格热力
      const moveActs=obs.actions.filter(a=>a.type==='move')
      if(moveActs.length>0){
        const samples=moveActs.slice(0,8).map(a=>a.params?.targetLabel).filter(Boolean)
        console.log(`  可达格热力:${samples.map(l=>`${l}:${hmAt(l,d.heatmap)}`).join(' ')}`)
      }
      // 关键格热力
      console.log(`  关键格: F7:${hmAt('F7',d.heatmap)} D8:${hmAt('D8',d.heatmap)} E7:${hmAt('E7',d.heatmap)} B5:${hmAt('B5',d.heatmap)} C4:${hmAt('C4',d.heatmap)}`)
      // 最高分目标
      const topMove=moveActs.map((a,i)=>({label:a.params?.targetLabel,score:d.moveScores[i]?.score||0})).sort((a,b)=>b.score-a.score)[0]
      console.log(`  最高分目标:${topMove?.label} (${topMove?.score?.toFixed(2)})`)
    }

    const chosen=result.actionId!=null?obs.actions.find(x=>x.id===result.actionId):obs.actions[0]
    console.log(`  → ${chosen?.label||'?'}`)
    if(chosen)env.step(chosen)
    if(gpos!==lastGerPos){lastGerPos=gpos}
    steps++
  }

  console.log(`\n===== RESULT: ${s.winner||'draw'} VP ${s.vp.german}-${s.vp.british} T${s.turn} =====`)
}

main().catch(e=>{console.error(e);process.exit(1)})
