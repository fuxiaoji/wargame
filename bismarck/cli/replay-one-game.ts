#!/usr/bin/env npx tsx
/** 单局详细回放: 带热力图解说 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES, hexDistance } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V7 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v7', 'gen_000')
const COL = ['A','B','C','D','E','F']

function label(pos:any):string{return pos?COL[pos.q]+pos.r:'?'}
function hmAt(label:string, hm:Float32Array):string{
  const c=label.charCodeAt(0)-65, r=parseInt(label.slice(1))-1
  if(c<0||c>5||r<0||r>7) return '?'
  const v=hm[r*6+c]; return (v>=0?'+':'')+v.toFixed(1)
}

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
  const gerW=JSON.parse(fs.readFileSync(path.join(V7,'ger_population.json'),'utf-8'))[3]
  const britW=JSON.parse(fs.readFileSync(path.join(V7,'brit_population.json'),'utf-8'))[1]
  console.log('🎮 V7 Gen0 德#3 vs 英#1 — 完整回放\n')

  const ga=createStateMachineAI(gerW,'neg','neg'),ba=createStateMachineAI(britW,'neg','neg')
  const env=new BismarckEnv(); let steps=0, st=0, ls='', lastBiz='?'

  while(!env.game.state.gameOver && steps<500){
    const obs=env.getObservation();(obs as any).raw=env.game.state; const s=env.game.state
    if(obs.phase!=='setup-british'&&obs.actions.length===0)break
    if(obs.phase===ls)st++;else{st=0;ls=obs.phase}
    if(st>15){const f=obs.actions.find(a=>a.type==='finish-phase');if(f){env.step(f);st=0;continue}}

    const biz=label(s.germanPositions.get('bismarck'))
    const eug=label(s.germanPositions.get('prinz-eugen'))
    const vp=s.vp; const found=s.bismarckFound; const pub=s.germanPositionPublic

    if(obs.phase==='setup-british'){setupBritish(env);steps++;continue}

    // --- 德军回合 ---
    if(obs.activePlayer==='german'){
      const result=ga.selectGerman(obs,true); const d=result.debug
      if(d){
        const f7=hmAt('F7',d.heatmap); const b5=hmAt('B5',d.heatmap)
        const routes=['D2','D3','C3','C4','D5'].map(l=>hmAt(l,d.heatmap)).join('/')
        console.log(`T${s.turn} [德] ${d.curShip} ${d.pickedStrategy} | VP${vp.german}-${vp.british} 俾:${biz} 欧:${eug}`)
        console.log(`  热力: F7:${f7} B5:${b5} | 航路:${routes}`)
        console.log(`  策略: ${d.strategyScores.map(x=>`${x.name}=${x.raw.toFixed(1)}(${(x.prob*100).toFixed(0)}%)`).join(' ')}`)
      }
      const chosen=result.actionId!=null?obs.actions.find(x=>x.id===result.actionId):obs.actions[0]
      const moveTo=chosen?.params?.targetLabel||'?'
      const newPos=moveTo!=='?'?moveTo:biz
      const dF7=newPos!=='?'?hexDistance({q:newPos.charCodeAt(0)-65,r:parseInt(newPos.slice(1))},{q:5,r:6}):99
      console.log(`  → ${chosen?.label?.slice(0,40)||'?'} (距F7:${dF7})`)
      if(chosen)env.step(chosen)
      lastBiz=biz
    }

    // --- 英军回合 ---
    if(obs.activePlayer==='british'){
      const result=ba.selectBritish(obs,true); const d=result.debug
      if(d){
        const brain=(ba as any).british
        const lk=brain.lastKnownGermanPos; const ts=brain.turnsSinceSeen
        const f7=hmAt('F7',d.heatmap); const bizHm=hmAt(biz,d.heatmap)
        const lastLabel=lk?label(lk):'无'
        const radius=ts*2
        console.log(`T${s.turn} [英] ${d.curShip} ${d.pickedStrategy} | found:${found} pub:${pub} 目击:${lastLabel} 距今:${ts}回合 扩散半径:${radius}`)
        console.log(`  热力: F7:${f7} 俾斯麦格(${biz}):${bizHm}`)
        console.log(`  策略: ${d.strategyScores.map(x=>`${x.name}=${x.raw.toFixed(1)}(${(x.prob*100).toFixed(0)}%)`).join(' ')}`)
        if(d.pickedStrategy==='hunt'){
          console.log(`  ⚔ HUNT! 追踪最后目击:${lastLabel} 扩散圈半径${radius}格`)
        } else if(d.pickedStrategy==='search'){
          console.log(`  🔍 SEARCH 扩散搜索...`)
        } else if(d.pickedStrategy==='patrol'){
          console.log(`  🛡 PATROL 蹲守航路`)
        }
      }
      const chosen=result.actionId!=null?obs.actions.find(x=>x.id===result.actionId):obs.actions[0]
      console.log(`  → ${chosen?.label?.slice(0,40)||'?'}`)
      if(chosen)env.step(chosen)
    }

    // --- 索敌/战斗 ---
    if(obs.phase!=='german-move'&&obs.phase!=='british-move'&&obs.phase!=='setup-german'){
      const result=obs.activePlayer==='german'?ga.selectGerman(obs):ba.selectBritish(obs)
      const chosen=result.actionId!=null?obs.actions.find(x=>x.id===result.actionId):obs.actions[0]
      if(obs.phase==='british-search') console.log(`T${s.turn} [索敌] → ${chosen?.label||'?'}`)
      if(obs.phase==='combat') console.log(`T${s.turn} [⚔战斗!] → ${chosen?.label||'?'}`)
      if(obs.phase==='transport-attack') console.log(`T${s.turn} [💥破交!] → ${chosen?.label||'?'}`)
      if(chosen)env.step(chosen)
    }
    steps++
  }

  const w=s.winner||'draw'
  console.log(`\n🏆 结果: ${w} VP ${s.vp.german}-${s.vp.british} T${s.turn} 步数${steps}`)
}

main().catch(e=>{console.error(e);process.exit(1)})
