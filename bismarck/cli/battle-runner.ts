/**
 * AI 对战运行器
 * 用法:
 *   npx tsx cli/battle-runner.ts \
 *     --german-url http://localhost:8000/v1 --german-key sk-xxx --german-model qwen3 \
 *     --british-url http://localhost:8000/v1 --british-key sk-xxx --british-model qwen3 \
 *     --games 10
 */

import { BismarckEnv } from '../engine/env'
import { LLMClient, LLMConfig } from './llm-client'
import { GameLog } from '../engine/log'
import * as fs from 'fs'
import * as path from 'path'

// ===== 参数解析 =====

interface BattleConfig {
  german: LLMConfig
  british: LLMConfig
  games: number
  verbose: boolean
  outputDir: string
}

function parseArgs(): BattleConfig {
  const args = process.argv.slice(2)
  const get = (key: string) => {
    const idx = args.indexOf(key)
    return idx >= 0 ? args[idx + 1] : undefined
  }

  const germanUrl = get('--german-url') || process.env.GERMAN_LLM_URL || 'http://localhost:8000/v1'
  const germanKey = get('--german-key') || process.env.GERMAN_LLM_KEY || 'sk-local'
  const germanModel = get('--german-model') || process.env.GERMAN_LLM_MODEL || 'qwen3'

  const britishUrl = get('--british-url') || process.env.BRITISH_LLM_URL || 'http://localhost:8000/v1'
  const britishKey = get('--british-key') || process.env.BRITISH_LLM_KEY || 'sk-local'
  const britishModel = get('--british-model') || process.env.BRITISH_LLM_MODEL || 'qwen3'

  return {
    german: { baseUrl: germanUrl, apiKey: germanKey, model: germanModel },
    british: { baseUrl: britishUrl, apiKey: britishKey, model: britishModel },
    games: parseInt(get('--games') ?? '1'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    outputDir: get('--output') || './battle-logs',
  }
}

// ===== 系统提示词 =====

const GERMAN_SYSTEM = `你是德军指挥官，指挥俾斯麦号和欧根亲王号突破英军封锁。
目标: 获得6VP立即胜利，或在回合结束时占据布雷斯特(F7)且VP领先。

规则要点:
- 你的位置对英军隐藏（除非被发现或信号泄露）
- 俾斯麦速度2(受损→1)，欧根亲王速度2
- 可攻击运输舰队获取VP（在航路上且未发生战斗时）
- 每造成敌方1 Step伤害=1VP
- 避免与优势英军舰队正面交战

回复格式: 只回复一个数字(动作编号)，如 "3" 或 "[3]"。`

const BRITISH_SYSTEM = `你是英军指挥官，指挥本土舰队搜索并击沉俾斯麦号。
目标: 击沉俾斯麦号立即胜利，或撑过18回合德军未获胜。

规则要点:
- 你可以看到所有英军算子位置
- 发现德军前，仅胡德号、威尔士亲王号、伪装算子可移动
- 皇家方舟号可执行航空索敌(搜索相邻格)
- 每造成敌方1 Step伤害=1VP
- 战斗按攻击力从高到低依次结算
- 航空攻击优先结算

回复格式: 只回复一个数字(动作编号)，如 "3" 或 "[3]"。`

// ===== 动作解析 =====

function parseActionId(llmOutput: string): number | null {
  // 尝试匹配 [数字] 或 纯数字
  const m1 = llmOutput.match(/\[(\d+)\]/)
  if (m1) return parseInt(m1[1])
  const m2 = llmOutput.match(/^(\d+)/)
  if (m2) return parseInt(m2[1])
  // 搜索所有数字，取第一个
  const m3 = llmOutput.match(/\d+/)
  if (m3) return parseInt(m3[0])
  return null
}

// ===== 主循环 =====

async function runOneGame(germanLLM: LLMClient, britishLLM: LLMClient, gameIdx: number, cfg: BattleConfig) {
  const env = new BismarckEnv()
  let stepCount = 0

  console.log(`\n===== 第 ${gameIdx + 1} 局开始 =====`)

  while (!env.game.state.gameOver && stepCount < 500) {
    const obs = env.getObservation()
    const player = obs.activePlayer
    const llm = player === 'german' ? germanLLM : britishLLM
    const sysPrompt = player === 'german' ? GERMAN_SYSTEM : BRITISH_SYSTEM

    if (cfg.verbose) {
      console.log(`\n[Step ${stepCount}] ${player === 'german' ? '德军' : '英军'} 回合`)
      console.log(obs.text)
    }

    // 调用 LLM
    let actionId: number | null = null
    try {
      const res = await llm.chat(sysPrompt, obs.text)
      actionId = parseActionId(res.content)
      if (cfg.verbose) {
        console.log(`LLM 回复: "${res.content.slice(0, 100)}" → 动作 ${actionId}`)
      }
    } catch (e) {
      console.error(`LLM 调用失败: ${e}`)
      break
    }

    if (actionId === null) {
      console.error('无法解析 LLM 回复，跳过')
      break
    }

    // 查找动作
    const action = obs.actions.find(a => a.id === actionId)
    if (!action) {
      console.error(`无效动作 ${actionId}，可用: [${obs.actions.map(a => a.id).join(', ')}]`)
      // 尝试随机选一个
      if (obs.actions.length > 0) {
        const rand = obs.actions[Math.floor(Math.random() * obs.actions.length)]
        console.log(`随机选择动作 ${rand.id}: ${rand.label}`)
        env.step(rand)
      }
    } else {
      const r = env.step(action)
      if (!r.ok) {
        console.error(`动作失败: ${r.error}`)
      }
    }

    stepCount++
  }

  // 结果
  const result = env.game.state
  const winner = result.winner === 'german' ? '德军胜' : result.winner === 'british' ? '英军胜' : '未知'
  console.log(`===== 第 ${gameIdx + 1} 局结束: ${winner} | 回合${result.turn} | 德VP${result.vp.german}/英VP${result.vp.british} | ${result.victoryReason} =====`)

  // 保存日志
  if (!fs.existsSync(cfg.outputDir)) fs.mkdirSync(cfg.outputDir, { recursive: true })
  const logPath = path.join(cfg.outputDir, `${env.log.sessionId}.json`)
  fs.writeFileSync(logPath, env.log.exportSession(), 'utf-8')
  console.log(`日志已保存: ${logPath}`)

  return { winner: result.winner, turns: result.turn, vp: result.vp }
}

// ===== 入口 =====

async function main() {
  const cfg = parseArgs()

  console.log('===== 击沉俾斯麦号 AI对战 =====')
  console.log(`德军模型: ${cfg.german.model} @ ${cfg.german.baseUrl}`)
  console.log(`英军模型: ${cfg.british.model} @ ${cfg.british.baseUrl}`)
  console.log(`对局数: ${cfg.games}`)

  const germanLLM = new LLMClient(cfg.german)
  const britishLLM = new LLMClient(cfg.british)

  let germanWins = 0, britishWins = 0
  const startTime = Date.now()

  for (let i = 0; i < cfg.games; i++) {
    const r = await runOneGame(germanLLM, britishLLM, i, cfg)
    if (r.winner === 'german') germanWins++
    else if (r.winner === 'british') britishWins++
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log(`\n===== 全部结束 =====`)
  console.log(`德军 ${germanWins} 胜 / 英军 ${britishWins} 胜 / ${cfg.games} 局`)
  console.log(`用时: ${elapsed}s`)
}

main().catch(console.error)
