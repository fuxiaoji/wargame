/** 统一 LLM 客户端 — 支持低级(快)和高级(推理)两种模式 */

import { LLMConfig, FORMAT_LOW, FORMAT_HIGH } from './llm-types'

export interface LLMResponse {
  content: string
  reasoning?: string
  usage?: { promptTokens: number; completionTokens: number }
}

// ===== 低级模式: 非流式，只出数字 =====
async function callLowLevel(cfg: LLMConfig, sys: string, user: string): Promise<LLMResponse> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, temperature: 0.1, max_tokens: 10,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user + FORMAT_LOW },
      ],
    }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json() as any
  return { content: data.choices[0].message.content?.trim() || '' }
}

// ===== 高级模式: 流式，捕获推理过程 =====
async function callHighLevel(cfg: LLMConfig, sys: string, user: string,
  onReasoning?: (text: string) => void
): Promise<LLMResponse> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, temperature: 0.3, max_tokens: 600, stream: true,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user + FORMAT_HIGH },
      ],
    }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let content = '', reasoning = '', buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6)
      if (json === '[DONE]') continue
      try {
        const delta = JSON.parse(json).choices?.[0]?.delta
        if (delta?.reasoning_content) {
          reasoning += delta.reasoning_content
          onReasoning?.(delta.reasoning_content)
        }
        if (delta?.content) content += delta.content
      } catch {}
    }
  }
  return { content: content.trim(), reasoning: reasoning.trim() || undefined }
}

// ===== 导出 =====
export function createLLMClient(cfg: LLMConfig) {
  return {
    config: cfg,
    async chat(sys: string, user: string, onReasoning?: (t: string) => void): Promise<LLMResponse> {
      if (cfg.level === 'high') return callHighLevel(cfg, sys, user, onReasoning)
      return callLowLevel(cfg, sys, user)
    }
  }
}

// 提取动作编号
export function extractActionId(raw: string): number | null {
  // 优先 [N] 格式
  let m = raw.match(/\[(\d+)\]/)
  if (m) return parseInt(m[1])
  // 其次行首纯数字
  m = raw.match(/^(\d+)/m)
  if (m) return parseInt(m[1])
  // 最后任意数字
  m = raw.match(/\d+/)
  return m ? parseInt(m[0]) : null
}
