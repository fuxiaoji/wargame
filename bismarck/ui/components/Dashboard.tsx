import { useState, useEffect, useRef, useCallback } from 'react'

interface LLMConfig {
  baseUrl: string; apiKey: string; model: string
}

interface ServerState {
  config: { german: LLMConfig; british: LLMConfig; swapSides: boolean; parallel: number }
  total: number; completed: number
  results: BattleResult[];
  current: BattleProgress[];
  running: boolean; paused: boolean
  stats: { germanWins: number; britishWins: number; total: number; avgGermanVp: number; avgBritishVp: number; avgTurns: number }
  activeBattles: number
}

interface BattleResult {
  gameId: string; winner: string | null; germanVp: number; britishVp: number
  turns: number; reason: string; timestamp: number
  germanModel: string; britishModel: string
}

interface BattleProgress {
  gameId: string; turn: number; phase: string; germanVp: number; britishVp: number; stepCount: number
}

interface DashboardProps {
  onClose: () => void
}

export function Dashboard({ onClose }: DashboardProps) {
  const [connected, setConnected] = useState(false)
  const [state, setState] = useState<ServerState | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [port, setPort] = useState(() => localStorage.getItem('bismarck_server_port') || '3001')

  // 表单状态
  const [germanUrl, setGermanUrl] = useState(() => localStorage.getItem('bismarck_ger_url') || 'http://localhost:8000/v1')
  const [germanKey, setGermanKey] = useState(() => localStorage.getItem('bismarck_ger_key') || 'sk-local')
  const [germanModel, setGermanModel] = useState(() => localStorage.getItem('bismarck_ger_model') || 'qwen3')
  const [britishUrl, setBritishUrl] = useState(() => localStorage.getItem('bismarck_br_url') || 'http://localhost:8000/v1')
  const [britishKey, setBritishKey] = useState(() => localStorage.getItem('bismarck_br_key') || 'sk-local')
  const [britishModel, setBritishModel] = useState(() => localStorage.getItem('bismarck_br_model') || 'qwen3')
  const [swapSides, setSwapSides] = useState(() => localStorage.getItem('bismarck_swap') === 'true')
  const [battleCount, setBattleCount] = useState(() => parseInt(localStorage.getItem('bismarck_count') || '100'))
  const [parallel, setParallel] = useState(() => parseInt(localStorage.getItem('bismarck_parallel') || '4'))

  const portRef = useRef(port)
  portRef.current = port

  const saveConfig = useCallback(() => {
    localStorage.setItem('bismarck_server_port', port)
    localStorage.setItem('bismarck_ger_url', germanUrl); localStorage.setItem('bismarck_ger_key', germanKey); localStorage.setItem('bismarck_ger_model', germanModel)
    localStorage.setItem('bismarck_br_url', britishUrl); localStorage.setItem('bismarck_br_key', britishKey); localStorage.setItem('bismarck_br_model', britishModel)
    localStorage.setItem('bismarck_swap', String(swapSides)); localStorage.setItem('bismarck_count', String(battleCount)); localStorage.setItem('bismarck_parallel', String(parallel))
  }, [port, germanUrl, germanKey, germanModel, britishUrl, britishKey, britishModel, swapSides, battleCount, parallel])

  // 稳定的 WebSocket 连接 (不随表单变化重连)
  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>

    function doConnect() {
      const ws = new WebSocket(`ws://localhost:${portRef.current}`)
      wsRef.current = ws
      ws.onopen = () => setConnected(true)
      ws.onclose = () => { setConnected(false); reconnectTimer = setTimeout(doConnect, 2000) }
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'state') setState(data)
        } catch { }
      }
    }

    doConnect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current?.close()
    }
  }, [])

  const send = (msg: object) => {
    wsRef.current?.send(JSON.stringify(msg))
    saveConfig()
  }

  // 预设 API 配置
  const presetProviders: { name: string; url: string; model: string; keyHint: string }[] = [
    { name: 'DeepSeek V4', url: 'https://api.deepseek.com/v1', model: 'deepseek-v4-pro', keyHint: 'sk-' },
    { name: 'DeepSeek Flash', url: 'https://api.deepseek.com/v1', model: 'deepseek-flash', keyHint: 'sk-' },
    { name: 'MiniMax', url: 'https://api.minimaxi.com/v1', model: 'abab6.5s-chat', keyHint: 'sk-' },
    { name: 'OpenAI', url: 'https://api.openai.com/v1', model: 'gpt-4o', keyHint: 'sk-' },
    { name: '本地 vLLM', url: 'http://localhost:8000/v1', model: 'qwen3', keyHint: 'sk-local' },
  ]

  const applyPreset = (side: 'german' | 'british', preset: typeof presetProviders[0]) => {
    if (side === 'german') {
      setGermanUrl(preset.url); setGermanModel(preset.model)
    } else {
      setBritishUrl(preset.url); setBritishModel(preset.model)
    }
  }

  const handleConfig = () => send({
    type: 'config',
    config: { german: { baseUrl: germanUrl, apiKey: germanKey, model: germanModel }, british: { baseUrl: britishUrl, apiKey: britishKey, model: britishModel }, swapSides, parallel }
  })

  const handleStart = () => { handleConfig(); send({ type: 'start', total: battleCount }) }
  const handleResume = () => { handleConfig(); send({ type: 'resume' }) }
  const handleStop = () => send({ type: 'stop' })
  const handleReset = () => send({ type: 'reset' })

  const stats = state?.stats
  const pct = state ? Math.round((state.completed / state.total) * 100) : 0

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">深度学习训练仪表盘</h1>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="text-sm text-slate-400">{connected ? `已连接 :${port}` : '等待连接...'}</span>
          <input value={port} onChange={e => setPort(e.target.value)} className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-0.5 text-sm text-center" />
          <button onClick={() => { wsRef.current?.close() }} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs rounded">重连</button>
          <button onClick={onClose} className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs rounded">返回游戏</button>
        </div>
      </div>

      {/* 未连接提示 */}
      {!connected && (
        <div className="bg-amber-900/50 border border-amber-500 rounded-lg p-4 mb-4">
          <h3 className="text-amber-400 font-bold mb-2">未连接到对战服务器</h3>
          <p className="text-sm text-amber-200 mb-2">请在新终端窗口运行:</p>
          <code className="block bg-black/50 text-green-400 px-4 py-2 rounded text-sm font-mono">
            cd bismarck && npm run server
          </code>
          <p className="text-xs text-amber-300 mt-2">启动后仪表盘将自动连接</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 左: API配置 */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h2 className="text-lg font-bold mb-3">API 配置</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-red-400 font-bold mb-2 text-sm">德军 AI</h3>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {presetProviders.map(p => (
                    <button key={p.name} onClick={() => applyPreset('german', p)}
                      className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs">{p.name}</button>
                  ))}
                </div>
                <input value={germanUrl} onChange={e => setGermanUrl(e.target.value)} placeholder="API URL" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm mb-2" />
                <input value={germanKey} onChange={e => setGermanKey(e.target.value)} placeholder="API Key" type="password" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm mb-2" />
                <input value={germanModel} onChange={e => setGermanModel(e.target.value)} placeholder="模型名" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm" />
              </div>
              <div>
                <h3 className="text-blue-400 font-bold mb-2 text-sm">英军 AI</h3>
                <div className="flex gap-1 mb-2 flex-wrap">
                  {presetProviders.map(p => (
                    <button key={p.name} onClick={() => applyPreset('british', p)}
                      className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded text-xs">{p.name}</button>
                  ))}
                </div>
                <input value={britishUrl} onChange={e => setBritishUrl(e.target.value)} placeholder="API URL" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm mb-2" />
                <input value={britishKey} onChange={e => setBritishKey(e.target.value)} placeholder="API Key" type="password" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm mb-2" />
                <input value={britishModel} onChange={e => setBritishModel(e.target.value)} placeholder="模型名" className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm" />
              </div>
            </div>
            <div className="flex gap-6 mt-3 text-sm">
              <label className="flex items-center gap-2 text-slate-300">
                <input type="checkbox" checked={swapSides} onChange={e => setSwapSides(e.target.checked)} /> 交替扮演
              </label>
              <label className="flex items-center gap-2 text-slate-300">
                并发: <input type="number" value={parallel} onChange={e => setParallel(parseInt(e.target.value) || 4)} min={1} max={16} className="w-14 bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-center" />
              </label>
              <button onClick={handleConfig} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-xs rounded">应用配置</button>
            </div>
          </div>

          {/* 对战控制 */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h2 className="text-lg font-bold mb-3">对战控制</h2>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm">总局数:</span>
              <input type="number" value={battleCount} onChange={e => setBattleCount(parseInt(e.target.value) || 100)} min={1} max={10000} className="w-20 bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-center" />
              <button onClick={handleStart} disabled={state?.running} className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-slate-600 text-white rounded font-bold text-sm">开始训练</button>
              <button onClick={handleResume} disabled={state?.running || (state?.completed ?? 0) >= (state?.total ?? 0)} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-white rounded font-bold text-sm">继续</button>
              <button onClick={handleStop} disabled={!state?.running} className="px-4 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-slate-600 text-white rounded font-bold text-sm">停止</button>
              <button onClick={handleReset} className="px-4 py-1.5 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">重置</button>
              <span className="text-sm text-slate-400">并发: {state?.activeBattles ?? 0}</span>
            </div>

            {/* 进度条 */}
            <div className="mt-4">
              <div className="flex justify-between text-xs text-slate-400 mb-1">
                <span>{state?.completed ?? 0} / {state?.total ?? 100}</span>
                <span>{pct}%</span>
              </div>
              <div className="w-full bg-slate-700 rounded-full h-4 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>

          {/* 胜率统计 */}
          {stats && stats.total > 0 && (
            <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
              <h2 className="text-lg font-bold mb-3">统计 (已结算 {stats.total} 局)</h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-slate-900 rounded p-3 text-center">
                  <div className="text-xs text-slate-400">德军胜率</div>
                  <div className="text-2xl font-bold text-red-400">{stats.total > 0 ? Math.round(stats.germanWins / stats.total * 100) : 0}%</div>
                  <div className="text-xs text-slate-500">{stats.germanWins} 胜</div>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <div className="text-xs text-slate-400">英军胜率</div>
                  <div className="text-2xl font-bold text-blue-400">{stats.total > 0 ? Math.round(stats.britishWins / stats.total * 100) : 0}%</div>
                  <div className="text-xs text-slate-500">{stats.britishWins} 胜</div>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <div className="text-xs text-slate-400">德军均VP</div>
                  <div className="text-2xl font-bold text-red-300">{stats.avgGermanVp.toFixed(1)}</div>
                  <div className="text-xs text-slate-500">英均VP {stats.avgBritishVp.toFixed(1)}</div>
                </div>
                <div className="bg-slate-900 rounded p-3 text-center">
                  <div className="text-xs text-slate-400">平均回合</div>
                  <div className="text-2xl font-bold text-white">{stats.avgTurns.toFixed(1)}</div>
                  <div className="text-xs text-slate-500">/ 18</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 右: 实时监控 + 历史 */}
        <div className="space-y-4">
          {/* 实时对战 */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h2 className="text-lg font-bold mb-3">实时监控</h2>
            <div className="max-h-64 overflow-y-auto text-xs space-y-1">
              {(state?.current?.length ?? 0) === 0 && (
                <div className="text-slate-500 italic text-center py-4">无活跃对战</div>
              )}
              {state?.current?.map((b, i) => (
                <div key={i} className="bg-slate-900 rounded p-2">
                  <div className="flex justify-between">
                    <span className="text-white font-bold">{b.gameId.slice(-6)}</span>
                    <span className="text-slate-400">T{b.turn}</span>
                  </div>
                  <div className="text-slate-400">{b.phase}</div>
                  <div className="flex gap-3 text-xs">
                    <span className="text-red-400">德VP {b.germanVp}</span>
                    <span className="text-blue-400">英VP {b.britishVp}</span>
                    <span className="text-slate-500">步{b.stepCount}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 最近结果 */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h2 className="text-lg font-bold mb-3">最近战局</h2>
            <div className="max-h-80 overflow-y-auto text-xs space-y-1">
              {(state?.results?.length ?? 0) === 0 && (
                <div className="text-slate-500 italic text-center py-4">暂无记录</div>
              )}
              {state?.results?.slice().reverse().slice(0, 30).map((r, i) => (
                <div key={i} className={`rounded p-1.5 ${r.winner === 'german' ? 'bg-red-900/30 border-l-2 border-red-500' : r.winner === 'british' ? 'bg-blue-900/30 border-l-2 border-blue-500' : 'bg-slate-900'}`}>
                  <div className="flex justify-between">
                    <span className="text-white font-bold">{r.gameId.slice(-6)}</span>
                    <span className={r.winner === 'german' ? 'text-red-400' : r.winner === 'british' ? 'text-blue-400' : 'text-slate-500'}>
                      {r.winner === 'german' ? '德胜' : r.winner === 'british' ? '英胜' : '异常'}
                    </span>
                  </div>
                  <div className="text-slate-400">T{r.turns} | 德VP{r.germanVp}/英{r.britishVp}</div>
                  <div className="text-slate-500 text-xs">{r.reason.slice(0, 60)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
