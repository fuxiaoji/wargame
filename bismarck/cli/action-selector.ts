/** 行动选择器 —— 随机 / LLM低级 / LLM高级 / 状态机(后续) */

import { ActionSelector, GameObservation, SYS_GERMAN, SYS_BRITISH } from './llm-types'
import { createLLMClient, extractActionId } from './llm-client'

// ===== 随机选择器 =====
export function createRandomSelector(): ActionSelector {
  return {
    name: 'random',
    async selectAction(obs) {
      if (obs.actions.length === 0) return { actionId: null, rawResponse: '' }
      const pick = obs.actions[Math.floor(Math.random() * obs.actions.length)]
      return { actionId: pick.id, rawResponse: `random:${pick.id}` }
    }
  }
}

// ===== LLM 低级选择器 (只出数字) =====
export function createLLMLowSelector(apiKey: string, model = 'deepseek-chat'): ActionSelector {
  const llm = createLLMClient({
    apiKey, baseUrl: 'https://api.deepseek.com/v1', model, level: 'low'
  })
  return {
    name: `llm-low(${model})`,
    async selectAction(obs) {
      const sys = obs.activePlayer === 'german' ? SYS_GERMAN : SYS_BRITISH
      const res = await llm.chat(sys, obs.text)
      const id = extractActionId(res.content)
      return { actionId: id, rawResponse: res.content }
    }
  }
}

// ===== LLM 高级选择器 (带推理过程) =====
export function createLLMHighSelector(apiKey: string, model = 'deepseek-v4-pro',
  onReasoning?: (text: string) => void
): ActionSelector {
  const llm = createLLMClient({
    apiKey, baseUrl: 'https://api.deepseek.com/v1', model, level: 'high'
  })
  return {
    name: `llm-high(${model})`,
    async selectAction(obs) {
      const sys = obs.activePlayer === 'german' ? SYS_GERMAN : SYS_BRITISH
      const res = await llm.chat(sys, obs.text, onReasoning)
      const id = extractActionId(res.content)
      // 如果 content 没提取到，从 reasoning 找
      const finalId = id ?? extractActionId(res.reasoning || '')
      return { actionId: finalId, rawResponse: res.content || res.reasoning || '' }
    }
  }
}

// ===== 状态机选择器 (占位，下一步实现) =====
export function createStateMachineSelector(): ActionSelector {
  return {
    name: 'state-machine',
    async selectAction(_obs) {
      // TODO: 实现启发式状态机
      return { actionId: null, rawResponse: 'state-machine: not implemented' }
    }
  }
}
