import { useCallback, useState, useRef, useMemo, useEffect } from 'react'
import { useGame } from '../ui/hooks/useGame'
import { HexMap } from '../ui/components/HexMap'
import { ScoreBoard } from '../ui/components/ScoreBoard'
import { SetupScreen } from '../ui/components/SetupScreen'
import { GermanMovePanel } from '../ui/components/GermanMovePanel'
import { BritishMovePanel } from '../ui/components/BritishMovePanel'
import { SearchPanel } from '../ui/components/SearchPanel'
import { CombatDialog } from '../ui/components/CombatDialog'
import { TransportDialog } from '../ui/components/TransportDialog'
import { VictoryScreen } from '../ui/components/VictoryScreen'
import { MapCalibration } from '../ui/components/MapCalibration'
import { GameLogPanel } from '../ui/components/GameLogPanel'
import { Dashboard } from '../ui/components/Dashboard'
import { GameLog } from '../engine/log'
import { BismarckEnv, GameAction } from '../engine/env'
import type { CombatResult } from '../engine/combat'
import { GERMAN_START_HEXES } from '../engine/map'
import { useTensorLogger } from '../ui/hooks/useTensorLogger'

function loadCalibration() {
  const s = localStorage.getItem('bismarck_map_scale')
  const x = localStorage.getItem('bismarck_map_offx')
  const y = localStorage.getItem('bismarck_map_offy')
  if (s === null || x === null || y === null) return { scale: 0.92, offX: -52, offY: -41 }
  return { scale: parseFloat(s), offX: parseFloat(x), offY: parseFloat(y) }
}

type AISide = null | 'german' | 'british' | 'sm-german' | 'sm-british'

const MAP_DESC = `地图(字母A-F从上到下,数字1-8从左到右,奇数列B/D/F左偏):
A列: A3 A4 A5 A6
B列: B2 B3 B4 B5 B6 B7
C列: C1 C2 C3 C4 C5 C6 C7
D列: D1 D2 D3 D4 D5 D6 D7 D8
E列: E1 E2 E3 E4 E5 E6 E7
F列: F1 F2 F3 F4 F5 F6 F7
布雷斯特=F7(港口) | 斯卡帕湾=D8(港口)
德军起始可选: A5 A6 B7
运输航路: D2 D3 C4 C5(大西洋) E4 E5(非洲)
陆地块(不可进入): E6 D7 (英国本土)`

const RULES_SHORT = `你是俾斯麦号战役指挥官。
${MAP_DESC}

德军: 俾斯麦[攻4/防6/4Step/速2(损→1)], 欧根亲王[攻2/防5/2Step/速2]。隐藏移动。6VP或占F7且VP领先=胜。
英军: 击沉俾斯麦=胜。发现前仅胡德/威尔士亲王/伪装可移动。皇家方舟可航空索敌。全海域无陆地阻挡。
固定: C6(乔治五世/反击/胜利), D6(罗德尼), F4(声望/皇家方舟), F1(拉米伊)。

战术: 德军B7→D8→E7→F6→F7(4回合冲港)。英军初设靠近A5/A6/B7封锁，伪装放航线不放角落，必须守F7，航空索敌每次换格不重复搜。仅回复数字，如"3"。`

export default function App() {
  const logRef = useRef(new GameLog())
  const log = logRef.current

  const {
    game,
    gameState,
    selectedHex, setSelectedHex,
    selectedShip, setSelectedShip,
    highlightedHexes, setHighlightedHexes,
    message, error,
    setupGermanStart,
    placeBritishToken,
    finishSetup,
    germanMove,
    finishGermanMove,
    britishMove,
    finishBritishMove,
    doSearch,
    doAirSearch,
    finishSearch,
    doCombat,
    doTransportAttack,
    skipTransportAttack,
    undoLastMove,
    getReachableHexes,
    getAirSearchTargetsForArkRoyal,
    getTransportAttackersForUI,
    refresh,
  } = useGame(log)

  const tensorLog = useTensorLogger('human-vs-ai')
  const prevStateRef = useRef<string>('')

  // 新游戏开始时重置日志
  useEffect(() => { if (gameState) tensorLog.startLogging(gameState) }, [])
  // 每次状态变化时记录一步 (gameState 是可变对象，引用不变，用具体字段做依赖)
  useEffect(() => {
    if (!gameState || gameState.gameOver || isAITurn) return
    const key = `${gameState.turn}|${gameState.phase}|${gameState.phaseStep}`
    if (key === prevStateRef.current) return
    prevStateRef.current = key
    const player = (gameState.phase === 'setup-german' || gameState.phase === 'german-move' || gameState.phase === 'transport-attack') ? 'german' : 'british'
    tensorLog.recordStep(gameState, player, 0)
  }, [gameState?.turn, gameState?.phase, gameState?.phaseStep])

  const buildHumanLog = useCallback(() => {
    const entries = log.entries
    const lines: string[] = []
    for (const e of entries) {
      const t = `T${e.turn}`.padEnd(4)
      const p = (e.phase || '').padEnd(16)
      lines.push(`[${t} ${p}] ${e.message}`)
    }
    return lines.join('\n')
  }, [log])

  const handleExportTensor = useCallback(() => {
    if (gameState) tensorLog.exportLogs(gameState, buildHumanLog())
  }, [gameState, tensorLog, buildHumanLog])

  // 游戏结束时自动上传训练数据
  useEffect(() => {
    if (gameState?.gameOver) tensorLog.exportLogs(gameState, buildHumanLog())
  }, [gameState?.gameOver, gameState?.turn])

  const [combatResult, setCombatResult] = useState<CombatResult | null>(null)
  const [showTransport, setShowTransport] = useState(false)
  const [phaseMessage, setPhaseMessage] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)

  // 自动弹出运输攻击对话框
  useEffect(() => {
    if (gameState?.phase === 'transport-attack' && gameState.transportPending && !isAITurn) {
      setShowTransport(true)
    }
  }, [gameState?.phase, gameState?.transportPending])

  // AI 模式
  const [aiSide, setAiSide] = useState<AISide>(null)
  const [smVersion, setSmVersion] = useState(() => localStorage.getItem('bismarck_sm_ver') || 'training_v1')
  const [smGen, setSmGen] = useState(() => parseInt(localStorage.getItem('bismarck_sm_gen') || '19'))
  const [smGerIdx, setSmGerIdx] = useState(() => parseInt(localStorage.getItem('bismarck_sm_ger') || '0'))
  const [smBritIdx, setSmBritIdx] = useState(() => parseInt(localStorage.getItem('bismarck_sm_brit') || '0'))
  const [showAIThinking, setShowAIThinking] = useState(true)
  const [aiThinking, setAIThinking] = useState('')
  const [showAIConfig, setShowAIConfig] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [debugLines, setDebugLines] = useState<{ time: string; text: string; color: string }[]>([])
  const [aiReasoning, setAIReasoning] = useState('')  // AI思考过程展示
  const [aiLevel, setAiLevel] = useState<'low'|'high'>(() => (localStorage.getItem('bismarck_ai_level') as 'low'|'high') || 'low')
  const [reasoningEffort, setReasoningEffort] = useState(() => localStorage.getItem('bismarck_reasoning_effort') || 'low')
  const [tokenScale, setTokenScale] = useState(() => parseFloat(localStorage.getItem('bismarck_token_scale') || '1'))
  const [mapZoom, setMapZoom] = useState(() => parseFloat(localStorage.getItem('bismarck_map_zoom') || '1'))
  const [displayMode, setDisplayMode] = useState<'token' | 'sprite'>(() => (localStorage.getItem('bismarck_display_mode') as 'token' | 'sprite') || 'sprite')
  const aiRunningRef = useRef(false)
  const mapBase64Ref = useRef<string>('')
  const mapSentRef = useRef(false)

  // 加载地图图片为 base64 (一次性)
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width; canvas.height = img.height
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      mapBase64Ref.current = canvas.toDataURL('image/jpeg', 0.7)
    }
    img.src = '/map.jpg'
  }, [])

  const addDebug = useCallback((text: string, color = '#94a3b8') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false })
    setDebugLines(prev => [...prev.slice(-200), { time, text, color }])
  }, [])

  // AI API 配置 (localStorage)
  const [aiUrl, setAiUrl] = useState(() => localStorage.getItem('bismarck_ger_url') || 'https://api.deepseek.com/v1')
  const [aiKey, setAiKey] = useState(() => localStorage.getItem('bismarck_ger_key') || '')
  const [aiModel, setAiModel] = useState(() => localStorage.getItem('bismarck_ger_model') || 'deepseek-chat')
  // deepseek-chat = v4-flash (非推理), deepseek-v4-pro = 推理模型(content为空)

  const saveAIConfig = () => {
    localStorage.setItem('bismarck_ger_url', aiUrl)
    localStorage.setItem('bismarck_ger_key', aiKey)
    localStorage.setItem('bismarck_ger_model', aiModel)
    localStorage.setItem('bismarck_br_url', aiUrl)
    localStorage.setItem('bismarck_br_key', aiKey)
    localStorage.setItem('bismarck_br_model', aiModel)
    setShowAIConfig(false)
  }

  // 地图校准
  const savedCalibration = useMemo(() => loadCalibration(), [])
  const [calibration, setCalibration] = useState(savedCalibration)
  const [showCalibration, setShowCalibration] = useState(false)

  const handleCalibrationConfirm = useCallback((scale: number, offX: number, offY: number) => {
    setCalibration({ scale, offX, offY })
    setShowCalibration(false)
  }, [])

  const isGermanPhase = gameState.phase === 'german-move'
    || gameState.phase === 'setup-german'
    || gameState.phase === 'transport-attack'

  const currentPlayer: 'german' | 'british' = isGermanPhase ? 'german' : 'british'
  const isAITurn = aiSide !== null && (
    currentPlayer === (aiSide === 'sm-german' ? 'german' : aiSide === 'sm-british' ? 'british' : aiSide)
  )

  // ===== AI 自动回合 =====
  useEffect(() => {
    if (!isAITurn || gameState.gameOver || aiRunningRef.current) return

    const runAI = async () => {
      aiRunningRef.current = true
      addDebug('═══ AI回合启动 ═══', '#fbbf24')

      // === 状态机快速路径 (不调LLM) ===
      const isSM = aiSide === 'sm-german' || aiSide === 'sm-british'
      if (isSM) {
        const smEnv = new BismarckEnv(); (smEnv as any).game = game
        // 动态加载个体
        const { listIndividuals, createStateMachineAI } = await import('../cli/ai-loader')
        const info = listIndividuals(smVersion, smGen)
        const gerW = info.german[smGerIdx]?.weights
        const ai = createStateMachineAI(gerW)
        addDebug(`状态机: ${smVersion} Gen${smGen} 德#${smGerIdx}(${info.german[smGerIdx]?.style||'?'}) 英#${smBritIdx}(${info.british[smBritIdx]?.style||'?'})`, '#a78bfa')

        let smSteps = 0, smStuck = 0, smLast = ''
        while (!gameState.gameOver && smSteps < 300) {
          const obs = smEnv.getObservation(); (obs as any).raw = game.state
          if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

          if (obs.phase === smLast) smStuck++; else { smStuck = 0; smLast = obs.phase }
          if (smStuck > 15) {
            const f = obs.actions.find(a => a.type === 'finish-phase')
            if (f) { smEnv.step(f); smStuck = 0; continue }
          }

          if (obs.phase === 'setup-british') {
            // 调用状态机BritishBrain决定真船位置 → 靠近德军出生点
            const setupRes = ai.selectBritish(obs)
            const raw = setupRes.rawResponse
            // 解析坐标格式: (胡德号,B6)(威尔士亲王号,C5)
            const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
            const s = game.state
            while ((m = re.exec(raw)) !== null) {
              const sh = s.britishShips.find(x => !x.def.isDummy && !s.britishPositions.has(x.def.id) &&
                (x.def.name === m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
              if (sh) game.placeBritishToken(sh.def.id, m[2])
            }
            // 伪装随机放
            const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
            for (const sh of s.britishShips)
              if (!s.britishPositions.has(sh.def.id)) game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
            const r = game.finishSetup()
            addDebug(`SM初设: ${r.ok ? '✅完成' : '❌'+r.error} | ${raw.slice(0,60)}`, r.ok ? '#4ade80' : '#ef4444')
            refresh(); smSteps++; continue
          }

          const result = obs.activePlayer === 'german' ? ai.selectGerman(obs) : ai.selectBritish(obs)
          if (result.actionId != null) {
            const a = obs.actions.find(x => x.id === result.actionId)
            if (a) smEnv.step(a); else if (obs.actions.length > 0) smEnv.step(obs.actions[0])
          } else if (obs.actions.length > 0) smEnv.step(obs.actions[0])
          smSteps++; refresh()
        }
        aiRunningRef.current = false
        addDebug('状态机回合结束', '#a78bfa')
        return
      }

      // === LLM路径 ===
      const env = new BismarckEnv()
      ;(env as any).game = game
      const obs = env.getObservation()

      const sysPrompt = RULES_SHORT + (currentPlayer === 'german' ? '\n你是德军。' : '\n你是英军。')
      addDebug(`阶段: ${obs.phase} | 动作: ${obs.actions.length}个`, '#94a3b8')
      // 显示发给AI的提示词(截断)
      const preview = obs.text.split('\n').slice(0, 6).join('\n')
      addDebug(`  提示词预览:\n${preview}`, '#475569')

      let localPhase = obs.phase
      let attempts = 0, sameActionStuck = 0, lastActionType = ''
      const maxAttempts = 300

      while (attempts < maxAttempts && !gameState.gameOver) {
        const currentObs = env.getObservation()

        if (currentObs.phase !== localPhase) {
          addDebug(`阶段变化: ${localPhase} → ${currentObs.phase}`, '#60a5fa')
          localPhase = currentObs.phase
          attempts = 0
        }

        const stillAITurn = (currentPlayer === 'german' && (
          currentObs.phase === 'setup-german' || currentObs.phase === 'german-move' || currentObs.phase === 'transport-attack'
        )) || (currentPlayer === 'british' && (
          currentObs.phase === 'setup-british' || currentObs.phase === 'british-move' || currentObs.phase === 'british-search' || currentObs.phase === 'combat'
        ))

        if (!stillAITurn || gameState.gameOver) {
          addDebug('AI回合结束', '#fbbf24')
          break
        }

        // setup-british: LLM 直接回复坐标，actions 可为空
        if (currentObs.phase === 'setup-british') {
          const s = game.state
          // 自动放伪装
          const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
          for (const sh of s.britishShips)
            if (sh.def.isDummy && !s.britishPositions.has(sh.def.id))
              placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
          // LLM 决定真船
          try {
            const key = aiKey; const model = aiModel
            if (key) {
              const apiPath = aiUrl.includes('deepseek') ? '/api/deepseek' : '/api/minimax'
              const res = await fetch(`${apiPath}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({ model, temperature: 0.3, max_tokens: 200, stream: false,
                  messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: currentObs.text }] }),
              })
              if (res.ok) {
                const data = await res.json()
                const raw = data.choices?.[0]?.message?.content || ''
                addDebug(`  LLM布置回复: "${raw.slice(0,150)}"`, '#a78bfa')
                const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
                while ((m = re.exec(raw)) !== null) {
                  const sh = s.britishShips.find(x => !x.def.isDummy && !s.britishPositions.has(x.def.id) &&
                    (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
                  if (sh) { placeBritishToken(sh.def.id, m[2]); addDebug(`  📍 ${sh.def.name} → ${m[2]}`, '#4ade80') }
                }
              }
            }
          } catch {}
          // LLM没放的真船自动放
          const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
          for (const sh of s.britishShips)
            if (!s.britishPositions.has(sh.def.id))
              placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
          finishSetup()
          addDebug('📋 英军布阵完成', '#4ade80')
          await new Promise(r => setTimeout(r, 200))
          refresh()
          attempts = 0
          continue
        }

        const actionCount = currentObs.actions.length
        if (actionCount === 0) {
          addDebug('⚠ 无可用动作', '#ef4444')
          break
        }

        let chosenAction: GameAction | undefined
        if (attempts > 50) {
          chosenAction = currentObs.actions.find(a => a.type === 'finish-phase')
          if (chosenAction) {
            addDebug(`⚡ 强制推进: ${chosenAction.label}`, '#f97316')
            setAIThinking(`(强制推进) ${chosenAction.label}`)
          }
        }

        if (!chosenAction) {
          try {
            const key = aiKey; const model = aiModel
            if (!key) throw new Error('未配置API Key')

            // 通过 Vite 代理避免 CORS
            const apiPath = aiUrl.includes('deepseek') ? '/api/deepseek' : '/api/minimax'

            const t0 = Date.now()
            addDebug(`→ 调用 ${model}...`, '#a78bfa')
            const messages: any[] = [{ role: 'system', content: sysPrompt }]
            // 仅非 DeepSeek 的模型发送地图图片 (DeepSeek 不支持 image_url)
            const canSendImage = !aiUrl.includes('deepseek') && !mapSentRef.current && mapBase64Ref.current
            if (canSendImage) {
              mapSentRef.current = true
              addDebug('  📷 附带地图图片', '#60a5fa')
              messages.push({
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: mapBase64Ref.current } },
                  { type: 'text', text: '这是游戏地图。' + currentObs.text },
                ],
              })
            } else {
              messages.push({ role: 'user', content: currentObs.text })
            }

            const isHigh = aiLevel === 'high'
            const res = await fetch(`${apiPath}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
              body: JSON.stringify({
                model, temperature: isHigh ? 0.3 : 0.1,
                max_tokens: isHigh ? 500 : 10,
                stream: isHigh,
                ...(isHigh ? { reasoning_effort: reasoningEffort } : {}),
                messages: [...messages, ...(isHigh ? [] : [{ role: 'user' as const, content: '\n\n---\n只回复一个数字。不要任何其他文字。' }])],
              }),
            })

            if (!res.ok) {
              const errText = await res.text()
              throw new Error(`API ${res.status}: ${errText.slice(0, 100)}`)
            }

            let rawAnswer = ''

            if (isHigh) {
              // 高级模式: 流式解析 + 推理过程展示
              const reader = res.body!.getReader()
              const decoder = new TextDecoder()
              let reasoningBuf = '', buffer = '', lastFlush = Date.now()
              const flush = () => {
                if (reasoningBuf) { addDebug(`  💭 ${reasoningBuf}`, '#7c3aed'); reasoningBuf = '' }
              }
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n'); buffer = lines.pop() || ''
                for (const line of lines) {
                  if (!line.startsWith('data: ')) continue
                  if (line.slice(6) === '[DONE]') continue
                  try {
                    const delta = JSON.parse(line.slice(6)).choices?.[0]?.delta
                    if (delta?.reasoning_content) {
                      reasoningBuf += delta.reasoning_content
                      setAIReasoning(prev => prev + delta.reasoning_content)
                      if (Date.now() - lastFlush > 500 || reasoningBuf.length > 30) { flush(); lastFlush = Date.now() }
                    }
                    if (delta?.content) { flush(); rawAnswer += delta.content }
                  } catch {}
                }
              }
              flush()
            } else {
              // 低级模式: 非流式，只出数字
              const data = await res.json()
              rawAnswer = data.choices?.[0]?.message?.content || ''
            }

            // 汇总答案
            if (rawAnswer) {
              addDebug(`  📝 答案: "${rawAnswer.slice(0, 120)}"`, '#2dd4bf')
            }

            const latency = Date.now() - t0

            // setup-british: LLM回复坐标格式，解析放置
            if (currentObs.phase === 'setup-british' && rawAnswer) {
              const placementRegex = /\(([^,)]+),\s*([A-F]\d)\)/g
              let match, placed = 0
              while ((match = placementRegex.exec(rawAnswer)) !== null) {
                const shipName = match[1].trim()
                const hexLabel = match[2]
                const ship = gameState.britishShips.find(s =>
                  !gameState.britishPositions.has(s.def.id) &&
                  (s.def.name === shipName || s.def.name.includes(shipName) || shipName.includes(s.def.name.slice(0, 2)))
                )
                if (ship) { placeBritishToken(ship.def.id, hexLabel); addDebug(`  📍 ${ship.def.name} → ${hexLabel}`, '#4ade80'); placed++ }
              }
              // LLM没提到的船自动放
              const hexes = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
              for (const sh of gameState.britishShips)
                if (!gameState.britishPositions.has(sh.def.id))
                  placeBritishToken(sh.def.id, hexes[Math.floor(Math.random()*hexes.length)])
              finishSetup()
              addDebug(`📋 布阵完成(${placed}个LLM指定)`, '#4ade80')
              await new Promise(r => setTimeout(r, 200))
              refresh()
              attempts++
              continue  // 跳过下面的数字解析
            }

            const m = rawAnswer.match(/\[?(\d+)\]?/)
            const actionId = m ? parseInt(m[1]) : null

            if (actionId !== null) {
              chosenAction = currentObs.actions.find(a => a.id === actionId)
              addDebug(`← #${actionId} ${chosenAction?.label?.slice(0, 40) ?? '?'} (${latency}ms)`, '#4ade80')

              // 同类型动作连续选 5 次 → 强制推进（防航空索敌/移动死循环）
              if (chosenAction) {
                if (chosenAction.type === lastActionType) sameActionStuck++
                else { sameActionStuck = 0; lastActionType = chosenAction.type }
                if (sameActionStuck >= 5) {
                  const finish = currentObs.actions.find(a => a.type === 'finish-phase')
                  if (finish) {
                    addDebug(`⚡ 同动作${sameActionStuck}次，强制: ${finish.label}`, '#f97316')
                    chosenAction = finish; sameActionStuck = 0
                  }
                }
              }
            } else {
              addDebug(`← 无法解析动作编号: "${rawAnswer.slice(0, 80)}" (${latency}ms)`, '#ef4444')
            }

            setAIThinking(`[${currentPlayer === 'german' ? '德' : '英'}AI] #${actionId} ${chosenAction?.label?.slice(0, 50) ?? '?'}`)
          } catch (e: any) {
            addDebug(`✗ ${e.message?.slice(0, 100)}`, '#ef4444')
            setAIThinking(`AI错误: ${e.message?.slice(0, 60)}`)
            await new Promise(r => setTimeout(r, 3000))
            attempts++
            continue
          }
        }

        if (chosenAction) {
          addDebug(`▶ ${chosenAction.label.slice(0, 60)}`, '#4ade80')
          switch (chosenAction.type) {
            case 'move':
              if (chosenAction.params?.shipId && chosenAction.params?.targetLabel) {
                if (currentObs.phase === 'setup-german') setupGermanStart(chosenAction.params.targetLabel)
                else if (currentObs.phase === 'setup-british') placeBritishToken(chosenAction.params.shipId, chosenAction.params.targetLabel)
                else if (currentObs.phase === 'german-move') germanMove(chosenAction.params.shipId, chosenAction.params.targetLabel)
                else if (currentObs.phase === 'british-move') britishMove(chosenAction.params.shipId, chosenAction.params.targetLabel)
              } else if (currentObs.phase === 'setup-german' && chosenAction.params?.targetLabel) {
                setupGermanStart(chosenAction.params.targetLabel)
              }
              break
            case 'finish-phase':
              if (currentObs.phase === 'german-move') finishGermanMove()
              else if (currentObs.phase === 'british-move') finishBritishMove()
              else if (currentObs.phase === 'british-search') {
                if (!gameState.combatPending) doSearch()
                finishSearch()
              } else if (currentObs.phase === 'setup-british') finishSetup()
              else if (currentObs.phase === 'transport-attack') skipTransportAttack()
              break
            case 'air-search':
              if (chosenAction.params?.targetLabel) doAirSearch(chosenAction.params.targetLabel)
              break
            case 'combat':
              setCombatResult(doCombat())
              break
            case 'transport':
              if (chosenAction.params?.shipId) doTransportAttack(chosenAction.params.shipId)
              break
          }

          await new Promise(r => setTimeout(r, 400)) // 给UI刷新时间
        }

        attempts++
      }

      aiRunningRef.current = false
      setAIThinking('')
      setAIReasoning('')
      addDebug('═══ AI回合完成 ═══', '#fbbf24')
      refresh()
    }

    runAI().catch(e => {
      aiRunningRef.current = false
      addDebug(`💥 异常: ${String(e).slice(0, 100)}`, '#ef4444')
    })
  }, [isAITurn, gameState.phase, gameState.gameOver])

  // ========== 六角格点击 ==========
  const handleHexClick = useCallback((label: string) => {
    if (isAITurn) return  // AI回合禁用点击
    setSelectedHex(label)
    if (gameState.phase === 'setup-british' && selectedShip) return
    if (gameState.phase === 'setup-german' && GERMAN_START_HEXES.includes(label)) {
      setupGermanStart(label); return
    }
    if (gameState.phase === 'german-move' && selectedShip) {
      germanMove(selectedShip, label); setHighlightedHexes(new Set()); return
    }
    if (gameState.phase === 'british-move' && selectedShip) {
      britishMove(selectedShip, label); setHighlightedHexes(new Set()); return
    }
  }, [gameState.phase, selectedShip, setSelectedHex, setupGermanStart, germanMove, britishMove, setHighlightedHexes, isAITurn])

  // ========== 舰船选择 ==========
  const handleSelectShip = useCallback((shipId: string) => {
    if (isAITurn) return
    setSelectedShip(shipId === selectedShip ? null : shipId)
    if (shipId !== selectedShip) setHighlightedHexes(getReachableHexes(shipId))
    else setHighlightedHexes(new Set())
  }, [selectedShip, setSelectedShip, getReachableHexes, setHighlightedHexes, isAITurn])

  // ========== 各阶段回调 ==========
  const handleSetupGermanStart = useCallback((label: string) => {
    setupGermanStart(label); setHighlightedHexes(new Set())
  }, [setupGermanStart, setHighlightedHexes])

  const handlePlaceBritish = useCallback((shipId: string, label: string) => {
    placeBritishToken(shipId, label); setSelectedShip(null); setSelectedHex(null)
  }, [placeBritishToken, setSelectedShip, setSelectedHex])

  const handleGermanMove = useCallback((shipId: string, target: string) => {
    germanMove(shipId, target); setHighlightedHexes(new Set()); setSelectedShip(null); setSelectedHex(null)
  }, [germanMove, setHighlightedHexes, setSelectedShip, setSelectedHex])

  const handleBritishMove = useCallback((shipId: string, target: string) => {
    britishMove(shipId, target); setHighlightedHexes(new Set()); setSelectedShip(null); setSelectedHex(null)
  }, [britishMove, setHighlightedHexes, setSelectedShip, setSelectedHex])

  const handleFinishGermanMove = useCallback(() => {
    finishGermanMove(); setHighlightedHexes(new Set()); setSelectedShip(null); setSelectedHex(null)
    setPhaseMessage('请英军玩家查看屏幕')
  }, [finishGermanMove, setHighlightedHexes, setSelectedShip, setSelectedHex])

  const handleDoSearch = useCallback(() => {
    const result = doSearch()
    if (result.type === 'co-locate') setPhaseMessage(`发现德军在格 ${result.germanLabel}!`)
  }, [doSearch])

  const handleFinishSearch = useCallback(() => {
    doSearch()  // 始终执行同格索敌（处理伪装鉴定），即使航空索敌已发现德军
    finishSearch()
    if (gameState.combatPending) setPhaseMessage('进入战斗阶段!')
    else if (gameState.transportPending) setShowTransport(true)
  }, [doSearch, finishSearch, gameState.combatPending, gameState.transportPending])

  const handleDoCombat = useCallback(() => {
    setCombatResult(doCombat())
  }, [doCombat])

  const handleCombatClose = useCallback(() => {
    setCombatResult(null)
    if (gameState.transportPending) setShowTransport(true)
    refresh()
  }, [gameState.transportPending, refresh])

  const handleTransportAttack = useCallback((shipId: string) => {
    doTransportAttack(shipId); setShowTransport(false)
  }, [doTransportAttack])

  const handleSkipTransport = useCallback(() => {
    skipTransportAttack(); setShowTransport(false)
  }, [skipTransportAttack])

  const handleNewGame = useCallback(() => {
    window.location.reload()
  }, [])

  const needsCombatStart = gameState.phase === 'combat' && !combatResult && !gameState.gameOver && !isAITurn

  // 仪表盘模式
  if (showDashboard) {
    return <Dashboard onClose={() => setShowDashboard(false)} />
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      {showCalibration && <MapCalibration onConfirm={handleCalibrationConfirm} />}

      {/* AI 配置弹窗 */}
      {showAIConfig && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="bg-slate-800 border border-indigo-500 rounded-xl p-6 w-96">
            <h2 className="text-lg font-bold text-white mb-4">🤖 AI API 配置</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">API URL</label>
                <input value={aiUrl} onChange={e => setAiUrl(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400">API Key</label>
                <input value={aiKey} onChange={e => setAiKey(e.target.value)} type="password"
                  placeholder="sk-..."
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-xs text-slate-400">模型名</label>
                <input value={aiModel} onChange={e => setAiModel(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveAIConfig}
                className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold">保存</button>
              <button onClick={() => setShowAIConfig(false)}
                className="flex-1 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 顶部状态栏 */}
      <header className="flex items-center justify-between p-3 bg-slate-950 border-b border-slate-700 flex-wrap gap-2">
        <h1 className="text-xl font-bold text-white">击沉俾斯麦号</h1>
        <ScoreBoard gameState={gameState} />
        <div className="flex items-center gap-2 flex-wrap">
          {/* AI模式选择 */}
          <select
            value={aiSide ?? 'none'}
            onChange={e => setAiSide(e.target.value === 'none' ? null : e.target.value as AISide)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs"
          >
            <option value="none">👥 双人对战</option>
            <option value="german">🤖 AI德军(LLM)</option>
            <option value="british">🤖 AI英军(LLM)</option>
            <option value="sm-german">🧠 状态机德军</option>
            <option value="sm-british">🧠 状态机英军</option>
          </select>
          {/* 状态机个体选择 */}
          {(aiSide === 'sm-german' || aiSide === 'sm-british') && (
            <>
              <select value={smVersion} onChange={e => { setSmVersion(e.target.value); localStorage.setItem('bismarck_sm_ver', e.target.value) }}
                className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs">
                <option value="training_v1">V1(KL)</option>
                <option value="training_v2">V2(MAP)</option>
              </select>
              <span className="text-xs text-slate-500">Gen</span>
              <input value={smGen} onChange={e => { setSmGen(parseInt(e.target.value)||0); localStorage.setItem('bismarck_sm_gen', e.target.value) }}
                className="w-10 bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs text-center" />
              <span className="text-xs text-slate-500">德#</span>
              <input value={smGerIdx} onChange={e => { setSmGerIdx(parseInt(e.target.value)||0); localStorage.setItem('bismarck_sm_ger', e.target.value) }}
                className="w-8 bg-slate-800 border border-red-600 rounded px-1 py-0.5 text-xs text-center" />
              <span className="text-xs text-slate-500">英#</span>
              <input value={smBritIdx} onChange={e => { setSmBritIdx(parseInt(e.target.value)||0); localStorage.setItem('bismarck_sm_brit', e.target.value) }}
                className="w-8 bg-slate-800 border border-blue-600 rounded px-1 py-0.5 text-xs text-center" />
            </>
          )}
          {aiSide && aiSide !== 'sm-german' && aiSide !== 'sm-british' && (
            <>
              <select value={aiLevel} onChange={e => { setAiLevel(e.target.value as 'low'|'high'); localStorage.setItem('bismarck_ai_level', e.target.value) }}
                className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs" title="AI级别: 低级=快, 高级=推理">
                <option value="low">低级AI</option>
                <option value="high">高级AI</option>
              </select>
              <button onClick={() => setShowAIConfig(true)}
                className="px-2 py-1 bg-indigo-700 hover:bg-indigo-600 text-indigo-200 text-xs rounded">⚙ API</button>
              {aiLevel === 'high' && (
                <>
                  <label className="flex items-center gap-1 text-xs text-slate-400">
                    <input type="checkbox" checked={showAIThinking} onChange={e => setShowAIThinking(e.target.checked)} />
                    思考
                  </label>
                  <select value={reasoningEffort} onChange={e => { setReasoningEffort(e.target.value); localStorage.setItem('bismarck_reasoning_effort', e.target.value) }}
                    className="bg-slate-800 border border-slate-600 rounded px-1 py-0.5 text-xs w-14" title="推理强度: low=快, high=深">
                    <option value="low">快</option>
                    <option value="medium">中</option>
                    <option value="high">深</option>
                  </select>
                </>
              )}
              <button onClick={() => setShowDebug(!showDebug)}
                className={`px-2 py-1 text-xs rounded ${showDebug ? 'bg-green-700 text-green-200' : 'bg-slate-700 text-slate-300'}`}>
                🖥 调试
              </button>
            </>
          )}
          <button onClick={() => setShowCalibration(true)}
            className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded border border-slate-500">校准地图</button>
          <button onClick={() => setShowDashboard(true)}
            className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-purple-200 text-xs rounded border border-purple-500">AI 训练</button>
          <span className="text-slate-600">|</span>
          <span className="text-xs text-slate-400">算子</span>
          <input type="range" min="0.5" max="2" step="0.1" value={tokenScale}
            onChange={e => { const v = parseFloat(e.target.value); setTokenScale(v); localStorage.setItem('bismarck_token_scale', String(v)) }}
            className="w-16 h-4" title={`算子大小: ${Math.round(tokenScale * 100)}%`} />
          <span className="text-xs text-slate-400">缩放</span>
          <input type="range" min="0.5" max="2" step="0.1" value={mapZoom}
            onChange={e => { const v = parseFloat(e.target.value); setMapZoom(v); localStorage.setItem('bismarck_map_zoom', String(v)) }}
            className="w-16 h-4" title={`地图缩放: ${Math.round(mapZoom * 100)}%`} />
          <span className="text-slate-600">|</span>
          <button
            onClick={() => { const m = displayMode === 'sprite' ? 'token' : 'sprite'; setDisplayMode(m); localStorage.setItem('bismarck_display_mode', m) }}
            className={`px-2 py-1 text-xs rounded border ${displayMode === 'sprite' ? 'bg-indigo-700 border-indigo-500 text-indigo-200' : 'bg-slate-700 border-slate-500 text-slate-300'}`}
            title="切换算子/小人显示"
          >
            {displayMode === 'sprite' ? 'Q版小人' : '方块算子'}
          </button>
        </div>
      </header>

      {/* AI 思考状态 */}
      {aiThinking && showAIThinking && (
        <div className="px-4 py-1.5 bg-purple-900/50 border-b border-purple-700 text-purple-200 text-xs font-mono">
          🤖 {aiThinking}
        </div>
      )}

      {/* 消息 */}
      {(message || error || phaseMessage) && (
        <div className={`px-4 py-2 text-center text-sm font-bold ${error ? 'bg-red-900 text-red-200' : 'bg-slate-800 text-yellow-300'}`}>
          {error || message || phaseMessage}
        </div>
      )}

      {/* 主区域 */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4">
        <div className="flex-1 flex justify-center">
          <HexMap
            gameState={gameState}
            highlightedHexes={highlightedHexes}
            selectedHex={selectedHex}
            showGermanPositions={
              aiSide === 'british' ||  // 人玩德军 → 始终看己方
              (aiSide === null && isGermanPhase) ||  // 双人按阶段切换
              (aiSide === 'german' && gameState.germanPositionPublic)  // 人玩英军 → 仅伪装鉴定失败时
            }
            transportRevealedHex={gameState.transportRevealedHex}
            onHexClick={handleHexClick}
            mapScale={calibration?.scale}
            mapOffX={calibration?.offX}
            mapOffY={calibration?.offY}
            tokenScale={tokenScale}
            zoom={mapZoom}
            selectedShip={selectedShip}
            displayMode={displayMode}
          />
        </div>

        {/* 控制面板 - AI回合时隐藏 */}
        {!isAITurn && (
          <div className="w-full lg:w-80 space-y-4">
            {(gameState.phase === 'setup-german' || gameState.phase === 'setup-british') && (
              <SetupScreen
                gameState={gameState}
                onGermanStart={handleSetupGermanStart}
                onPlaceBritish={handlePlaceBritish}
                onFinishSetup={finishSetup}
                onRandomPlace={() => {
                  const labels = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
                  for (const ship of gameState.britishShips) {
                    if (!gameState.britishPositions.has(ship.def.id)) {
                      const label = labels[Math.floor(Math.random() * labels.length)]
                      placeBritishToken(ship.def.id, label)
                    }
                  }
                }}
                selectedHex={selectedHex}
              />
            )}
            {gameState.phase === 'german-move' && (
              <>
                <GermanMovePanel
                  gameState={gameState}
                  selectedShip={selectedShip}
                  selectedHex={selectedHex}
                  onSelectShip={handleSelectShip}
                  onMove={handleGermanMove}
                  onFinish={handleFinishGermanMove}
                />
                {selectedShip && (
                  <button onClick={() => {
                    const r = undoLastMove(selectedShip)
                    if (r.ok) { setSelectedShip(null); setHighlightedHexes(new Set()) }
                  }}
                    className="w-full px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded text-sm font-bold">
                    ↩ 撤销 {gameState.germanShips.find(s=>s.def.id===selectedShip)?.def.name} 移动
                  </button>
                )}
              </>
            )}
            {gameState.phase === 'british-move' && (
              <>
                <BritishMovePanel
                  gameState={gameState}
                  selectedShip={selectedShip}
                  selectedHex={selectedHex}
                  onSelectShip={handleSelectShip}
                  onMove={handleBritishMove}
                  onFinish={finishBritishMove}
                />
                {selectedShip && (
                  <button onClick={() => {
                    const r = undoLastMove(selectedShip)
                    if (r.ok) { setSelectedShip(null); setHighlightedHexes(new Set()) }
                  }}
                    className="w-full px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 text-white rounded text-sm font-bold">
                    ↩ 撤销 {gameState.britishShips.find(s=>s.def.id===selectedShip)?.def.name} 移动
                  </button>
                )}
              </>
            )}
            {gameState.phase === 'british-search' && (
              <SearchPanel
                gameState={gameState}
                airSearchTargets={getAirSearchTargetsForArkRoyal()}
                onDoSearch={handleDoSearch}
                onAirSearch={doAirSearch}
                onFinish={handleFinishSearch}
              />
            )}
            {needsCombatStart && (
              <div className="bg-red-900/50 border border-red-500 rounded-lg p-4">
                <h2 className="text-lg font-bold text-red-400 mb-3">战斗!</h2>
                <p className="text-sm text-slate-300 mb-3">双方在同一格，必须结算战斗。</p>
                <button onClick={handleDoCombat}
                  className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-bold transition">结算战斗</button>
              </div>
            )}
          </div>
        )}
        {isAITurn && (
          <div className="w-full lg:w-80 space-y-2">
            <div className="bg-slate-800 border border-purple-700 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">🤖</span>
                <span className="text-purple-300 font-bold text-sm">
                  {aiSide === 'german' ? '德军' : '英军'} AI 思考中
                </span>
                <span className="text-xs text-slate-500">{aiModel}</span>
              </div>
              <div className="text-xs text-purple-400/70 font-mono leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
                {aiReasoning || '等待响应...'}
              </div>
              {aiThinking && (
                <div className="mt-2 pt-2 border-t border-slate-700 text-xs text-green-400 font-mono">
                  动作: {aiThinking}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <CombatDialog result={combatResult} onClose={handleCombatClose} gameState={gameState} displayMode={displayMode} />
      {showTransport && (
        <TransportDialog attackers={getTransportAttackersForUI()} onAttack={handleTransportAttack} onSkip={handleSkipTransport} />
      )}
      {gameState.gameOver && <VictoryScreen gameState={gameState} onNewGame={handleNewGame} onShowLog={() => setShowLog(true)} onExportTensor={handleExportTensor} />}
      <GameLogPanel log={log} visible={showLog} onToggle={() => setShowLog(!showLog)} />

      {/* 调试终端 */}
      {showDebug && (
        <div className="fixed bottom-8 left-2 right-2 z-50 bg-black/90 border border-green-600 rounded-lg shadow-2xl" style={{ maxHeight: '35vh' }}>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-green-800 bg-green-950/50 rounded-t-lg">
            <span className="text-green-400 font-bold text-xs font-mono">🖥 AI 调试终端</span>
            <div className="flex gap-2">
              <button onClick={() => setDebugLines([])} className="text-xs text-green-600 hover:text-green-400">清空</button>
              <button onClick={() => setShowDebug(false)} className="text-xs text-green-600 hover:text-green-400">×</button>
            </div>
          </div>
          <div className="overflow-y-auto p-2 text-xs font-mono leading-relaxed" style={{ maxHeight: 'calc(35vh - 32px)' }}>
            {debugLines.length === 0 && (
              <div className="text-green-800 italic">等待 AI 活动...</div>
            )}
            {debugLines.map((line, i) => (
              <div key={i}>
                <span className="text-slate-600">{line.time}</span>
                {' '}
                <span style={{ color: line.color }}>{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
