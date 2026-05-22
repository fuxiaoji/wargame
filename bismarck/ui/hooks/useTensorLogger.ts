/** 张量日志 Hook —— 在浏览器中记录，终局时导出下载 */

import { useRef, useCallback } from 'react'
import { fillStateSlice, ActionRecord, GameLogResult } from '../../engine/tensor'
import type { GameState } from '../../engine/types'

const T = 73, SLICE = 128 * 8 * 6
const PHASE_MAP: Record<string, number> = {
  'setup-german': 0, 'setup-british': 1, 'german-move': 2, 'british-move': 3,
  'british-search': 4, 'combat': 5, 'transport-attack': 6, 'game-over': 7,
}
const COL = ['A','B','C','D','E','F']
const MAGIC = 0x42534D42

function encodeActionRecord(rec: ActionRecord): ArrayBuffer {
  const buf = new ArrayBuffer(8)
  const dv = new DataView(buf)
  dv.setUint8(0, rec.step_index)
  dv.setUint8(1, rec.phase)
  dv.setUint8(2, rec.side)
  dv.setUint8(3, rec.action_type)
  dv.setInt8(4, rec.ship_id ?? 0)
  dv.setInt8(5, rec.target_q ?? -1)
  dv.setInt8(6, rec.target_r ?? -1)
  dv.setInt8(7, 0)
  return buf
}

function buildStateBin(stateBuf: Float32Array): ArrayBuffer {
  const hdr = new ArrayBuffer(20)
  const dv = new DataView(hdr)
  dv.setUint32(0, MAGIC, true)  // LE
  dv.setInt32(4, T, true)
  dv.setInt32(8, 128, true)
  dv.setInt32(12, 8, true)
  dv.setInt32(16, 6, true)
  const data = new Uint8Array(stateBuf.buffer)
  const out = new Uint8Array(20 + data.length)
  out.set(new Uint8Array(hdr), 0)
  out.set(data, 20)
  return out.buffer
}

function buildActionBin(actions: ActionRecord[]): ArrayBuffer {
  const parts = actions.map(encodeActionRecord)
  const total = parts.reduce((s, p) => s + p.byteLength, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(new Uint8Array(p), off)
    off += p.byteLength
  }
  return out.buffer
}

function downloadBlob(data: ArrayBuffer, filename: string) {
  const blob = new Blob([data], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function useTensorLogger() {
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
  const exportLogs = useCallback((state: GameState) => {
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

    // 下载 state.bin
    downloadBlob(buildStateBin(stateBufRef.current), `${gameId}_state.bin`)
    // 下载 action.bin
    downloadBlob(buildActionBin(actionsRef.current), `${gameId}_action.bin`)
    // 下载 result.json
    const json = JSON.stringify({ game_id: gameId, ...result }, null, 2)
    downloadBlob(new TextEncoder().encode(json).buffer, `${gameId}_result.json`)
  }, [])

  return { recordStep, startLogging, exportLogs, stepCount: stepIdxRef.current }
}
