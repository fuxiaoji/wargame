#!/usr/bin/env npx tsx
/** 状态机单局完整调试报告 — Markdown 输出 */

import { BismarckEnv } from '../engine/env'
import { createStateMachineAI, Weights } from './state-machine'
import { GERMAN_START_HEXES, hexToLabel, labelToHex } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import * as fs from 'fs'

const OUT = process.argv[2] || 'battle_report_v4.md'
const SEED = parseInt(process.argv[3] || '42')

// ====== V4 gen_009 最强权重 ======
const GER_W: Weights = {
  w1:9.78026,w2:2.59906,w3:1.28353,w4:2.76269,w5:2.89735,w6:2.29156,w7:1.86461,w8:1.8664,
  w9:4,w10:2.65587,w11:2,w12:0.2,w13:2.52644,w14:1.89555,w15:0.613068,
  s1:10.4569,s2:0.2,s3:1.92569,h1:10.2557,h2:6.87904,h3:4.11585,
  p1:1.77245,p2:1.08875,p3:1.34511,d1:5,d2:3,d3:5.40898,temperature:0.356521
}
const BRIT_W: Weights = {
  w1:3.0817,w2:5.44699,w3:2.80756,w4:3.69817,w5:4.10149,w6:3.70462,w7:3.58926,w8:5.27384,
  w9:3.40864,w10:3.74392,w11:0.896589,w12:0.333318,w13:2.80158,w14:1.78424,w15:5.19701,
  s1:9.39802,s2:1.53124,s3:2.82464,h1:11.618,h2:4.34022,h3:0.811128,
  p1:4.23294,p2:0.848749,p3:3.46781,d1:4.8746,d2:0.39794,d3:1.69103,temperature:0.2
}

const COL = ['A','B','C','D','E','F']

function rcOf(label: string): [number, number] | null {
  if (!label || label.length < 2) return null
  const c = label.charCodeAt(0) - 65
  const r = parseInt(label.slice(1)) - 1
  return (c >= 0 && c < 6 && r >= 0 && r < 8) ? [r, c] : null
}

function heatColor(v: number): string {
  if (v <= -5) return `🔴${v.toFixed(1)}`  // 强吸引
  if (v <= -1) return `🟠${v.toFixed(1)}`  // 吸引
  if (v === 0) return ' · '
  if (v <= 2) return `🟢${v.toFixed(1)}`   // 轻微排斥
  if (v <= 5) return `🟡${v.toFixed(1)}`   // 排斥
  return `🔵${v.toFixed(1)}`                 // 强排斥
}

function renderHeatmapMd(data: Float32Array, title: string): string {
  let s = `**${title}**\n\n`
  s += '|   | A | B | C | D | E | F |\n'
  s += '|---|----|----|----|----|----|----|\n'
  for (let r = 0; r < 8; r++) {
    s += `| ${r+1} |`
    for (let c = 0; c < 6; c++) {
      const v = data[r * 6 + c]
      if (v === 0) s += ' · |'
      else s += ` ${v >= 0 ? '+' : ''}${v.toFixed(1)} |`
    }
    s += '\n'
  }
  s += '\n> 🔴强吸引 🟠吸引 ·中性 🟢轻微排斥 🟡排斥 🔵强排斥  |  得分 = -热力值\n\n'
  return s
}

// ========== 英军布置 ==========
function setupBritish(env: BismarckEnv) {
  const s = env.game.state
  const used = new Set(GERMAN_START_HEXES)
  for (const [hex, ids] of Object.entries(BRITISH_FIXED_POSITIONS)) {
    used.add(hex)
    for (const id of ids) env.game.placeBritishToken(id, hex)
  }
  const R = new Set<string>()
  const dummyShip = { def: { speed: 2 }, steps: 2 } as any
  for (const l of GERMAN_START_HEXES) {
    const h = labelToHex(l)
    if (!h) continue
    for (const rl of getGermanReachableLabels(dummyShip, h)) {
      if (!used.has(rl)) R.add(rl)
    }
  }
  const place = (isDummy: boolean) => {
    for (const sh of s.britishShips) {
      if (sh.def.isDummy !== isDummy || s.britishPositions.has(sh.def.id)) continue
      const avail = [...R].filter(h => !used.has(h))
      if (avail.length > 0) {
        const p = avail[Math.floor(Math.random() * avail.length)]
        env.game.placeBritishToken(sh.def.id, p)
        used.add(p)
      }
    }
  }
  place(false); place(true)
  const fb = ['E7','E5','E3','E2','E1','D8','D5','D4','D3','D2','D1','C7','C1','B6','F6','F5','F3','F2','A3','A4','B4']
  for (const sh of s.britishShips) {
    if (!s.britishPositions.has(sh.def.id)) {
      const h = fb.find(x => !used.has(x)) || fb[Math.floor(Math.random() * fb.length)]
      env.game.placeBritishToken(sh.def.id, h)
      used.add(h)
    }
  }
  env.game.finishSetup()
}

// ========== 主程序 ==========
async function main() {
  const gerAi = createStateMachineAI(GER_W)
  const britAi = createStateMachineAI(BRIT_W)
  const env = new BismarckEnv(SEED)
  const lines: string[] = []
  let stepNum = 0, stuck = 0, lastPhase = ''
  const w = (s: string) => { lines.push(s); console.log(s) }

  w(`# 击沉俾斯麦号 — 状态机 AI 单局完整决策报告`)
  w(``)
  w(`**权重**: V4 gen\\_009 德#6 (wr=0.373) vs V4 gen\\_009 英#0 (wr=0.757)`)
  w(`**种子**: ${SEED}`)
  w(`**温度**: 德=${GER_W.temperature.toFixed(2)} 英=${BRIT_W.temperature.toFixed(2)}`)
  w(``)
  w(`---`)
  w(``)

  // ===== 德军初设 =====
  let obs = env.getObservation(); (obs as any).raw = env.game.state
  const gSetup = gerAi.selectGerman(obs, true)
  const setupAction = obs.actions.find(a => a.id === gSetup.actionId)
  if (setupAction) env.step(setupAction)
  w(`## 德军初设`)
  w(``)
  w(`- **动作**: ${setupAction?.label || 'fallback'}`)
  w(`- **逻辑**: B7(距F7最近,3分) > A6(2分) > A5(1分), temperature=0.5 softmax`)
  w(``)

  // ===== 英军布置 =====
  obs = env.getObservation(); (obs as any).raw = env.game.state
  const sBefore = env.game.state
  w(`## 英军初设`)
  w(``)
  w(`- 真船: ${sBefore.britishShips.filter(sh => !sh.def.isDummy).length}艘 | 伪装: ${sBefore.britishShips.filter(sh => sh.def.isDummy).length}个`)
  w(`- 固定位置: C6(乔治五世/反击/胜利), D6(罗德尼), F4(声望/皇家方舟), F1(拉米利斯)`)
  w(`- 自由船: 德军出生点速2可达格散布`)
  w(``)

  setupBritish(env)
  const sAfter = env.game.state
  w(`| 舰船 | 位置 | 类型 |`)
  w(`|------|------|------|`)
  for (const sh of sAfter.britishShips) {
    const pos = sAfter.britishPositions.get(sh.def.id)
    w(`| ${sh.def.name} | ${pos ? hexToLabel(pos) : '?'} | ${sh.def.isDummy ? '伪装' : '真船'} |`)
  }
  w(``)
  w(`---`)
  w(``)

  // ===== 主循环 =====
  while (!env.game.state.gameOver && stepNum < 500) {
    obs = env.getObservation(); (obs as any).raw = env.game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

    if (obs.phase === lastPhase) stuck++
    else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 20) {
      const f = obs.actions.find(a => a.type === 'finish-phase')
      if (f) { env.step(f); stuck = 0; w(`> ⚠ 防死锁强制推进\n`); continue }
    }

    if (obs.phase === 'setup-british') continue

    stepNum++
    const player = obs.activePlayer
    const isGerman = player === 'german'
    const ph = obs.phase; const turn = env.game.state.turn
    const curShipId = obs.actions[0]?.params?.shipId
    const curShip = curShipId
      ? (isGerman ? env.game.state.germanShips : env.game.state.britishShips).find(sh => sh.def.id === curShipId)
      : undefined

    w(`### Step ${stepNum}: T${turn} ${ph} — ${isGerman?'德军':'英军'}`)
    w(``)

    const stateLine = `VP 德${env.game.state.vp.german}/英${env.game.state.vp.british} | 俾斯麦发现:${env.game.state.bismarckFound ? '是' : '否'}`
    const shipLine = curShip ? ` | 当前: ${curShip.def.name}${curShip.def.isDummy?'(伪装)':''} HP:${curShip.steps}` : ''
    w(`> ${stateLine}${shipLine}`)
    w(``)

    // combat
    if (ph === 'combat') {
      const a = obs.actions.find(x => x.type === 'combat')
      if (a) { w(`- 动作: ⚔ 结算战斗`); env.step(a) }
      w(``)
      continue
    }

    // transport
    if (ph === 'transport-attack') {
      const result = isGerman ? gerAi.selectGerman(obs, true) : britAi.selectBritish(obs, true)
      const a = obs.actions.find(x => x.id === result.actionId)
      if (a) { w(`- 动作: ${a.label}`); env.step(a) }
      w(``)
      continue
    }

    // british-search
    if (ph === 'british-search') {
      const result = britAi.selectBritish(obs, true)
      const a = obs.actions.find(x => x.id === result.actionId)
      if (a) {
        if (a.type === 'air-search') {
          const airActions = obs.actions.filter((x: any) => x.type === 'air-search')
          w(`- 动作: ✈ 航空索敌 → **${a.params?.targetLabel}**`)
          w(`- 可选格(${airActions.length}): ${airActions.map((x: any) => x.params?.targetLabel).join(', ')}`)
        } else {
          w(`- 动作: ${a.label}`)
        }
        env.step(a)
      }
      w(``)
      continue
    }

    // move phases
    const result = isGerman ? gerAi.selectGerman(obs, true) : britAi.selectBritish(obs, true)
    const debug = result.debug
    const a = obs.actions.find(x => x.id === result.actionId)

    if (!a) {
      w(`- ❌ actionId=${result.actionId} 未找到, fallback`)
      if (obs.actions.length > 0) env.step(obs.actions[0])
      w(``)
      continue
    }

    w(`- **动作**: ${a.label}`)
    w(``)

    if (debug && a.type === 'move') {
      // 策略得分
      w(`#### 策略评估`)
      w(``)
      w(`| 策略 | 原始得分 | 概率 |`)
      w(`|------|---------|------|`)
      for (const ss of debug.strategyScores) {
        const star = ss.name === debug.pickedStrategy ? '**' : ''
        w(`| ${star}${ss.name}${star} | ${ss.raw.toFixed(2)} | ${star}${(ss.prob*100).toFixed(0)}%${star} |`)
      }
      w(``)
      w(`> 选中: **${debug.pickedStrategy}**`)
      w(``)

      // 热力图
      w(`#### 热力图 — ${curShip?.def.name || '?'}`)
      w(``)
      w(renderHeatmapMd(debug.heatmap, `策略=${debug.pickedStrategy}`))

      // 移动选项
      const sorted = [...debug.moveScores].sort((a, b) => b.score - a.score)
      const pickedLabel = a.params?.targetLabel || '?'
      w(`#### 移动选项 (Top ${Math.min(8, sorted.length)})`)
      w(``)
      w(`| 目标 | 热力 | 得分 |`)
      w(`|------|------|------|`)
      for (let i = 0; i < Math.min(8, sorted.length); i++) {
        const m = sorted[i]
        const mark = m.label === pickedLabel ? ' **←**' : ''
        w(`| ${m.label}${mark} | ${m.heat.toFixed(2)} | ${m.score.toFixed(2)} |`)
      }
      w(``)
    }

    env.step(a)
  }

  // ===== 终局 =====
  const final = env.game.state
  w(`---`)
  w(``)
  w(`## 终局 — T${final.turn}`)
  w(``)
  w(`| 项目 | 值 |`)
  w(`|------|-----|`)
  w(`| 胜者 | **${final.winner === 'german' ? '德军' : '英军'}** |`)
  w(`| 原因 | ${final.victoryReason} |`)
  w(`| 比分 | 德军 ${final.vp.german}VP / 英军 ${final.vp.british}VP |`)
  w(`| 总步数 | ${stepNum} |`)
  w(``)
  w(`### 最终舰船状态`)
  w(``)
  w(`**德军**`)
  w(``)
  w(`| 舰船 | 位置 | HP |`)
  w(`|------|------|-----|`)
  for (const sh of final.germanShips) {
    const pos = final.germanPositions.get(sh.def.id)
    w(`| ${sh.def.name} | ${pos ? hexToLabel(pos) : '沉没'} | ${sh.steps} |`)
  }
  w(``)
  w(`**英军**`)
  w(``)
  w(`| 舰船 | 位置 | HP |`)
  w(`|------|------|-----|`)
  for (const sh of final.britishShips) {
    const pos = final.britishPositions.get(sh.def.id)
    w(`| ${sh.def.name}${sh.def.isDummy?' (伪装)':''} | ${pos ? hexToLabel(pos) : '沉没/移除'} | ${sh.steps} |`)
  }
  w(``)

  fs.writeFileSync(OUT, lines.join('\n'), 'utf-8')
  console.log(`\n报告已写入 ${OUT} (${lines.length}行)`)
}

main().catch(e => { console.error(e); process.exit(1) })
