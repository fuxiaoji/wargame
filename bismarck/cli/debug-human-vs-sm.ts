#!/usr/bin/env npx tsx
/** 人类(德军) vs SM英军 详细日志 */
import { BismarckEnv } from '../engine/env'
import { createStateMachineAI } from './state-machine'
import { GERMAN_START_HEXES, hexDistance } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'; import * as path from 'path'

const V4 = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data', 'training_v4', 'gen_009')
const COL = ['A','B','C','D','E','F']

function hmAt(label:string, hm:Float32Array):string {
  const c=label.charCodeAt(0)-65, r=parseInt(label.slice(1))-1
  if(c<0||c>5||r<0||r>7) return '?'
  return (hm[r*6+c]>=0?'+':'')+hm[r*6+c].toFixed(1)
}

function label(pos:any):string{return pos?COL[pos.q]+pos.r:'?'}

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

// 人类德军策略: B7→D8→E7→F6→F7 冲港, 欧根打工
const GERMAN_PLAN:{phase:string, action:string}[] = [
  {phase:'setup-german', action:'B7'},
  // Turn 1
  {phase:'german-move', action:'bismarck→D8'},
  {phase:'german-move', action:'eugen→C6'},
  {phase:'german-move', action:'finish'},
  // Turn 2
  {phase:'german-move', action:'bismarck→E7'},
  {phase:'german-move', action:'eugen→D4'},
  {phase:'german-move', action:'finish'},
  // Turn 3
  {phase:'german-move', action:'bismarck→F6'},
  {phase:'german-move', action:'eugen→D2'},
  {phase:'german-move', action:'finish'},
  // Turn 4
  {phase:'german-move', action:'bismarck→F7'},
  {phase:'german-move', action:'eugen→C4'},
  {phase:'german-move', action:'finish'},
  // Transport: always attack
  {phase:'transport-attack', action:'attack'},
]

async function main(){
  const britW=JSON.parse(fs.readFileSync(path.join(V4,'brit_population.json'),'utf-8'))[0]
  const ba=createStateMachineAI(britW,'off','off')
  const env=new BismarckEnv()
  let steps=0, st=0, ls='', planIdx=0

  while(!env.game.state.gameOver && steps<500){
    const obs=env.getObservation();(obs as any).raw=env.game.state; const s=env.game.state

    if(obs.phase!=='setup-british'&&obs.actions.length===0)break
    if(obs.phase===ls)st++;else{st=0;ls=obs.phase}
    if(st>15){const f=obs.actions.find(a=>a.type==='finish-phase');if(f){env.step(f);st=0;continue}}

    const gpos=label(s.germanPositions.get('bismarck'))
    console.log(`\n--- T${s.turn} ${obs.phase} 俾斯麦:${gpos} VP:${s.vp.german} found:${s.bismarckFound} public:${s.germanPositionPublic} ---`)

    if(obs.phase==='setup-british'){
      setupBritish(env)
      // Show British deployment
      console.log('英军初设:')
      for(const sh of s.britishShips) if(!sh.def.isDummy) console.log(`  ${sh.def.name}: ${label(s.britishPositions.get(sh.def.id))}`)
      console.log(`  伪装: ${[...s.britishShips.filter(x=>x.def.isDummy)].length}个`)
      steps++; continue
    }

    // British AI turn → observe in detail
    if(obs.activePlayer==='british'){
      const result=ba.selectBritish(obs,true)
      const d=result.debug
      if(d){
        console.log(`  [英] ${d.curShip} 策略:${d.pickedStrategy}`)
        console.log(`       分:${d.strategyScores.map(x=>`${x.name}=${x.raw.toFixed(1)}(${(x.prob*100).toFixed(0)}%)`).join(' ')}`)
        // Show last known German position
        const brain=(ba as any).british
        const lastKnown=brain.lastKnownGermanPos
        const seen=brain.turnsSinceSeen
        console.log(`       最后目击:${lastKnown?label(lastKnown):'无'} 距今:${seen}回合`)
        // Key hexes
        console.log(`       关键热力: F7:${hmAt('F7',d.heatmap)} D8:${hmAt('D8',d.heatmap)} B5:${hmAt('B5',d.heatmap)} ${gpos}:${hmAt(gpos,d.heatmap)}`)
      }
      const chosen=result.actionId!=null?obs.actions.find(x=>x.id===result.actionId):obs.actions[0]
      console.log(`  → ${chosen?.label?.slice(0,35)||'?'}`)
      if(chosen)env.step(chosen)
      steps++; continue
    }

    // German turn → follow plan
    if(obs.phase==='setup-german'){
      const a=obs.actions.find(x=>x.label?.includes('B7'))
      if(a)env.step(a); console.log('  德军→B7')
    } else if(obs.phase==='transport-attack'){
      const ta=obs.actions.find(x=>x.type==='transport')
      if(ta){env.step(ta); console.log('  → 攻击运输!')}
      else{const f=obs.actions.find(x=>x.type==='finish-phase');if(f)env.step(f)}
    } else if(obs.phase==='german-move'){
      const a0=obs.actions[0]; const shipId=a0?.params?.shipId
      // Simple heuristic: Bismarck toward F7, Eugen toward routes
      if(shipId==='bismarck'){
        // Pick move closest to F7
        const moves=obs.actions.filter(x=>x.type==='move')
        let best=null, bestDist=99
        for(const m of moves){
          const rc=m.params?.targetLabel?{q:m.params.targetLabel.charCodeAt(0)-65,r:parseInt(m.params.targetLabel.slice(1))}:null
          if(rc){const d=Math.abs(rc.q-5)+Math.abs(rc.r-7); if(d<bestDist){bestDist=d;best=m}}
        }
        if(best)env.step(best); console.log(`  俾斯麦→${best?.params?.targetLabel} (距F7:${bestDist})`)
      } else if(shipId==='prinz-eugen'){
        // Pick sea route hex
        const routes=['D2','D3','C3','C4','D5','E1','E4','E5']
        const moves=obs.actions.filter(x=>x.type==='move')
        let best=null
        for(const r of routes){const m=moves.find(x=>x.params?.targetLabel===r);if(m){best=m;break}}
        if(!best) best=moves.find(x=>x.type==='move')
        if(best)env.step(best); console.log(`  欧根→${best?.params?.targetLabel}`)
      } else {
        const f=obs.actions.find(x=>x.type==='finish-phase')
        if(f)env.step(f); console.log('  德军完成')
      }
    }
    steps++
  }

  console.log(`\n===== RESULT: ${s.winner||'draw'} VP ${s.vp.german}-${s.vp.british} T${s.turn} =====`)
}

main().catch(e=>{console.error(e);process.exit(1)})
