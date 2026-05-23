/** 详细对战日志器 —— 记录每一步的提示词/LLM回复/状态/VP变化 */

import * as fs from 'fs'
import type { GameState } from '../engine/types'
import type { GameObservation } from './llm-types'

export interface StepLog {
  step: number
  turn: number
  phase: string
  side: 'german' | 'british'
  selectorName: string
  // 发送给 LLM 的
  systemPrompt: string
  observationText: string
  actionCount: number
  // LLM 回复
  rawResponse: string
  reasoning?: string
  latencyMs: number
  // 选中的动作
  actionId: number | null
  actionLabel: string
  // 状态快照
  vpGerman: number
  vpBritish: number
  bismarckSteps: number
  bismarckPos: string
  bismarckFound: boolean
  // 特殊事件
  combatResult?: any
  transportResult?: any
}

export class BattleLogger {
  private steps: StepLog[] = []
  private battleId: string
  private startTime: number

  constructor(battleId: string, private gerModel: string, private britModel: string) {
    this.battleId = battleId
    this.startTime = Date.now()
  }

  logStep(s: StepLog) { this.steps.push(s) }

  finalize(state: GameState) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(0)
    const metadata = {
      battle_id: this.battleId,
      ger_model: this.gerModel,
      brit_model: this.britModel,
      winner: state.winner || 'draw',
      vp_german: state.vp.german,
      vp_british: state.vp.british,
      turns: state.turn,
      total_steps: this.steps.length,
      duration_sec: parseInt(duration),
      victory_reason: state.victoryReason,
      timestamp: new Date().toISOString(),
    }

    return {
      metadata,
      steps: this.steps,
    }
  }

  // 写入人类可读日志
  writeHumanLog(dir: string) {
    const lines: string[] = []
    const p = (s = '') => lines.push(s)

    p(`===== 俾斯麦 LLM 对战日志 =====`)
    p(`对战ID: ${this.battleId}`)
    p(`德军: ${this.gerModel}  |  英军: ${this.britModel}`)
    p(`时间: ${new Date().toISOString()}`)
    p()

    let lastTurn = 0, lastPhase = ''
    for (const s of this.steps) {
      if (s.turn !== lastTurn || s.phase !== lastPhase) {
        p(`━━━ T${s.turn} ${s.phase} ${s.side==='german'?'🟥德军':'🟦英军'} 德${s.vpGerman}VP/英${s.vpBritish}VP ━━━`)
        lastTurn = s.turn; lastPhase = s.phase
      }

      p(`  步${s.step} | ${s.selectorName} | ${s.actionCount}选项 | ${s.latencyMs}ms`)
      p(`  📤 提示词(首200字): ${s.systemPrompt.slice(0, 200).replace(/\n/g, ' ')}`)
      p(`  📤 观测(首300字): ${s.observationText.slice(0, 300).replace(/\n/g, ' ')}`)
      if (s.reasoning) p(`  🧠 思考: ${s.reasoning.slice(0, 400).replace(/\n/g, ' ')}`)
      p(`  📥 LLM回复: "${s.rawResponse.slice(0, 200)}"`)
      p(`  🎯 选择: #${s.actionId} ${s.actionLabel}`)

      if (s.combatResult) p(`  ⚔ 战斗: 德+${s.combatResult.germanVpGained}VP 英+${s.combatResult.britishVpGained}VP 击沉:${s.combatResult.shipsSunk?.join(',')}`)
      if (s.transportResult) p(`  🚢 运输: ${s.transportResult.description}`)
      if (s.bismarckFound && s.phase.includes('search')) p(`  ⚠ 俾斯麦位置暴露!`)
      p()
    }

    const state = this.steps[this.steps.length - 1]
    p(`===== 终局 =====`)
    p(`胜者: ${state?.vpGerman ?? 0 > (state?.vpBritish ?? 0) ? '德军' : '英军'}`)
    p(`步数: ${this.steps.length}`)
    p()

    fs.writeFileSync(`${dir}/${this.battleId}_human.txt`, lines.join('\n'))
  }

  // 写入 JSON 详细日志（给训练用）
  writeJsonLog(dir: string) {
    const state = this.steps.length > 0 ? {
      vpGerman: this.steps[this.steps.length-1].vpGerman,
      vpBritish: this.steps[this.steps.length-1].vpBritish,
      winner: '?'
    } : null

    const data = {
      metadata: {
        battle_id: this.battleId,
        ger_model: this.gerModel,
        brit_model: this.britModel,
        winner: state?.winner,
        total_steps: this.steps.length,
        timestamp: new Date().toISOString(),
      },
      steps: this.steps.map(s => ({
        step: s.step, turn: s.turn, phase: s.phase, side: s.side,
        selector: s.selectorName, action_count: s.actionCount,
        action_id: s.actionId, action_label: s.actionLabel,
        latency_ms: s.latencyMs,
        vp_g: s.vpGerman, vp_b: s.vpBritish,
        bismarck_pos: s.bismarckPos, bismarck_steps: s.bismarckSteps,
        bismarck_found: s.bismarckFound,
        raw_response: s.rawResponse.slice(0, 200),
        reasoning: (s.reasoning || '').slice(0, 400),
      })),
    }
    fs.writeFileSync(`${dir}/${this.battleId}_log.json`, JSON.stringify(data, null, 2))
  }

  // 写入 LLM 训练格式（对话格式，可直接微调）
  writeTrainingFormat(dir: string) {
    const conversations: any[] = []
    for (const s of this.steps) {
      conversations.push({
        messages: [
          { role: 'system', content: s.systemPrompt },
          { role: 'user', content: s.observationText },
          { role: 'assistant', content: String(s.actionId || '') },
        ]
      })
    }
    fs.writeFileSync(`${dir}/${this.battleId}_training.jsonl`,
      conversations.map(c => JSON.stringify(c)).join('\n'))
  }
}
