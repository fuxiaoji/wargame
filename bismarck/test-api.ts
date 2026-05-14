import { LLMClient } from './cli/llm-client'

async function main() {
  const KEY = 'sk-cp-XjUgmt_U54CNXjdwRRuPIPnKJBGSqVNFLazkfUaEeRPuiEyWEVvFnaKzJNwXtizkiC_z6BJhzbkP1NqHUY60zmCEv9LNbPRZ8a0kv1Hz49TjO3AB9jkIGf4'

  for (const model of ['MiniMax-Text-01', 'abab6.5-chat', 'abab5.5-chat', 'minimax-text-01']) {
    const mm = new LLMClient({
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: KEY,
      model,
    })
    console.log(`Testing MiniMax [${model}]...`)
    try {
      const r = await mm.chat('回复数字1即可', '回复1')
      console.log(`  OK: ${r.content?.slice(0, 50)}`)
    } catch(e: any) { console.error(`  FAIL: ${e.message?.slice(0, 150)}`) }
  }
}

main()
