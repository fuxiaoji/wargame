#!/usr/bin/env npx tsx
/** 状态机 AI 对战测试 */

import { BismarckEnv } from './engine/env'
import { createStateMachineAI } from './cli/state-machine'

const GAMES = parseInt(process.argv[2] || '10')

async function main() {
  const ai = createStateMachineAI()
  let gerWins = 0, britWins = 0

  for (let g = 0; g < GAMES; g++) {
    const env = new BismarckEnv()
    let steps = 0, stuck = 0, lastPhase = ''

    while (!env.game.state.gameOver && steps < 500) {
      const obs = env.getObservation()
      ;(obs as any).raw = env.game.state  // 注入 raw
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

      if (obs.phase === lastPhase) stuck++
      else { stuck = 0; lastPhase = obs.phase }
      if (stuck > 20) {
        const f = obs.actions.find(a => a.type === 'finish-phase')
        if (f) { env.step(f); stuck = 0; continue }
      }

      const player = obs.activePlayer
      let result: { actionId: number | null; rawResponse: string }

      if (obs.phase === 'setup-british') {
        // 状态机输出坐标格式
        result = ai.selectBritish(obs)
        const raw = result.rawResponse
        // 自动放伪装
        const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
        for (const sh of env.game.state.britishShips)
          if (sh.def.isDummy && !env.game.state.britishPositions.has(sh.def.id))
            env.game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
        // 解析坐标放真船
        const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
        while ((m = re.exec(raw)) !== null) {
          const sh = env.game.state.britishShips.find(x => !x.def.isDummy && !env.game.state.britishPositions.has(x.def.id) &&
            (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
          if (sh) env.game.placeBritishToken(sh.def.id, m[2])
        }
        const left = env.game.state.britishShips.filter(x => !env.game.state.britishPositions.has(x.def.id))
        if (left.length > 0) {
          const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
          for (const sh of left) env.game.placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
        }
        env.game.finishSetup()
        steps++; continue
      }

      result = player === 'german' ? ai.selectGerman(obs) : ai.selectBritish(obs)

      if (result.actionId !== null) {
        const action = obs.actions.find(a => a.id === result.actionId)
        if (action) env.step(action)
        else if (obs.actions.length > 0) env.step(obs.actions[0])
      } else if (obs.actions.length > 0) {
        env.step(obs.actions[0])
      }
      steps++
    }

    const s = env.game.state
    if (s.winner === 'german') gerWins++
    else britWins++
    console.log(`局${g+1}: ${s.winner==='german'?'德军':'英军'}胜 T${s.turn} 德${s.vp.german}VP/英${s.vp.british}VP ${steps}步 ${s.victoryReason}`)
  }

  console.log(`\n${GAMES}局: 德军${gerWins}胜 英军${britWins}胜 (${(gerWins/GAMES*100).toFixed(0)}%)`)
}

main().catch(e => { console.error(e); process.exit(1) })
