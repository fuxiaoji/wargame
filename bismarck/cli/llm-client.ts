/**
 * LLM API 客户端 (OpenAI 兼容接口)
 * 支持 OpenAI / Anthropic / 本地模型 (vLLM, Ollama 等)
 */

export interface LLMConfig {
  baseUrl: string       // API 地址, 如 https://api.openai.com/v1
  apiKey: string        // API Key
  model: string         // 模型名, 如 gpt-4o / claude-sonnet-4-20250514
  temperature?: number  // 默认 0.3
  maxTokens?: number    // 默认 2000
}

export interface LLMResponse {
  content: string
  usage?: { promptTokens: number; completionTokens: number }
}

export class LLMClient {
  config: LLMConfig

  constructor(config: LLMConfig) {
    this.config = {
      temperature: 0.3,
      maxTokens: 2000,
      ...config,
    }
  }

  async chat(systemPrompt: string, userMessage: string): Promise<LLMResponse> {
    const url = `${this.config.baseUrl}/chat/completions`

    const body = JSON.stringify({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    })

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body,
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`LLM API error ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    return {
      content: data.choices[0].message.content as string,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      } : undefined,
    }
  }
}
