#!/usr/bin/env npx tsx
/** 俾斯麦 LLM 对战框架 —— 完整日志 + 训练张量 + 低级/高级模式 + 非对称对战 */

import { BismarckEnv } from './engine/env'
import { ActionSelector } from './cli/llm-types'
import { SYS_GERMAN, SYS_BRITISH } from './cli/llm-types'
import { extractActionId } from './cli/llm-client'
import { createLLMLowSelector, createLLMHighSelector } from './cli/action-selector'
import { BattleLogger, StepLog } from './cli/battle-logger'
import { TensorExporter } from './cli/tensor-export'
import * as fs from 'fs'
import * as path from 'path'

// ===== 配置 =====
const MODE = process.argv[2] || 'low'   // low | high | vs
const GAMES = parseInt(process.argv[3] || '1')
const LOG_DIR = process.argv[4] || 'battle_logs'
const TENSOR_DIR = process.argv[5] || `../deeplearn/data/${MODE === 'vs' ? 'ai-vs-ai' : 'ai-vs-ai'}`

function loadKey(): string {
  try {
    const apiFile = fs.readFileSync(path.join(import.meta.dirname, '..', 'api.md'), 'utf-8')
    const m = apiFile.match(/`(sk-[a-zA-Z0-9]+)`/)
    if (m) return m[1]
  } catch {}
  return process.env.DEEPSEEK_API_KEY || ''
}
const KEY = loadKey()

// ===== 终端颜色 =====
const C = { reset:'\x1b[0m', red:'\x1b[31m', green:'\x1b[32m', yellow:'\x1b[33m',
  blue:'\x1b[34m', cyan:'\x1b[36m', gray:'\x1b[90m', purple:'\x1b[35m',
  bold:'\x1b[1m', bgRed:'\x1b[41m', bgGreen:'\x1b[42m' }

// ===== 创建选择器对 =====
function createSelectors(): { german: ActionSelector; british: ActionSelector; gerLabel: string; britLabel: string } {
  if (MODE === 'high') {
    const h = createLLMHighSelector(KEY, 'deepseek-v4-pro')
    return { german: h, british: h, gerLabel: 'v4-pro', britLabel: 'v4-pro' }
  }
  if (MODE === 'vs') {
    return {
      german: createLLMHighSelector(KEY, 'deepseek-v4-pro'),
      british: createLLMLowSelector(KEY, 'deepseek-chat'),
      gerLabel: 'v4-pro', britLabel: 'deepseek-chat'
    }
  }
  const l = createLLMLowSelector(KEY, 'deepseek-chat')
  return { german: l, british: l, gerLabel: 'deepseek-chat', britLabel: 'deepseek-chat' }
}

// ===== 单局 =====
async function runOneBattle(num: number, ger: ActionSelector, brit: ActionSelector, gerLabel: string, britLabel: string) {
  const env = new BismarckEnv()
  const gameId = `battle-${Date.now()}`
  const logger = new BattleLogger(gameId, ger.name, brit.name)
  const tensor = new TensorExporter()
  let steps = 0, stuck = 0, lastPhase = ''

  const t0 = Date.now()
  const both = (s: string) => process.stdout.write(s)

  both(`\n${C.bold}${C.cyan}⚓ 对战 #${num} | 🟥${gerLabel} vs 🟦${britLabel} ⚓${C.reset}\n`)

  while (!env.game.state.gameOver && steps < 200) {
    const obs = env.getObservation()
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

    if (obs.phase === lastPhase) stuck++
    else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 15) {
      const f = obs.actions.find(a => a.type === 'finish-phase')
      if (f) { both(C.yellow + `⚡卡死\n` + C.reset); env.step(f); stuck = 0; continue }
    }

    const s = env.game.state
    const player = obs.activePlayer
    const selector = player === 'german' ? ger : brit
    const sysPrompt = player === 'german' ? SYS_GERMAN : SYS_BRITISH

    if (obs.phase !== lastPhase || steps === 0) {
      both(`\n${C.bold}${C.yellow}━━━ T${s.turn} ${obs.phase} ${player==='german'?'🟥':'🟦'} 德${s.vp.german}VP/英${s.vp.british}VP ━━━${C.reset}\n`)
      lastPhase = obs.phase
    }

    both(C.gray + `${obs.actions.length}选项 ` + C.reset)
    const t1 = Date.now()

    // LLM 调用
    let actionId: number | null = null, raw = '', reasoning = ''
    try {
      const result = await selector.selectAction(obs)
      raw = result.rawResponse; actionId = result.actionId
      reasoning = (result as any).reasoning || ''
    } catch (e: any) {
      both(C.red + `API错误\n` + C.reset)
      await new Promise(r => setTimeout(r, 3000)); continue
    }

    const ms = Date.now() - t1
    let actionLabel = '', actionTypeNum = 0, shipId = '', targetLabel = ''

    // setup-british 特殊处理
    if (obs.phase === 'setup-british') {
      const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
      for (const sh of s.britishShips)
        if (sh.def.isDummy && !s.britishPositions.has(sh.def.id))
          env.game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
      const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
      while ((m = re.exec(raw)) !== null) {
        const sh = s.britishShips.find(x => !x.def.isDummy && !s.britishPositions.has(x.def.id) &&
          (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
        if (sh) { env.game.placeBritishToken(sh.def.id, m[2]); actionLabel = `${sh.def.name}→${m[2]}`; targetLabel = m[2]; shipId = sh.def.id }
      }
      const left = s.britishShips.filter(x => !s.britishPositions.has(x.def.id))
      if (left.length > 0) {
        const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
        for (const sh of left) env.game.placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
      }
      env.game.finishSetup()
      actionTypeNum = 1; actionLabel = actionLabel || '布阵完成'
      both(`${ms}ms ✅\n`)
    } else if (actionId !== null) {
      const action = obs.actions.find(a => a.id === actionId)
      if (action) {
        env.step(action)
        actionLabel = action.label; actionTypeNum = ['move','finish-phase','air-search','combat','transport'].indexOf(action.type)
        shipId = action.params?.shipId || ''; targetLabel = action.params?.targetLabel || ''
        both(`${ms}ms #${actionId}\n`)
      } else {
        both(C.red + `${ms}ms ❌无效ID\n` + C.reset); env.step(obs.actions[0]);
        actionLabel = obs.actions[0]?.label || ''; actionTypeNum = 0
      }
    } else {
      both(C.red + `${ms}ms ❌无法解析\n` + C.reset); env.step(obs.actions[0]);
      actionLabel = obs.actions[0]?.label || ''; actionTypeNum = 0
    }

    // 记录 Tensor 步骤
    tensor.recordStep(s, player, actionTypeNum, shipId, targetLabel)

    // 记录详细日志
    const bismarck = s.germanShips.find(sh => sh.def.id === 'bismarck')
    const bpos = s.germanPositions.get('bismarck')
    logger.logStep({
      step: steps, turn: s.turn, phase: s.phase, side: player,
      selectorName: selector.name,
      systemPrompt: sysPrompt,
      observationText: obs.text,
      actionCount: obs.actions.length,
      rawResponse: raw, reasoning,
      latencyMs: ms,
      actionId, actionLabel,
      vpGerman: s.vp.german, vpBritish: s.vp.british,
      bismarckSteps: bismarck?.steps ?? 0,
      bismarckPos: bpos ? `${String.fromCharCode(65+bpos.q)}${bpos.r+1}` : '?',
      bismarckFound: s.bismarckFound,
    })

    steps++
    if (s.phase === 'game-over') {
      both(`\n${C.bold}${C.bgRed}${C.yellow}===== ${s.winner==='german'?'🟥德军胜':'🟦英军胜'} =====${C.reset}\n`)
      both(`T${s.turn}/18 德${s.vp.german}VP/英${s.vp.british}VP ${s.victoryReason}\n`)
    }
  }

  const sec = ((Date.now()-t0)/1000).toFixed(0)
  both(C.bold + C.cyan + `\n🏁 #${num}结束 ${sec}s ${steps}步\n` + C.reset)

  // 导出日志 + 张量
  fs.mkdirSync(LOG_DIR, { recursive: true })
  const data = logger.finalize(env.game.state)
  logger.writeHumanLog(LOG_DIR)
  logger.writeJsonLog(LOG_DIR)
  if (MODE === 'low') logger.writeTrainingFormat(LOG_DIR)

  fs.mkdirSync(TENSOR_DIR, { recursive: true })
  tensor.export(TENSOR_DIR, gameId, -1)

  both(C.gray + `  日志: ${LOG_DIR}/${gameId}_human.txt\n` + C.reset)
  both(C.gray + `  张量: ${TENSOR_DIR}/${gameId}/\n` + C.reset)

  return { winner: env.game.state.winner, turns: env.game.state.turn,
    vp_g: env.game.state.vp.german, vp_b: env.game.state.vp.british, steps,
    gameId }
}

async function main() {
  const { german, british, gerLabel, britLabel } = createSelectors()
  if (!KEY) { console.error('❌ 未配置API Key。请在 api.md 中填写或设环境变量 DEEPSEEK_API_KEY'); process.exit(1) }

  process.stdout.write(C.bold + `\n模式: ${MODE} | ${GAMES}局\n` + C.reset)
  process.stdout.write(`🟥德军: ${gerLabel}  🟦英军: ${britLabel}\n`)
  process.stdout.write(`日志: ${LOG_DIR}/  张量: ${TENSOR_DIR}/\n`)
  process.stdout.write(`用法: npx tsx battle-llm.ts [low|high|vs] [局数]\n\n`)

  const results = []
  for (let i = 1; i <= GAMES; i++) {
    results.push(await runOneBattle(i, german, british, gerLabel, britLabel))
    if (i < GAMES) await new Promise(r => setTimeout(r, 2000))
  }

  process.stdout.write(C.bold + C.bgGreen + `\n===== ${GAMES}局汇总 =====\n` + C.reset)
  process.stdout.write(`🟥${gerLabel}  🟦${britLabel}\n`)
  for (const r of results)
    process.stdout.write(`${r.gameId}: ${r.winner==='german'?'德军':'英军'}胜 T${r.turns} 德${r.vp_g}VP/英${r.vp_b}VP ${r.steps}步\n`)
}

main().catch(e => { process.stdout.write(C.red + `\n💥 ${e}\n` + C.reset); process.exit(1) })
