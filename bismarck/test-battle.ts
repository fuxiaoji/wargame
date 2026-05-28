import { BismarckEnv } from './engine/env'
import { LLMClient } from './cli/llm-client'
import * as fs from 'fs'

const KEY = process.env.DEEPSEEK_API_KEY || ''

const RULES = `## 击沉俾斯麦号 游戏规则

你是俾斯麦号战役的指挥官。1941年北大西洋海战推演。

### 胜利条件
- 德军: 6VP立即胜利，或回合结束时占据布雷斯特(F7)且VP领先
- 英军: 击沉俾斯麦号立即胜利，或18回合结束德军未胜
- 1 Step伤害 = 1VP

### 地图 (字母A-G从上到下, 数字1-8从左到右, 奇数列B/D/F左偏)
- F7=布雷斯特, D8=斯卡帕湾, G6=伦敦
- 运输航路: D2/D3/C4/C5(大西洋), E4/E5(非洲)
- 德军起始: A5/A6/B7
- 陆地块: A3/A4/B3/B4/G4/G5/G6

### 德军
俾斯麦号[攻4/防6/4Step/速2(损→1)], 欧根亲王号[攻2/防5/2Step/速2]
隐藏移动。航路上可攻击商船。

### 英军
固定: B7(乔治五世/反击/胜利), C6(罗德尼), F4(声望/皇家方舟), F1(拉米伊)
自由: 胡德[攻4/防6/2Step], 威尔士亲王[攻3/防6/2Step], 诺福克[攻2/防5/1Step], 萨福克[攻2/防5/1Step], 伪装×4
发现前仅胡德/威尔士亲王/伪装可移动。皇家方舟可航空索敌。
2Step舰受损后攻击-2。

### 战斗: 航空优先, 按攻降序。投攻N个D6, ≥防=命中。`

const GERMAN_SYS = RULES + `\n你是德军。仅回复数字，如"3"。`
const BRITISH_SYS = RULES + `\n你是英军。仅回复数字，如"3"。`

async function main() {
  console.log('===== 俾斯麦号 AI对战 (含LLM记录) =====\n')

  const llm = (model: string) => new LLMClient({
    baseUrl: 'https://api.deepseek.com/v1', apiKey: KEY, model, temperature: 0.3, maxTokens: 200,
  })
  const germanLLM = llm('deepseek-chat')
  const britishLLM = llm('deepseek-chat')

  const env = new BismarckEnv()
  let stepCount = 0, stuckCount = 0, lastPhase = ''
  const startTime = Date.now()

  while (!env.game.state.gameOver && stepCount < 500) {
    const obs = env.getObservation()

    if (obs.phase === lastPhase) stuckCount++
    else { stuckCount = 0; lastPhase = obs.phase }

    if (stuckCount > 15) {
      const finishAction = obs.actions.find(a => a.type === 'finish-phase')
      if (finishAction) {
        env.log.L('llm', `[强制推进] 卡死15步，自动执行: ${finishAction.label}`)
        console.log(`  ⚡ 强制推进: ${finishAction.label}`)
        env.step(finishAction)
      }
      stuckCount = 0; continue
    }

    if (obs.phase !== lastPhase || stepCount === 0) {
      const s = env.game.state
      console.log(`\n[步${stepCount}] ${obs.activePlayer === 'german' ? '🟥德军' : '🟦英军'} | ${obs.phase} | T${s.turn} | 德${s.vp.german}VP/英${s.vp.british}VP`)
    }

    const player = obs.activePlayer
    const llmClient = player === 'german' ? germanLLM : britishLLM
    const sys = player === 'german' ? GERMAN_SYS : BRITISH_SYS

    try {
      const t0 = Date.now()
      const res = await llmClient.chat(sys, obs.text)
      const latency = Date.now() - t0
      const rawAnswer = res.content.trim()
      const m = rawAnswer.match(/\[?(\d+)\]?/)
      const actionId = m ? parseInt(m[1]) : null

      if (actionId !== null) {
        const action = obs.actions.find(a => a.id === actionId)
        if (action) {
          env.step(action)
          // 记录 LLM 回答到日志
          env.log.L('llm', `[${player === 'german' ? '德' : '英'}] #${actionId} ${action.label}`, `LLM: ${rawAnswer.slice(0, 100)}`)
          console.log(`  🤖 → [${actionId}] ${action.label.slice(0, 70)} (${latency}ms)`)
        } else {
          env.log.L('llm', `[${player === 'german' ? '德' : '英'}] 无效动作${actionId}`, `LLM: ${rawAnswer.slice(0, 100)}. 可用: [${obs.actions.map(a => a.id).join(',')}]`)
          console.log(`  ⚠ 无效动作 ${actionId}, LLM回复: "${rawAnswer.slice(0, 80)}"`)
        }
      } else {
        env.log.L('llm', `[${player === 'german' ? '德' : '英'}] 无法解析`, `LLM: ${rawAnswer.slice(0, 200)}`)
        console.log(`  ❌ 无法解析: "${rawAnswer.slice(0, 80)}"`)
      }
    } catch (e: any) {
      env.log.L('llm', `[${player === 'german' ? '德' : '英'}] API错误: ${e.message?.slice(0, 100)}`)
      console.error(`  💥 ${e.message?.slice(0, 120)}`)
      await new Promise(r => setTimeout(r, 5000))
    }

    stepCount++
    if (stepCount % 5 === 0) await new Promise(r => setTimeout(r, 100))
  }

  const s = env.game.state
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0)
  console.log(`\n===== 终局 (${elapsed}s ${stepCount}步) =====`)
  console.log(`胜者: ${s.winner === 'german' ? '德军' : s.winner === 'british' ? '英军' : '异常'}`)
  console.log(`回合: ${s.turn}/18 | 德VP: ${s.vp.german} | 英VP: ${s.vp.british}`)
  console.log(`原因: ${s.victoryReason}`)

  // 保存日志
  fs.mkdirSync('battle-logs', { recursive: true })
  const logPath = `battle-logs/${env.log.sessionId}.json`
  fs.writeFileSync(logPath, env.log.exportSession(), 'utf-8')
  fs.writeFileSync('battle-logs/latest.json', env.log.exportSession(), 'utf-8')

  console.log(`\n日志已保存: ${logPath} (${env.log.entries.length}条)`)

  // LLM 调用统计
  const llmCalls = env.log.entries.filter(e => e.type === 'llm').length
  console.log(`LLM调用: ${llmCalls}次 | 游戏事件: ${env.log.entries.length - llmCalls}条`)
}

main().catch(e => console.error('Fatal:', e))
