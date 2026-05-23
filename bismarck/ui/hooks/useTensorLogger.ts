/** 张量日志 Hook —— 在浏览器中记录，终局时导出下载 */

import { useRef, useCallback } from 'react'
import { fillStateSlice, ActionRecord, GameLogResult } from '../../engine/tensor'
import type { GameState } from '../../engine/types'

const T = 73, SLICE = 128 * 8 * 6
const PHASE_MAP: Record<string, number> = {
  'setup-german': 0, 'setup-british': 1, 'german-move': 2, 'british-move': 3,
  'british-search': 4, 'combat': 5, 'transport-attack': 6, 'game-over': 7,
}

async function uploadGame(gameType: string, gameId: string,
  stateBuf: Float32Array, actions: ActionRecord[], result: GameLogResult,
  humanLog?: string
) {
  const stateBytes = new Uint8Array(stateBuf.buffer)
  const actBuf = new ArrayBuffer(actions.length * 8)
  const actView = new DataView(actBuf)
  actions.forEach((a, i) => {
    const o = i * 8
    actView.setUint8(o, a.step_index); actView.setUint8(o+1, a.phase)
    actView.setUint8(o+2, a.side); actView.setUint8(o+3, a.action_type)
    actView.setInt8(o+4, a.ship_id ?? 0); actView.setInt8(o+5, a.target_q ?? -1)
    actView.setInt8(o+6, a.target_r ?? -1)
  })
  // base64 编码
  const toB64 = (bytes: Uint8Array) => {
    let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }
  try {
    await fetch('http://localhost:3001/api/save-game', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameType, gameId,
        stateBase64: toB64(stateBytes),
        actionBase64: toB64(new Uint8Array(actBuf)),
        result,
        humanLog,
      }),
    })
  } catch { /* server may be offline */ }
}

export function useTensorLogger(gameType = 'human-vs-ai') {
  const stateBufRef = useRef(new Float32Array(T * SLICE))
  const actionsRef = useRef<ActionRecord[]>([])
  const stepIdxRef = useRef(0)
  const activeRef = useRef(false)

  // 在游戏状态变化时调用
  const recordStep = useCallback((state: GameState, side: 'german' | 'british',
    actionType: number, shipId?: string, targetLabel?: string) => {
    if (!activeRef.current) return

    const idx = stepIdxRef.current
    if (idx >= T) return

    // 填状态切片
    const slice = fillStateSlice(state)
    stateBufRef.current.set(slice, idx * SLICE)

    // 填动作记录
    let tq = -1, tr = -1
    if (targetLabel && targetLabel.length >= 2) {
      tq = targetLabel.charCodeAt(0) - 65
      tr = parseInt(targetLabel.slice(1)) - 1
    }
    const SHIP_IDS: Record<string, number> = {
      'bismarck':1,'prinz-eugen':2,'hood':10,'prince-of-wales':11,'ark-royal':12,
      'dummy-1':30,'dummy-2':31,'dummy-3':32,'dummy-4':33,
    }
    actionsRef.current.push({
      step_index: idx,
      phase: PHASE_MAP[state.phase] ?? 7,
      side: side === 'german' ? 0 : 1,
      action_type: actionType,
      ship_id: SHIP_IDS[shipId ?? ''] ?? 0,
      target_q: tq,
      target_r: tr,
    })
    stepIdxRef.current++
  }, [])

  // 开始记录
  const startLogging = useCallback((state: GameState) => {
    stateBufRef.current = new Float32Array(T * SLICE)
    actionsRef.current = []
    stepIdxRef.current = 0
    activeRef.current = true
    // 记录初始状态（step 0 不需要 action）
    const slice = fillStateSlice(state)
    stateBufRef.current.set(slice, 0)
    // step 0 的动作会在第一次 recordStep 时记录
  }, [])

  // 终局导出
  const exportLogs = useCallback((state: GameState, humanLog?: string) => {
    activeRef.current = false
    // 补零
    const zeroSlice = new Float32Array(SLICE)
    while (stepIdxRef.current < T) {
      stateBufRef.current.set(zeroSlice, stepIdxRef.current * SLICE)
      actionsRef.current.push({
        step_index: stepIdxRef.current, phase: 7, side: 0,
        action_type: 0, ship_id: 0, target_q: -1, target_r: -1,
      })
      stepIdxRef.current++
    }

    const gameId = 'game-' + Date.now()
    const result: GameLogResult = {
      winner: state.winner === 'german' ? 'german' : 'british',
      vp_german: state.vp.german, vp_british: state.vp.british,
      turns: state.turn, total_steps: stepIdxRef.current, seed: -1,
      bismarck_sunk: (state.germanShips.find(s => s.def.id === 'bismarck')?.steps ?? 1) <= 0,
      brest_reached: state.victoryReason.includes('布雷斯特'),
    }

    uploadGame(gameType, gameId, stateBufRef.current, actionsRef.current, result, humanLog)
  }, [gameType])

  return { recordStep, startLogging, exportLogs, stepCount: stepIdxRef.current }
}
