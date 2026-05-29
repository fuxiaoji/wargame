#!/usr/bin/env npx tsx
/** Rank current state-machine AIs against a compact benchmark pool. */
import { BismarckEnv } from '../engine/env'
import { GERMAN_START_HEXES } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import { createStateMachineAI, DEFAULT_WEIGHTS } from './state-machine'
import { createYanfuAI } from './state-machine-yanfu'
import { V8_BRITISH_BEST, V8_GERMAN_BEST, V11_BRITISH_BEST, V11_GERMAN_BEST } from './presets'
import * as fs from 'fs'
import * as path from 'path'

type Side = 'german' | 'british'
type AgentKind = 'sm' | 'yanfu' | 'random'

interface Candidate {
  label: string
  kind: AgentKind
  weights?: any
  idx?: number
}

interface Score {
  label: string
  idx?: number
  wins: number
  games: number
  avgVpFor: number
  avgVpAgainst: number
  avgTurns: number
}

const ROOT = path.join(import.meta.dirname, '..', '..')
const DATA = path.join(ROOT, 'deeplearn', 'data', 'training_v11')
const OUT = path.join(ROOT, 'test_results', '2026-05-28_state_machine_ranking')
const GAMES_PER_PAIR = Number(process.argv[2] ?? 10)
fs.mkdirSync(OUT, { recursive: true })

function rng(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function setupBritish(env: BismarckEnv) {
  const s = env.game.state
  const used = new Set<string>(GERMAN_START_HEXES)
  for (const [hex, ids] of Object.entries(BRITISH_FIXED_POSITIONS)) {
    used.add(hex)
    for (const id of ids) env.game.placeBritishToken(id, hex)
  }

  const reachable = new Set<string>()
  const dummyShip = { def: { speed: 2 }, steps: 2 } as any
  for (const label of GERMAN_START_HEXES) {
    const h = { q: label.charCodeAt(0) - 65, r: parseInt(label.slice(1)) }
    for (const l of getGermanReachableLabels(dummyShip, h)) {
      if (!used.has(l)) reachable.add(l)
    }
  }

  const placeFree = (isDummy: boolean) => {
    for (const sh of s.britishShips) {
      if (sh.def.isDummy !== isDummy || s.britishPositions.has(sh.def.id)) continue
      const avail = [...reachable].filter(h => !used.has(h))
      if (avail.length > 0) {
        const picked = avail[Math.floor(Math.random() * avail.length)]
        env.game.placeBritishToken(sh.def.id, picked)
        used.add(picked)
      }
    }
  }

  placeFree(false)
  placeFree(true)

  const fallback = ['E7', 'E5', 'E3', 'E2', 'E1', 'D8', 'D5', 'D4', 'D3', 'D2', 'D1', 'C7', 'C1', 'B6', 'F6', 'F5', 'F3', 'F2', 'A3', 'A4', 'B4']
  for (const sh of s.britishShips) {
    if (!s.britishPositions.has(sh.def.id)) {
      env.game.placeBritishToken(sh.def.id, fallback[Math.floor(Math.random() * fallback.length)])
    }
  }
  env.game.finishSetup()
}

function selectAction(candidate: Candidate, side: Side, obs: any, aiCache: Map<string, any>): number | null {
  if (candidate.kind === 'random') {
    return obs.actions.length ? obs.actions[Math.floor(Math.random() * obs.actions.length)].id : null
  }

  const key = `${candidate.kind}:${candidate.label}`
  if (!aiCache.has(key)) {
    aiCache.set(key, candidate.kind === 'yanfu'
      ? createYanfuAI()
      : createStateMachineAI(candidate.weights ?? DEFAULT_WEIGHTS))
  }
  const ai = aiCache.get(key)
  const result = side === 'german' ? ai.selectGerman(obs) : ai.selectBritish(obs)
  return result.actionId ?? null
}

function runGame(ger: Candidate, brit: Candidate, seed: number) {
  const originalRandom = Math.random
  Math.random = rng(seed)
  try {
    const env = new BismarckEnv(seed)
    const aiCache = new Map<string, any>()
    let steps = 0
    let stuck = 0
    let lastPhase = ''

    while (!env.game.state.gameOver && steps < 500) {
      const obs = env.getObservation()
      ;(obs as any).raw = env.game.state
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

      if (obs.phase === lastPhase) stuck++
      else { stuck = 0; lastPhase = obs.phase }

      if (stuck > 15) {
        const finish = obs.actions.find(a => a.type === 'finish-phase')
        if (finish) {
          env.step(finish)
          stuck = 0
          steps++
          continue
        }
      }

      if (obs.phase === 'setup-british') {
        setupBritish(env)
        steps++
        continue
      }

      const active = obs.activePlayer as Side
      const candidate = active === 'german' ? ger : brit
      const actionId = selectAction(candidate, active, obs, aiCache)
      const action = obs.actions.find(a => a.id === actionId) ?? obs.actions[0]
      if (action) env.step(action)
      steps++
    }

    return {
      germanWon: env.game.state.winner === 'german',
      vpGerman: env.game.state.vp.german,
      vpBritish: env.game.state.vp.british,
      turns: env.game.state.turn,
    }
  } finally {
    Math.random = originalRandom
  }
}

function loadPop(side: 'ger' | 'brit') {
  const file = path.join(DATA, 'gen_004', `${side}_population.json`)
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function buildCandidates() {
  const gerPop = loadPop('ger')
  const britPop = loadPop('brit')
  const germanCandidates: Candidate[] = gerPop.map((weights: any, idx: number) => ({ label: `V11德#${idx}`, idx, kind: 'sm', weights }))
  const britishCandidates: Candidate[] = britPop.map((weights: any, idx: number) => ({ label: `V11英#${idx}`, idx, kind: 'sm', weights }))

  const extraGerman: Candidate[] = [
    { label: 'V11德预设', kind: 'sm', weights: V11_GERMAN_BEST },
    { label: 'V8德预设', kind: 'sm', weights: V8_GERMAN_BEST },
    { label: '默认德军', kind: 'sm', weights: DEFAULT_WEIGHTS },
    { label: '严父德军', kind: 'yanfu' },
    { label: '乱打德军', kind: 'random' },
  ]
  const extraBritish: Candidate[] = [
    { label: 'V11英预设', kind: 'sm', weights: V11_BRITISH_BEST },
    { label: 'V8英预设', kind: 'sm', weights: V8_BRITISH_BEST },
    { label: '默认英军', kind: 'sm', weights: DEFAULT_WEIGHTS },
    { label: '严父英军', kind: 'yanfu' },
    { label: '乱打英军', kind: 'random' },
  ]

  const germanBench: Candidate[] = [
    ...[11, 4, 3, 9, 12].map(idx => germanCandidates[idx]),
    ...extraGerman,
  ]
  const britishBench: Candidate[] = [
    ...[15, 16, 19, 8, 3].map(idx => britishCandidates[idx]),
    ...extraBritish,
  ]

  return {
    germanCandidates: [...germanCandidates, ...extraGerman],
    britishCandidates: [...britishCandidates, ...extraBritish],
    germanBench,
    britishBench,
  }
}

function scoreGerman(candidate: Candidate, britishBench: Candidate[]): Score {
  const score: Score = { label: candidate.label, idx: candidate.idx, wins: 0, games: 0, avgVpFor: 0, avgVpAgainst: 0, avgTurns: 0 }
  for (let bi = 0; bi < britishBench.length; bi++) {
    for (let g = 0; g < GAMES_PER_PAIR; g++) {
      const r = runGame(candidate, britishBench[bi], 100000 + (candidate.idx ?? 90) * 1000 + bi * 100 + g)
      score.games++
      if (r.germanWon) score.wins++
      score.avgVpFor += r.vpGerman
      score.avgVpAgainst += r.vpBritish
      score.avgTurns += r.turns
    }
  }
  score.avgVpFor /= score.games
  score.avgVpAgainst /= score.games
  score.avgTurns /= score.games
  return score
}

function scoreBritish(candidate: Candidate, germanBench: Candidate[]): Score {
  const score: Score = { label: candidate.label, idx: candidate.idx, wins: 0, games: 0, avgVpFor: 0, avgVpAgainst: 0, avgTurns: 0 }
  for (let gi = 0; gi < germanBench.length; gi++) {
    for (let g = 0; g < GAMES_PER_PAIR; g++) {
      const r = runGame(germanBench[gi], candidate, 200000 + (candidate.idx ?? 90) * 1000 + gi * 100 + g)
      score.games++
      if (!r.germanWon) score.wins++
      score.avgVpFor += r.vpBritish
      score.avgVpAgainst += r.vpGerman
      score.avgTurns += r.turns
    }
  }
  score.avgVpFor /= score.games
  score.avgVpAgainst /= score.games
  score.avgTurns /= score.games
  return score
}

function line(score: Score, rank: number) {
  const wr = `${(score.wins / score.games * 100).toFixed(1)}%`
  return `| ${rank} | ${score.label} | ${wr} | ${score.wins}/${score.games} | ${score.avgVpFor.toFixed(2)} | ${score.avgVpAgainst.toFixed(2)} | ${score.avgTurns.toFixed(1)} |`
}

async function main() {
  const { germanCandidates, britishCandidates, germanBench, britishBench } = buildCandidates()
  console.log(`Ranking with ${GAMES_PER_PAIR} games/pair`)
  console.log(`German candidates: ${germanCandidates.length}, British bench: ${britishBench.length}`)
  console.log(`British candidates: ${britishCandidates.length}, German bench: ${germanBench.length}`)

  const germanScores: Score[] = []
  for (const c of germanCandidates) {
    process.stdout.write(`\rTesting German ${c.label.padEnd(12)} `)
    germanScores.push(scoreGerman(c, britishBench))
  }
  germanScores.sort((a, b) => b.wins / b.games - a.wins / a.games)
  console.log('\nGerman ranking done.')

  const britishScores: Score[] = []
  for (const c of britishCandidates) {
    process.stdout.write(`\rTesting British ${c.label.padEnd(12)} `)
    britishScores.push(scoreBritish(c, germanBench))
  }
  britishScores.sort((a, b) => b.wins / b.games - a.wins / a.games)
  console.log('\nBritish ranking done.')

  const report: string[] = []
  report.push('# 当前状态机 AI 排名', '')
  report.push(`- 日期: 2026-05-28`)
  report.push(`- 引擎: TypeScript 当前 \`bismarck/cli/state-machine.ts\``)
  report.push(`- 样本: 每个候选对每个基准 ${GAMES_PER_PAIR} 局`)
  report.push(`- 德军基准池: ${germanBench.map(c => c.label).join(', ')}`)
  report.push(`- 英军基准池: ${britishBench.map(c => c.label).join(', ')}`)
  report.push('', '## 德军排名', '')
  report.push('| # | 个体 | 胜率 | 胜场 | 平均德VP | 平均英VP | 平均回合 |')
  report.push('|---|------|------|------|----------|----------|----------|')
  germanScores.forEach((s, i) => report.push(line(s, i + 1)))
  report.push('', '## 英军排名', '')
  report.push('| # | 个体 | 胜率 | 胜场 | 平均英VP | 平均德VP | 平均回合 |')
  report.push('|---|------|------|------|----------|----------|----------|')
  britishScores.forEach((s, i) => report.push(line(s, i + 1)))

  fs.writeFileSync(path.join(OUT, 'report.md'), report.join('\n'))
  fs.writeFileSync(path.join(OUT, 'raw_data.json'), JSON.stringify({ gamesPerPair: GAMES_PER_PAIR, germanScores, britishScores }, null, 2))

  console.log(`\nSaved: ${path.join(OUT, 'report.md')}`)
  console.log('\nTop German:')
  console.log(germanScores.slice(0, 10).map((s, i) => `${i + 1}. ${s.label} ${(s.wins / s.games * 100).toFixed(1)}%`).join('\n'))
  console.log('\nTop British:')
  console.log(britishScores.slice(0, 10).map((s, i) => `${i + 1}. ${s.label} ${(s.wins / s.games * 100).toFixed(1)}%`).join('\n'))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
