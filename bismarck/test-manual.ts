import { BismarckEnv, GameAction, GameObservation } from './engine/env'
import * as readline from 'readline'

const KEY = process.env.DEEPSEEK_API_KEY || ''
const MODEL = 'deepseek-chat'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const ask = (q: string) => new Promise<string>(r => rl.question(q, r))

const RULES = `你是俾斯麦号战役英军指挥官。目标:击沉俾斯麦号。
固定:C6(乔治五世/反击/胜利),D6(罗德尼),F4(声望/皇家方舟),F1(拉米伊)。
发现前仅胡德/威尔士亲王/伪装可移动。皇家方舟可航空索敌。仅回复数字。`

async function main() {
  console.log('===== 手动德军 vs AI英军 测试 =====\n')

  const env = new BismarckEnv()
  let step = 0

  while (!env.game.state.gameOver && step < 500) {
    const obs = env.getObservation()
    const player = obs.activePlayer

    // 显示状态
    console.log(`\n${'='.repeat(50)}`)
    console.log(`步${step} | T${obs.raw.turn} | ${obs.phase} | 德VP${obs.raw.vp.german}/英VP${obs.raw.vp.british}`)

    if (player === 'german') {
      // 德军: 我手动操作
      console.log(obs.text)
      console.log('')
      const answer = await ask('选择动作编号(回车=结束回合): ')
      const id = parseInt(answer)
      if (isNaN(id)) {
        // 选 finish-phase
        const fa = obs.actions.find(a => a.type === 'finish-phase')
        if (fa) env.step(fa)
        else env.step(obs.actions[0])
      } else {
        const a = obs.actions.find(a => a.id === id)
        if (a) {
          const r = env.step(a)
          if (!r.ok) console.log(`⚠ ${r.error}`)
        } else {
          console.log('无效ID, 选第一个')
          env.step(obs.actions[0])
        }
      }
    } else {
      // 英军: AI
      console.log('🤖 AI英军思考...')
      try {
        const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${KEY}` },
          body: JSON.stringify({
            model: MODEL, temperature: 0.3, max_tokens: 300,
            reasoning_effort: 'low',
            messages: [
              { role: 'system', content: RULES },
              { role: 'user', content: obs.text },
            ],
          }),
        })
        const d = await res.json() as any
        const answer = d.choices?.[0]?.message?.content || ''
        const m = answer.match(/\[?(\d+)\]?/)
        const id = m ? parseInt(m[1]) : null

        if (id !== null) {
          const a = obs.actions.find(x => x.id === id)
          if (a) {
            console.log(`  AI选[${id}] ${a.label.slice(0, 60)}`)
            env.step(a)
          } else {
            console.log(`  无效ID ${id}, 选finish`)
            const fa = obs.actions.find(x => x.type === 'finish-phase')
            if (fa) env.step(fa)
          }
        } else {
          console.log(`  无法解析: "${answer.slice(0, 60)}"`)
          const fa = obs.actions.find(x => x.type === 'finish-phase')
          if (fa) env.step(fa)
        }
      } catch (e: any) {
        console.log(`  API错误: ${e.message?.slice(0, 60)}`)
        break
      }
    }

    step++
  }

  const s = env.game.state
  console.log(`\n===== ${s.winner === 'german' ? '德军胜' : '英军胜'} | T${s.turn} | 德${s.vp.german}VP/英${s.vp.british}VP =====`)
  rl.close()
}

main().catch(e => { console.error(e); rl.close() })
