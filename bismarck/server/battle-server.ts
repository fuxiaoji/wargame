/**
 * 对战服务器 - WebSocket 通信 + 对战管理 + 断电续传
 * 启动: npx tsx server/battle-server.ts [--port 3001]
 */

import { WebSocketServer, WebSocket } from 'ws'
import { createServer } from 'http'
import { StateManager, BattleResult } from './state-manager'
import * as fs from 'fs'

// ----- 动态导入游戏引擎 (避开 Vite tsconfig 限制) -----
async function runBattle(config: {
  german: { baseUrl: string; apiKey: string; model: string; level?: 'low'|'high' }
  british: { baseUrl: string; apiKey: string; model: string; level?: 'low'|'high' }
  gameId: string
  onProgress: (p: { turn: number; phase: string; germanVp: number; britishVp: number; stepCount: number }) => void
}): Promise<BattleResult> {
  const { BismarckEnv } = await import('../engine/env')
  const { createLLMClient, extractActionId } = await import('../cli/llm-client')
  const { SYS_GERMAN, SYS_BRITISH } = await import('../cli/llm-types')

  const env = new BismarckEnv()
  const gerLvl = config.german.level === 'high' ? 'high' : 'low'
  const britLvl = config.british.level === 'high' ? 'high' : 'low'
  const germanLLM = createLLMClient({ apiKey: config.german.apiKey, baseUrl: config.german.baseUrl, model: config.german.model, level: gerLvl })
  const britishLLM = createLLMClient({ apiKey: config.british.apiKey, baseUrl: config.british.baseUrl, model: config.british.model, level: britLvl })

  let stepCount = 0, stuck = 0, lastPhase = ''

  while (!env.game.state.gameOver && stepCount < 800) {
    const obs = env.getObservation()
    if (obs.actions.length === 0) break
    const player = obs.activePlayer
    const llm = player === 'german' ? germanLLM : britishLLM
    const sysPrompt = player === 'german' ? SYS_GERMAN : SYS_BRITISH

    // 卡死检测
    if (obs.phase === lastPhase) stuck++
    else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 20) {
      const f = obs.actions.find(a => a.type === 'finish-phase')
      if (f) { env.step(f); stuck = 0; continue }
    }

    // === setup-british: 自动放伪装 + LLM选真船位置 ===
    if (obs.phase === 'setup-british') {
      // 自动放伪装
      const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
      for (const sh of env.game.state.britishShips)
        if (sh.def.isDummy && !env.game.state.britishPositions.has(sh.def.id))
          env.game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])

      let raw = ''
      try { raw = (await llm.chat(sysPrompt, obs.text)).content } catch { /* skip LLM error */ }

      const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
      while ((m = re.exec(raw)) !== null) {
        const sh = env.game.state.britishShips.find(x =>
          !x.def.isDummy && !env.game.state.britishPositions.has(x.def.id) &&
          (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
        if (sh) env.game.placeBritishToken(sh.def.id, m[2])
      }
      const left = env.game.state.britishShips.filter(x => !env.game.state.britishPositions.has(x.def.id))
      if (left.length > 0) {
        const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
        for (const sh of left) env.game.placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
      }
      env.game.finishSetup()
      stepCount++; continue
    }

    let actionId: number | null = null
    try {
      const res = await llm.chat(sysPrompt, obs.text)
      actionId = extractActionId(res.content)
    } catch (e: any) {
      return {
        gameId: config.gameId,
        winner: null, germanVp: 0, britishVp: 0, turns: 0,
        reason: `LLM错误: ${e.message?.slice(0, 50)}`,
        timestamp: Date.now(),
        germanModel: config.german.model, britishModel: config.british.model,
      }
    }

    if (actionId !== null) {
      const action = obs.actions.find(a => a.id === actionId)
      if (action) env.step(action)
      else if (obs.actions.length > 0) env.step(obs.actions[0])
    } else if (obs.actions.length > 0) {
      env.step(obs.actions[0])  // 无法解析时 fallback
    }

    stepCount++
    config.onProgress({
      turn: env.game.state.turn,
      phase: env.game.state.phase,
      germanVp: env.game.state.vp.german,
      britishVp: env.game.state.vp.british,
      stepCount,
    })
  }

  const s = env.game.state
  return {
    gameId: config.gameId,
    winner: s.winner,
    germanVp: s.vp.german,
    britishVp: s.vp.british,
    turns: s.turn,
    reason: s.victoryReason,
    timestamp: Date.now(),
    germanModel: config.german.model,
    britishModel: config.british.model,
  }
}

const GERMAN_SYS = `你是俾斯麦号战役的德军指挥官。目标: 6VP立即胜利，或占据布雷斯特(F7)且VP领先。
- 俾斯麦号[攻4/防6/Step4/速2(受损→1)], 欧根亲王号[攻2/防5/Step2/速2]
- 你在地图上隐藏移动，英军看不到你的位置
- 在运输航路(D2/D3/C4/C5/E4/E5)可攻击商船获取VP
- 回复格式: 只回复动作编号数字，如 "3"`

const BRITISH_SYS = `你是俾斯麦号战役的英军指挥官。目标: 击沉俾斯麦号。
- 英军舰船攻防数据见状态信息
- 同格自动触发索敌；皇家方舟号可航空索敌相邻格
- 发现俾斯麦前仅胡德号/威尔士亲王号/伪装算子可移动
- 回复格式: 只回复动作编号数字，如 "3"`

// ===== WebSocket 服务器 =====

export function startServer(port = 3001) {
  const httpServer = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    if (req.method === 'POST' && req.url === '/api/save-game') {
      let body = ''
      req.on('data', c => body += c)
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          const gameType = data.gameType || 'unknown'
          const gameId = data.gameId || ('game-' + Date.now())
          const dir = `../deeplearn/data/${gameType}/${gameId}`
          fs.mkdirSync(dir, { recursive: true })

          if (data.stateBase64) {
            const hdr = Buffer.alloc(20)
            hdr.writeUInt32LE(0x42534D42, 0); hdr.writeInt32LE(73, 4); hdr.writeInt32LE(128, 8)
            hdr.writeInt32LE(8, 12); hdr.writeInt32LE(6, 16)
            const body = Buffer.from(data.stateBase64, 'base64')
            fs.writeFileSync(`${dir}/state.bin`, Buffer.concat([hdr, body]))
          }
          if (data.actionBase64) fs.writeFileSync(`${dir}/action.bin`, Buffer.from(data.actionBase64, 'base64'))
          if (data.result) fs.writeFileSync(`${dir}/result.json`, JSON.stringify(data.result, null, 2))
          if (data.humanLog) fs.writeFileSync(`${dir}/human_log.txt`, data.humanLog)

          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, dir }))
          console.log(`💾 游戏数据已保存: ${dir}`)
        } catch (e: any) {
          res.writeHead(500); res.end(JSON.stringify({ error: e.message }))
        }
      })
      return
    }
    res.writeHead(404); res.end('not found')
  })
  const wss = new WebSocketServer({ server: httpServer })
  const sm = new StateManager()

  let activeBattles = 0
  let stopRequested = false

  function broadcast(data: object) {
    const msg = JSON.stringify(data)
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg) })
  }

  function sendState(ws?: WebSocket) {
    const payload = JSON.stringify({
      type: 'state',
      ...sm.state,
      stats: sm.stats(),
      activeBattles,
    })
    if (ws) ws.send(payload)
    else broadcast(JSON.parse(payload))  // Already JSON, just re-stringify
  }

  function sendAll() {
    const p = {
      type: 'state',
      config: sm.state.config,
      total: sm.state.total,
      completed: sm.state.completed,
      results: sm.state.results,
      current: sm.state.current,
      running: sm.state.running,
      paused: sm.state.paused,
      stats: sm.stats(),
      activeBattles,
    }
    broadcast(p)
  }

  async function runBattleQueue() {
    if (sm.state.running) return
    sm.state.running = true
    stopRequested = false
    sm.save()

    const total = sm.state.total
    const swap = sm.state.config.swapSides
    const parallel = sm.state.config.parallel

    while (sm.state.completed < total && !stopRequested) {
      // 控制并发数
      while (activeBattles >= parallel && !stopRequested) {
        await sleep(500)
      }
      if (stopRequested) break

      const gameIdx = sm.state.completed
      const swapSides = swap && gameIdx % 2 === 1
      const cfg = {
        german: swapSides ? sm.state.config.british : sm.state.config.german,
        british: swapSides ? sm.state.config.german : sm.state.config.british,
        gameId: `battle-${Date.now()}-${gameIdx}`,
        onProgress: (p: any) => {
          sm.setProgress({ gameId: `battle-${Date.now()}-${gameIdx}`, ...p })
          if (gameIdx % 5 === 0) sendAll()
        },
      }

      activeBattles++
      const gid = cfg.gameId
      runBattle(cfg).then(result => {
        sm.addResult(result)
        sm.removeProgress(gid)
        activeBattles--
        sendAll()
      }).catch(e => {
        console.error(`Battle ${gid} error:`, e)
        sm.addResult({
          gameId: gid, winner: null, germanVp: 0, britishVp: 0, turns: 0,
          reason: `异常: ${String(e).slice(0, 80)}`,
          timestamp: Date.now(),
          germanModel: cfg.german.model, britishModel: cfg.british.model,
        })
        sm.removeProgress(gid)
        activeBattles--
        sendAll()
      })

      // 避免启动过快
      await sleep(200)
    }

    sm.state.running = false
    sm.save()
    sendAll()
  }

  function stopAll() {
    stopRequested = true
    sm.state.running = false
    sm.save()
    sendAll()
  }

  wss.on('connection', (ws) => {
    console.log('Dashboard connected')
    sendAll()

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        switch (msg.type) {
          case 'config':
            sm.updateConfig(msg.config)
            sendAll()
            break
          case 'start':
            sm.state.total = msg.total ?? 100
            sm.state.completed = 0
            sm.state.results = []
            sm.state.current = []
            sm.state.running = false
            sm.save()
            sendAll()
            runBattleQueue()
            break
          case 'resume':
            runBattleQueue()
            break
          case 'stop':
            stopAll()
            break
          case 'reset':
            sm.reset(true)
            sendAll()
            break
        }
      } catch (e) {
        console.error('Invalid message:', e)
      }
    })

    ws.on('close', () => console.log('Dashboard disconnected'))
  })

  httpServer.listen(port, () => {
    console.log(`⚓ 俾斯麦对战服务器: ws://localhost:${port}`)
    console.log(`   剩余进度: ${sm.state.completed}/${sm.state.total}`)
    if (sm.state.completed < sm.state.total && !sm.state.running) {
      console.log('   (发送 start 消息开始/继续对战)')
    }
  })
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// 直接运行时启动
const isMain = process.argv[1]?.endsWith('battle-server.ts') || process.argv[1]?.endsWith('battle-server.js')
if (isMain) {
  const portIdx = process.argv.indexOf('--port')
  const port = portIdx >= 0 ? parseInt(process.argv[portIdx + 1]) : 3001
  startServer(port)
}
