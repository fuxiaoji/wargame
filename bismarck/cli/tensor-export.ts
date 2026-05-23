/** 训练张量导出 —— 对战结束后自动输出 state.bin + action.bin + result.json */

import * as fs from 'fs'
import * as path from 'path'
import { fillStateSlice, ActionRecord, GameLogResult } from '../engine/tensor'
import type { GameState } from '../engine/types'

const T = 73, SLICE = 128 * 8 * 6, PHASE_MAP: Record<string, number> = {
  'setup-german':0,'setup-british':1,'german-move':2,'british-move':3,
  'british-search':4,'combat':5,'transport-attack':6,'game-over':7,
}
const COL = ['A','B','C','D','E','F']
const SHIP_IDS: Record<string, number> = {
  'bismarck':1,'prinz-eugen':2,'hood':10,'prince-of-wales':11,'ark-royal':12,
  'king-george-v':13,'rodney':14,'renown':15,'repulse':16,'victorious':17,
  'ramillies':18,'norfolk':19,'suffolk':20,'dummy-1':30,'dummy-2':31,'dummy-3':32,'dummy-4':33,
}

interface TensorStepEntry {
  state: GameState
  side: 'german' | 'british'
  actionType: number
  shipId?: string
  targetLabel?: string
}

export class TensorExporter {
  private entries: TensorStepEntry[] = []

  recordStep(state: GameState, side: 'german' | 'british', actionType: number, shipId?: string, targetLabel?: string) {
    this.entries.push({ state: {...state}, side, actionType, shipId, targetLabel })
  }

  export(dir: string, gameId: string, seed: number) {
    const gameDir = path.join(dir, gameId)
    fs.mkdirSync(gameDir, { recursive: true })

    const stateBuf = new Float32Array(T * SLICE)
    const actions: ActionRecord[] = []

    for (let i = 0; i < this.entries.length && i < T; i++) {
      const e = this.entries[i]
      const slice = fillStateSlice(e.state)
      stateBuf.set(slice, i * SLICE)

      let tq = -1, tr = -1
      if (e.targetLabel && e.targetLabel.length >= 2) {
        tq = e.targetLabel.charCodeAt(0) - 65
        tr = parseInt(e.targetLabel.slice(1)) - 1
      }
      actions.push({
        step_index: i,
        phase: PHASE_MAP[e.state.phase] ?? 7,
        side: e.side === 'german' ? 0 : 1,
        action_type: e.actionType,
        ship_id: SHIP_IDS[e.shipId ?? ''] ?? 0,
        target_q: tq,
        target_r: tr,
      })
    }

    // 补零
    const zero = new Float32Array(SLICE)
    for (let i = this.entries.length; i < T; i++) {
      stateBuf.set(zero, i * SLICE)
      actions.push({ step_index: i, phase: 7, side: 0, action_type: 0, ship_id: 0, target_q: -1, target_r: -1 })
    }

    // state.bin
    const hdr = new ArrayBuffer(20)
    const dv = new DataView(hdr)
    dv.setUint32(0, 0x42534D42, true); dv.setInt32(4, T, true); dv.setInt32(8, 128, true)
    dv.setInt32(12, 8, true); dv.setInt32(16, 6, true)
    const sdata = new Uint8Array(stateBuf.buffer)
    const sout = new Uint8Array(20 + sdata.length)
    sout.set(new Uint8Array(hdr), 0); sout.set(sdata, 20)
    fs.writeFileSync(path.join(gameDir, 'state.bin'), sout)

    // action.bin
    const actBuf = new Uint8Array(actions.length * 8)
    actions.forEach((a, i) => {
      const off = i * 8
      actBuf[off] = a.step_index; actBuf[off+1] = a.phase
      actBuf[off+2] = a.side; actBuf[off+3] = a.action_type
      actBuf[off+4] = a.ship_id & 0xff; actBuf[off+5] = a.target_q & 0xff
      actBuf[off+6] = a.target_r & 0xff
    })
    fs.writeFileSync(path.join(gameDir, 'action.bin'), actBuf)

    // result.json
    const last = this.entries[this.entries.length - 1]?.state
    const result: GameLogResult = {
      winner: last?.winner === 'german' ? 'german' : 'british',
      vp_german: last?.vp.german ?? 0,
      vp_british: last?.vp.british ?? 0,
      turns: last?.turn ?? 0,
      total_steps: this.entries.length,
      seed,
      bismarck_sunk: (last?.germanShips.find(s => s.def.id === 'bismarck')?.steps ?? 1) <= 0,
      brest_reached: (last?.victoryReason ?? '').includes('布雷斯特'),
    }
    fs.writeFileSync(path.join(gameDir, 'result.json'), JSON.stringify({ game_id: gameId, ...result }, null, 2))
  }
}
