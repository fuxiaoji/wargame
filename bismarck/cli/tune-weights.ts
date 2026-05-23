#!/usr/bin/env npx tsx
/** 双种群共演化训练 —— 断点续训 + 进度条 + 实时日志 */

import { BismarckEnv } from '../engine/env'
import { createStateMachineAI, DEFAULT_WEIGHTS, Weights } from './state-machine'
import * as fs from 'fs'
import * as path from 'path'

const GENERATIONS = parseInt(process.argv[2] || '50')
const POP_SIZE = parseInt(process.argv[3] || '10')
const GAMES_PER_PAIR = parseInt(process.argv[4] || '100')
const TOUR_DIR = process.argv[5] || 'tournament'

// ========== 进度条 ==========
function progress(current: number, total: number, width = 30) {
  const pct = current / total
  const filled = Math.round(width * pct)
  return '[' + '▓'.repeat(filled) + '░'.repeat(width - filled) + `] ${(pct*100).toFixed(0)}%`
}

// ========== 加载/保存 checkpoint ==========
interface Checkpoint {
  generation: number
  gerPop: Weights[]
  britPop: Weights[]
  gerWinHistory: number[]
  britWinHistory: number[]
  diversityHistory: number[]
  strategyHistory: { rush: number; farm: number; hunt: number; hide: number }[]
}

function loadCheckpoint(): Checkpoint | null {
  const p = path.join(TOUR_DIR, 'checkpoint.json')
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(TOUR_DIR, { recursive: true })
  fs.writeFileSync(path.join(TOUR_DIR, 'checkpoint.json'), JSON.stringify(cp, null, 2))
}

// ========== 变异 ==========
function mutate(w: Weights, scale = 1.0): Weights {
  const n = { ...w }
  const keys = Object.keys(n) as (keyof Weights)[]
  for (const k of keys) {
    if (k === 'temperature') {
      n.temperature = Math.max(0.1, Math.min(3.0, n.temperature + (Math.random() - 0.5) * 0.5 * scale))
    } else if (Math.random() < 0.3) {
      (n as any)[k] = Math.max(0.1, (w[k] as number) + (Math.random() - 0.5) * 2 * scale)
    }
  }
  return n
}

// ========== 策略距离 (KL散度近似) ==========
function strategyKL(a: number[], b: number[]): number {
  let kl = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] > 0.001 && b[i] > 0.001) kl += a[i] * Math.log(a[i] / b[i])
  }
  return Math.abs(kl)
}

// ========== 单局 ==========
function runOneGame(gerW: Weights, britW: Weights): { winner: string; gerStrategies: number[]; britStrategies: number[] } {
  const ai = createStateMachineAI(gerW)
  const bi = createStateMachineAI(britW)
  const env = new BismarckEnv()
  let steps = 0, stuck = 0, lastPhase = ''
  const gerStrats: number[] = []; const britStrats: number[] = []

  while (!env.game.state.gameOver && steps < 500) {
    const obs = env.getObservation()
    ;(obs as any).raw = env.game.state
    if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

    if (obs.phase === lastPhase) stuck++
    else { stuck = 0; lastPhase = obs.phase }
    if (stuck > 20) {
      const f = obs.actions.find(a => a.type === 'finish-phase')
      if (f) { env.step(f); stuck = 0; continue }
    }

    let result: { actionId: number | null; rawResponse: string }

    if (obs.phase === 'setup-british') {
      result = bi.selectBritish(obs)
      const raw = result.rawResponse
      const dh = ['E5','E3','D5','C7','B6','F6','F5','F3','F2','E1','D1','C1']
      for (const sh of env.game.state.britishShips)
        if (sh.def.isDummy && !env.game.state.britishPositions.has(sh.def.id))
          env.game.placeBritishToken(sh.def.id, dh[Math.floor(Math.random()*dh.length)])
      const re = /\(([^,)]+),\s*([A-F]\d)\)/g; let m
      while ((m = re.exec(raw)) !== null) {
        const sh = env.game.state.britishShips.find(x => !x.def.isDummy && !env.game.state.britishPositions.has(x.def.id) &&
          (x.def.name===m![1].trim() || x.def.name.includes(m![1].trim()) || m![1].trim().includes(x.def.name.slice(0,2))))
        if (sh) env.game.placeBritishToken(sh.def.id, m[2])
      }
      const left = env.game.state.britishShips.filter(x => !env.game.state.britishPositions.has(x.def.id))
      if (left.length > 0) {
        const hs = ['E7','E6','E5','E3','E2','E1','D7','D5','D1','C7','C1','B6','F6','F5','F3','F2']
        for (const sh of left) env.game.placeBritishToken(sh.def.id, hs[Math.floor(Math.random()*hs.length)])
      }
      env.game.finishSetup()
      steps++; continue
    }

    result = obs.activePlayer === 'german' ? ai.selectGerman(obs) : bi.selectBritish(obs)

    // 记录策略标签
    if (obs.activePlayer === 'german') {
      const strat = result.rawResponse.split(':')[0]
      const idx = ['rush','farm','hunt','hide'].indexOf(strat)
      if (idx >= 0) gerStrats.push(idx)
    }

    if (result.actionId !== null) {
      const action = obs.actions.find(a => a.id === result.actionId)
      if (action) env.step(action)
      else if (obs.actions.length > 0) env.step(obs.actions[0])
    } else if (obs.actions.length > 0) env.step(obs.actions[0])
    steps++
  }

  const s = env.game.state
  const gerProbs = [0,0,0,0]
  for (const i of gerStrats) gerProbs[i]++
  const total = gerStrats.length || 1
  for (let i = 0; i < 4; i++) gerProbs[i] /= total

  return { winner: s.winner === 'german' ? 'german' : 'british', gerStrategies: gerProbs, britStrategies: [] }
}

// ========== 循环赛 ==========
async function roundRobin(gerPop: Weights[], britPop: Weights[], gen: number) {
  const N = gerPop.length, M = britPop.length
  const totalGames = N * M * GAMES_PER_PAIR
  let completed = 0
  const startTime = Date.now()

  const gerWins = new Array(N).fill(0)
  const gerTotals = new Array(N).fill(0)
  const britWins = new Array(M).fill(0)
  const britTotals = new Array(M).fill(0)
  const gerAllStrats: number[][] = Array.from({ length: N }, () => [0,0,0,0])

  for (let gi = 0; gi < N; gi++) {
    for (let bi = 0; bi < M; bi++) {
      for (let g = 0; g < GAMES_PER_PAIR; g++) {
        // 前半德军，后半交换
        const swapSide = g >= GAMES_PER_PAIR / 2
        const gerWeights = swapSide ? britPop[bi] : gerPop[gi]
        const britWeights = swapSide ? gerPop[gi] : britPop[bi]
        const result = runOneGame(gerWeights, britWeights)

        if (!swapSide) {
          gerTotals[gi]++; if (result.winner === 'german') gerWins[gi]++
          for (let s = 0; s < 4; s++) gerAllStrats[gi][s] += result.gerStrategies[s]
          britTotals[bi]++; if (result.winner === 'british') britWins[bi]++
        } else {
          britTotals[bi]++; if (result.winner === 'british') britWins[bi]++
          gerTotals[gi]++; if (result.winner === 'german') gerWins[gi]++
        }

        completed++
        if (completed % 500 === 0) {
          const elapsed = (Date.now() - startTime) / 1000
          const rate = (completed / elapsed).toFixed(0)
          process.stdout.write(`\r  ⚔ 对局中... ${completed}/${totalGames} (${(completed/totalGames*100).toFixed(1)}%) 速度:${rate}局/秒`)
        }
      }
    }
  }

  // 输出完成
  const elapsed = (Date.now() - startTime) / 1000
  process.stdout.write(`\r  ✅ 完成 ${elapsed.toFixed(1)}s`)

  // 归一化策略
  for (let i = 0; i < N; i++) {
    const t = gerAllStrats[i].reduce((a,b)=>a+b, 0) || 1
    for (let s = 0; s < 4; s++) gerAllStrats[i][s] /= t
  }

  // 多样性计算
  let diversity = 0
  for (let i = 0; i < N; i++)
    for (let j = i + 1; j < N; j++)
      diversity += strategyKL(gerAllStrats[i], gerAllStrats[j])
  diversity = 1 - diversity / (N * (N - 1) / 2) / 2 // 归一化到 0-1

  return { gerWins, gerTotals, britWins, britTotals, diversity, gerAllStrats }
}

// ========== 繁衍 ==========
function breed(fitness: number[], pop: Weights[], strats: number[][], popSize: number, gen: number): Weights[] {
  const scale = Math.max(0.1, 1 - gen * 0.01) // 退火
  const sorted = fitness.map((f, i) => ({ f, w: pop[i], s: strats[i] })).sort((a, b) => b.f - a.f)
  const newPop: Weights[] = []

  // 保留 Top3
  for (let i = 0; i < 3 && i < sorted.length; i++) newPop.push({ ...sorted[i].w })

  // 多样性保留: 确保每种策略有代表
  const stratLabels = ['rush', 'farm', 'hunt', 'hide']
  const stratPresent = new Set<number>()
  for (const item of sorted) {
    const topStrat = item.s.indexOf(Math.max(...item.s))
    if (!stratPresent.has(topStrat) && newPop.length < popSize) {
      newPop.push({ ...item.w }); stratPresent.add(topStrat)
    }
  }

  // 变异填充
  while (newPop.length < popSize) {
    const parent = newPop[Math.floor(Math.random() * newPop.length)]
    newPop.push(mutate({ ...parent }, scale))
  }

  return newPop
}

// ========== 主流程 ==========
async function main() {
  let cp = loadCheckpoint()
  if (cp) {
    process.stdout.write(`⏮ 从第 ${cp.generation} 代恢复训练\n`)
  } else {
    cp = {
      generation: 0,
      gerPop: Array.from({ length: POP_SIZE }, () => ({ ...DEFAULT_WEIGHTS })),
      britPop: Array.from({ length: POP_SIZE }, () => ({ ...DEFAULT_WEIGHTS })),
      gerWinHistory: [], britWinHistory: [], diversityHistory: [], strategyHistory: []
    }
    // 初始种群加入变异
    for (let i = 1; i < POP_SIZE; i++) {
      cp.gerPop[i] = mutate(cp.gerPop[i], 2.0)
      cp.britPop[i] = mutate(cp.britPop[i], 2.0)
    }
  }

  process.stdout.write(`\n═══════════════════════════════════════════\n`)
  process.stdout.write(`  双种群共演化训练\n`)
  process.stdout.write(`  德军:${POP_SIZE}  英军:${POP_SIZE}  每对:${GAMES_PER_PAIR}局\n`)
  process.stdout.write(`  总局数/代: ${POP_SIZE*POP_SIZE*GAMES_PER_PAIR}  目标: ${GENERATIONS}代\n`)
  process.stdout.write(`═══════════════════════════════════════════\n\n`)

  const startGen = cp.generation
  for (let gen = startGen; gen < GENERATIONS; gen++) {
    const pBar = progress(gen, GENERATIONS)
    process.stdout.write(`代 ${(gen+1).toString().padStart(3)}/${GENERATIONS} ${pBar.padEnd(40)}`)

    const { gerWins, gerTotals, britWins, britTotals, diversity, gerAllStrats } = await roundRobin(cp.gerPop, cp.britPop, gen)

    // 德军排名
    const gerFitness = gerWins.map((w, i) => {
      const simPenalty = gerAllStrats.map((s, j) => i !== j ? strategyKL(gerAllStrats[i], s) : 0).reduce((a,b)=>a+b, 0)
      return (gerTotals[i] > 0 ? w / gerTotals[i] : 0) - 0.1 * simPenalty
    })

    // 英军排名
    const britFitness = britWins.map((w, i) => britTotals[i] > 0 ? w / britTotals[i] : 0)

    const avgGer = gerWins.reduce((a,b)=>a+b,0) / Math.max(1, gerTotals.reduce((a,b)=>a+b,0))
    const avgBrit = britWins.reduce((a,b)=>a+b,0) / Math.max(1, britTotals.reduce((a,b)=>a+b,0))

    // 策略分布
    const stratDist = { rush: 0, farm: 0, hunt: 0, hide: 0 }
    for (const s of gerAllStrats) { stratDist.rush += s[0]; stratDist.farm += s[1]; stratDist.hunt += s[2]; stratDist.hide += s[3] }
    const sTotal = POP_SIZE || 1
    stratDist.rush /= sTotal; stratDist.farm /= sTotal; stratDist.hunt /= sTotal; stratDist.hide /= sTotal

    process.stdout.write(`  德军胜率:${(avgGer*100).toFixed(1)}%  英军胜率:${(avgBrit*100).toFixed(1)}%  多样性:${diversity.toFixed(2)}\n`)
    process.stdout.write(`  策略: Rush${(stratDist.rush*100).toFixed(0)}% Farm${(stratDist.farm*100).toFixed(0)}% Hunt${(stratDist.hunt*100).toFixed(0)}% Hide${(stratDist.hide*100).toFixed(0)}%\n\n`)

    // 繁衍
    cp.gerPop = breed(gerFitness, cp.gerPop, gerAllStrats, POP_SIZE, gen)
    cp.britPop = breed(britFitness, cp.britPop, gerAllStrats.map(()=>[0,0,0,0]), POP_SIZE, gen)
    cp.generation = gen + 1
    cp.gerWinHistory.push(avgGer)
    cp.britWinHistory.push(avgBrit)
    cp.diversityHistory.push(diversity)
    cp.strategyHistory.push(stratDist)

    // 保存 checkpoint + 本代数据
    saveCheckpoint(cp)
    const genDir = path.join(TOUR_DIR, `gen_${String(gen).padStart(3, '0')}`)
    fs.mkdirSync(genDir, { recursive: true })
    fs.writeFileSync(path.join(genDir, 'ger_population.json'), JSON.stringify(cp.gerPop))
    fs.writeFileSync(path.join(genDir, 'brit_population.json'), JSON.stringify(cp.britPop))
    fs.writeFileSync(path.join(genDir, 'stats.json'), JSON.stringify({ avgGer, avgBrit, diversity, stratDist }))
  }

  // 保存最终汇总
  fs.writeFileSync(path.join(TOUR_DIR, 'summary.json'), JSON.stringify({
    gerWinHistory: cp.gerWinHistory,
    britWinHistory: cp.britWinHistory,
    diversityHistory: cp.diversityHistory,
    strategyHistory: cp.strategyHistory,
    bestGer: cp.gerPop[0],
    bestBrit: cp.britPop[0],
  }, null, 2))
  process.stdout.write(`\n✅ 训练完成! 数据: ${TOUR_DIR}/\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
