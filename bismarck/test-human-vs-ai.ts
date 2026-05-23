#!/usr/bin/env npx tsx
/** 人vsAI 测试 —— 模拟人类随机玩德军，AI(低级)玩英军 */

import { BismarckEnv } from './engine/env'
import { createLLMLowSelector } from './cli/action-selector'
import { SYS_BRITISH } from './cli/llm-types'
import * as fs from 'fs'

const KEY = (() => {
  try {
    const apiFile = fs.readFileSync('/Users/Zhuanz1/Desktop/code/wargame/api.md', 'utf-8')
    const m = apiFile.match(/`(sk-[a-zA-Z0-9]+)`/)
    if (m) return m[1]
  } catch {}
  return process.env.DEEPSEEK_API_KEY || ''
})()

async function main() {
  if (!KEY) { console.error('❌ 未配置API Key'); process.exit(1) }

  const env = new BismarckEnv()
  const ai = createLLMLowSelector(KEY, 'deepseek-chat')
  let steps = 0, stuck = 0, lastPhase = ''

  console.log('===== 人vsAI 测试 (人类=德军随机, AI=英军低级) =====\n')

  while (!env.game.state.gameOver && steps < 200) {
    const obs = env.getObservation()
    // setup-british actions 可以为空 (LLM 直接回复坐标)
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

    // 卡死检测
    if (obs.phase === lastPhase) stuck++
    else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 15) {
      const f = obs.actions.find(a => a.type === 'finish-phase')
      if (f) { console.log(`  ⚡ 卡死，强制推进: ${f.label}`); env.step(f); stuck = 0; continue }
    }

    const s = env.game.state
    const player = obs.activePlayer
    const isHumanTurn = player === 'german'

    if (obs.phase !== lastPhase || steps === 0) {
      console.log(`\nT${s.turn} ${obs.phase} ${player==='german'?'🧑人类(德军)':'🤖AI(英军)'} 德${s.vp.german}VP/英${s.vp.british}VP`)
      lastPhase = obs.phase
    }

    if (obs.phase === 'setup-british') {
      // AI 自动处理：随机放
      const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
      for (const sh of s.britishShips)
        if (sh.def.isDummy && !s.britishPositions.has(sh.def.id))
          env.game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
      // AI 选真船位置
      const res = await ai.selectAction(obs)
      const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
      while ((m = re.exec(res.rawResponse)) !== null) {
        const sh = s.britishShips.find(x => !x.def.isDummy && !s.britishPositions.has(x.def.id) &&
          (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
        if (sh) env.game.placeBritishToken(sh.def.id, m[2])
      }
      const left = s.britishShips.filter(x => !s.britishPositions.has(x.def.id))
      if (left.length > 0) {
        const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
        for (const sh of left) env.game.placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
      }
      env.game.finishSetup()
      console.log(`  布阵完成`)
      steps++; continue
    }

    if (isHumanTurn) {
      // 人类：随机选一个动作（模拟随便点）
      const pick = obs.actions[Math.floor(Math.random() * obs.actions.length)]
      env.step(pick)
      console.log(`  🧑 人类选 #${pick.id}: ${pick.label.slice(0,60)}`)
    } else {
      // AI：调 LLM
      const t0 = Date.now()
      const res = await ai.selectAction(obs)
      const ms = Date.now() - t0
      if (res.actionId) {
        const action = obs.actions.find(a => a.id === res.actionId)
        if (action) {
          env.step(action)
          console.log(`  🤖 AI选 #${res.actionId}: ${action.label.slice(0,60)} (${ms}ms)`)
        } else { env.step(obs.actions[0]); console.log(`  🤖 无效ID fallback`) }
      } else {
        env.step(obs.actions[0])
        console.log(`  🤖 无法解析 fallback (${ms}ms)`)
      }
    }

    steps++
  }

  console.log(`\n===== 终局 =====`)
  console.log(`胜者: ${env.game.state.winner==='german'?'德军':'英军'} | T${env.game.state.turn} | 德${env.game.state.vp.german}VP/英${env.game.state.vp.british}VP`)
  console.log(`原因: ${env.game.state.victoryReason} | 步数: ${steps}`)
  console.log(steps > 0 && !env.game.state.gameOver ? '⚠ 未正常终局' : '✅ 测试完成')
}

main().catch(e => { console.error('💥', e); process.exit(1) })
