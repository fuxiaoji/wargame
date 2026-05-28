#!/usr/bin/env npx tsx
/** 最强vs最强 每船热力图+决策完整解说 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V7 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v7', 'gen_001')
const COL = ['A','B','C','D','E','F']
function L(p:any):string{return p?COL[p.q]+p.r:'?'}
function Hm(label:string, hm:Float32Array):string{const c=label.charCodeAt(0)-65,r=parseInt(label.slice(1))-1;if(c<0||c>5||r<0||r>7)return'?';const v=hm[r*6+c];return(v>=0?'+':'')+v.toFixed(1)}

function setupBritish(env: BismarckEnv) {
  const s=env.game.state,used=new Set<string>(GERMAN_START_HEXES)
  for(const [hex,ids] of Object.entries(BRITISH_FIXED_POSITIONS)){used.add(hex);for(const id of ids)env.game.placeBritishToken(id,hex)}
  const R=new Set<string>(),ds={def:{speed:2},steps:2}as any
  for(const l of GERMAN_START_HEXES){const h={q:l.charCodeAt(0)-65,r:parseInt(l.slice(1))};if(h.q<0||h.q>5||h.r<1||h.r>8)continue;for(const rl of getGermanReachableLabels(ds,h)){if(!used.has(rl))R.add(rl)}}
  const pf=(d:boolean)=>{for(const sh of s.britishShips){if(sh.def.isDummy!==d||s.britishPositions.has(sh.def.id))continue;const a=[...R].filter(h=>!used.has(h));if(a.length){const p=a[Math.floor(Math.random()*a.length)];env.game.placeBritishToken(sh.def.id,p);used.add(p)}}}
  pf(false);pf(true);const fb=['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for(const sh of s.britishShips)if(!s.britishPositions.has(sh.def.id))env.game.placeBritishToken(sh.def.id,fb[Math.floor(Math.random()*fb.length)])
  env.game.finishSetup()
}

async function main(){
  const gerPop=JSON.parse(fs.readFileSync(path.join(V7,'ger_population.json'),'utf-8'))
  const britPop=JSON.parse(fs.readFileSync(path.join(V7,'brit_population.json'),'utf-8'))
  const gerW=gerPop[9], britW=britPop[13]
  console.log('🎮 V7 Gen1 德#9(53.9%) vs 英#13(60.9%)\n')

  const ga=createStateMachineAI(gerW,'neg','neg'),ba=createStateMachineAI(britW,'neg','neg')
  const env=new BismarckEnv(); let steps=0, st=0, ls=''

  while(!env.game.state.gameOver && steps<500){
    const obs=env.getObservation();(obs as any).raw=env.game.state; const s=env.game.state
    if(obs.phase!=='setup-british'&&obs.actions.length===0)break
    if(obs.phase===ls)st++;else{st=0;ls=obs.phase}
    if(st>15){const f=obs.actions.find(a=>a.type==='finish-phase');if(f){env.step(f);st=0;continue}}

    const biz=L(s.germanPositions.get('bismarck')); const eug=L(s.germanPositions.get('prinz-eugen'))

    if(obs.phase==='setup-british'){setupBritish(env);steps++;continue}

    // ===== GERMAN TURN =====
    if(obs.activePlayer==='german'){
      const r=ga.selectGerman(obs,true); const d=r.debug
      if(d){
        const moveActs=obs.actions.filter(a=>a.type==='move')
        const top3=moveActs.map(a=>({l:a.params?.targetLabel,heat:Hm(a.params?.targetLabel||'?',d.heatmap)})).sort((a,b)=>(parseFloat(b.heat)||0)-(parseFloat(a.heat)||0)).slice(0,3)
        console.log(`\nT${s.turn} [德] ${d.curShip} | 俾:${biz} 欧:${eug} VP:${s.vp.german}-${s.vp.british}`)
        console.log(`  策略: ${d.strategyScores.map(x=>`${x.name}=${x.raw.toFixed(1)}(${(x.prob*100).toFixed(0)}%)`).join(' | ')}`)
        console.log(`  选中: ${d.pickedStrategy}`)
        console.log(`  可达热力TOP3: ${top3.map(x=>`${x.l}:${x.heat}`).join(' ')}`)
        console.log(`  关键格: F7:${Hm('F7',d.heatmap)} D8:${Hm('D8',d.heatmap)} B5:${Hm('B5',d.heatmap)} C4:${Hm('C4',d.heatmap)}`)
      }
      const chosen=r.actionId!=null?obs.actions.find(x=>x.id===r.actionId):obs.actions[0]
      console.log(`  → ${chosen?.label?.slice(0,40)||'?'}`)
      if(chosen)env.step(chosen)
    }

    // ===== BRITISH TURN =====
    if(obs.activePlayer==='british'){
      const r=ba.selectBritish(obs,true); const d=r.debug
      if(d){
        const brain=(ba as any).british; const lk=brain.lastKnownGermanPos; const ts=brain.turnsSinceSeen
        const bizHm=Hm(biz,d.heatmap); const f7=Hm('F7',d.heatmap)
        const moveActs=obs.actions.filter(a=>a.type==='move')
        const top3=moveActs.map(a=>({l:a.params?.targetLabel,heat:Hm(a.params?.targetLabel||'?',d.heatmap)})).sort((a,b)=>(parseFloat(b.heat)||0)-(parseFloat(a.heat)||0)).slice(0,3)
        console.log(`\nT${s.turn} [英] ${d.curShip} | found:${s.bismarckFound} pub:${s.germanPositionPublic} 目击:${lk?L(lk):'无'} 距今:${ts}回合`)
        console.log(`  策略: ${d.strategyScores.map(x=>`${x.name}=${x.raw.toFixed(1)}(${(x.prob*100).toFixed(0)}%)`).join(' | ')}`)
        console.log(`  选中: ${d.pickedStrategy}`)
        console.log(`  可达TOP3: ${top3.map(x=>`${x.l}:${x.heat}`).join(' ')}`)
        console.log(`  俾斯麦格(${biz}):${bizHm} F7:${f7} 目击格(${lk?L(lk):'?'}):${lk?Hm(L(lk)!,d.heatmap):'?'}`)
      }
      const chosen=r.actionId!=null?obs.actions.find(x=>x.id===r.actionId):obs.actions[0]
      console.log(`  → ${chosen?.label?.slice(0,40)||'?'}`)
      if(chosen)env.step(chosen)
    }

    // Other phases
    if(obs.phase!=='german-move'&&obs.phase!=='british-move'&&obs.phase!=='setup-german'){
      const chosen=obs.actions[0]
      const labels:Record<string,string>={'british-search':'🔍索敌','combat':'⚔战斗','transport-attack':'💥破交'}
      console.log(`\nT${s.turn} [${labels[obs.phase]||obs.phase}] → ${chosen?.label||'?'}`)
      if(chosen)env.step(chosen)
    }
    steps++
  }
  console.log(`\n🏆 ${s.winner||'draw'} VP${s.vp.german}-${s.vp.british} T${s.turn}`)
}
main().catch(e=>{console.error(e);process.exit(1)})
