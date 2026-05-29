#!/usr/bin/env npx tsx
/** Generate clean RL tensor v3 data from the repaired TS engine. */

import * as fs from 'fs'
import * as path from 'path'
import { BismarckEnv, type GameAction, type GameObservation } from '../engine/env'
import { GERMAN_START_HEXES, hexDistance, hexToLabel, isSeaRoute, labelToHex } from '../engine/map'
import { BRITISH_FIXED_POSITIONS } from '../engine/setup'
import { getGermanReachableLabels } from '../engine/movement'
import { createStateMachineAI, DEFAULT_WEIGHTS, type Weights } from './state-machine'
import { createYanfuAI } from './state-machine-yanfu'
import { V11_BRITISH_BEST, V11_GERMAN_BEST } from './presets'
import { writeRlTensorV3Game, type RlTensorV3Step, type RlTensorV3Result, RL_TENSOR_V3 } from '../engine/tensor-v3'

type PolicyKind = 'state_machine' | 'yanfu' | 'random'

interface PolicySpec {
  kind: PolicyKind
  label: string
  germanWeights?: Weights
  britishWeights?: Weights
}

interface GameSnapshot {
  vpGerman: number
  vpBritish: number
  bismarckHp: number
  bismarckPos: string | null
  bismarckFound: boolean
  germanPositionPublic: boolean
  transportRevealedHex: string | null
  britishCrowding: number
}

const ROOT = path.join(import.meta.dirname, '..', '..')
const DEFAULT_OUT = path.join(ROOT, 'deeplearn', 'data', 'rl_tensor_v3', 'raw')

function arg(name: string, fallback: string) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function flag(name: string) {
  return process.argv.includes(name)
}

function cloneGameState<T>(state: T): T {
  return structuredClone(state)
}

function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`
  if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`
  return `${s}s`
}

function rng(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6D2B79F5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function loadV11Pop(side: 'ger' | 'brit'): Weights[] {
  const file = path.join(ROOT, 'deeplearn', 'data', 'training_v11', 'gen_004', `${side}_population.json`)
  if (!fs.existsSync(file)) return side === 'ger' ? [V11_GERMAN_BEST] : [V11_BRITISH_BEST]
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function mutateWeights(base: Weights, scale = 0.5): Weights {
  const copy: any = { ...base }
  for (const key of Object.keys(copy)) {
    if (typeof copy[key] !== 'number') continue
    if (Math.random() < 0.35) copy[key] = Math.max(0.1, copy[key] + (Math.random() - 0.5) * scale)
  }
  return copy as Weights
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
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
    for (const ship of s.britishShips) {
      if (ship.def.isDummy !== isDummy || s.britishPositions.has(ship.def.id)) continue
      const avail = [...reachable].filter(h => !used.has(h))
      if (avail.length > 0) {
        const p = pick(avail)
        env.game.placeBritishToken(ship.def.id, p)
        used.add(p)
      }
    }
  }
  placeFree(false)
  placeFree(true)

  const fallback = ['E7', 'E5', 'E3', 'E2', 'E1', 'D8', 'D5', 'D4', 'D3', 'D2', 'D1', 'C7', 'C1', 'B6', 'F6', 'F5', 'F3', 'F2', 'A3', 'A4', 'B4']
  for (const ship of s.britishShips) {
    if (!s.britishPositions.has(ship.def.id)) env.game.placeBritishToken(ship.def.id, pick(fallback))
  }
  env.game.finishSetup()
}

function buildPolicy(spec: PolicySpec) {
  if (spec.kind === 'yanfu') return createYanfuAI()
  if (spec.kind === 'state_machine') return createStateMachineAI(spec.germanWeights ?? DEFAULT_WEIGHTS, undefined, undefined, spec.britishWeights)
  return null
}

function selectAction(policy: ReturnType<typeof buildPolicy>, spec: PolicySpec, obs: GameObservation): GameAction {
  if (spec.kind === 'random' || !policy) return pick(obs.actions)
  const res = obs.activePlayer === 'german' ? policy.selectGerman(obs) : policy.selectBritish(obs)
  return obs.actions.find(a => a.id === res.actionId) ?? obs.actions[0]
}

function snapshot(env: BismarckEnv): GameSnapshot {
  const s = env.game.state
  const bismarck = s.germanShips.find(sh => sh.def.id === 'bismarck')
  const bpos = s.germanPositions.get('bismarck')
  return {
    vpGerman: s.vp.german,
    vpBritish: s.vp.british,
    bismarckHp: bismarck?.steps ?? 0,
    bismarckPos: bpos ? hexToLabel(bpos) : null,
    bismarckFound: s.bismarckFound,
    germanPositionPublic: s.germanPositionPublic,
    transportRevealedHex: s.transportRevealedHex,
    britishCrowding: crowding(env),
  }
}

function crowding(env: BismarckEnv) {
  const counts = new Map<string, number>()
  for (const ship of env.game.state.britishShips) {
    const pos = env.game.state.britishPositions.get(ship.def.id)
    const label = pos ? hexToLabel(pos) : null
    if (ship.steps > 0 && label) counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  let penalty = 0
  for (const n of counts.values()) penalty += Math.max(0, n - 2)
  return penalty
}

function distToF7(label: string | null) {
  const a = label ? labelToHex(label) : null
  const b = labelToHex('F7')
  return a && b ? hexDistance(a, b) : 8
}

function distToRoute(label: string | null) {
  const a = label ? labelToHex(label) : null
  if (!a) return 8
  let best = 8
  for (const route of ['D2', 'D3', 'C4', 'C3', 'D5', 'E1', 'F4', 'E4', 'E5']) {
    const b = labelToHex(route)
    if (b) best = Math.min(best, hexDistance(a, b))
  }
  return best
}

function nearestBritishDist(env: BismarckEnv, label: string | null) {
  const a = label ? labelToHex(label) : null
  if (!a) return 8
  let best = 8
  for (const ship of env.game.state.britishShips) {
    const pos = env.game.state.britishPositions.get(ship.def.id)
    if (ship.steps > 0 && pos) best = Math.min(best, hexDistance(a, pos))
  }
  return best
}

function computeReward(before: GameSnapshot, after: GameSnapshot, env: BismarckEnv) {
  let rg = 0
  let rb = 0

  const dvg = after.vpGerman - before.vpGerman
  const dvb = after.vpBritish - before.vpBritish
  rg += 0.10 * dvg - 0.10 * dvb
  rb += 0.10 * dvb - 0.10 * dvg

  rg += 0.05 * ((8 - distToF7(after.bismarckPos)) - (8 - distToF7(before.bismarckPos))) / 8
  rg += 0.05 * ((8 - distToRoute(after.bismarckPos)) - (8 - distToRoute(before.bismarckPos))) / 8

  const hpLoss = Math.max(0, before.bismarckHp - after.bismarckHp)
  rg -= 0.08 * hpLoss
  rb += 0.12 * hpLoss

  if (!before.bismarckFound && after.bismarckFound) rb += 0.08
  if (!before.germanPositionPublic && after.germanPositionPublic) {
    rg -= 0.05
    rb += 0.08
  }
  if (!before.transportRevealedHex && after.transportRevealedHex) rg -= 0.05

  rb += 0.04 * (nearestBritishDist(env, before.bismarckPos) - nearestBritishDist(env, after.bismarckPos)) / 8
  rb -= 0.04 * Math.max(0, after.britishCrowding - before.britishCrowding)

  if (env.game.state.gameOver) {
    if (env.game.state.winner === 'german') {
      rg += 1
      rb -= 1
    } else if (env.game.state.winner === 'british') {
      rg -= 1
      rb += 1
    }
  }

  return { rewardGerman: rg, rewardBritish: rb }
}

function nextEnemyTargets(steps: RlTensorV3Step[]) {
  const sideAt = (s: RlTensorV3Step) => s.observation.activePlayer
  const targetAt = (a: GameAction) => {
    if (!a.params?.targetLabel) return -1
    const q = a.params.targetLabel.charCodeAt(0) - 65
    const r = parseInt(a.params.targetLabel.slice(1)) - 1
    return q >= 0 && q < 6 && r >= 0 && r < 8 ? r * 6 + q : -1
  }

  for (let i = 0; i < steps.length; i++) {
    let target = -1
    for (let j = i + 1; j < steps.length; j++) {
      if (sideAt(steps[j]) !== sideAt(steps[i])) {
        target = targetAt(steps[j].action)
        break
      }
    }
    steps[i].nextEnemyTargetPos = target
  }
}

function phaseTimeIndex(obs: GameObservation) {
  const phase = obs.phase
  if (phase === 'setup-german' || phase === 'setup-british') return 0
  const turn = Math.max(1, Math.min(18, obs.raw.turn))
  const base = 1 + (turn - 1) * 4
  if (phase === 'german-move') return base
  if (phase === 'british-move') return base + 1
  if (phase === 'british-search') return base + 2
  if (phase === 'combat' || phase === 'transport-attack') return base + 3
  return -1
}

const GERMAN_SLOT: Record<string, number> = {
  'bismarck': 0,
  'prinz-eugen': 1,
}

const BRITISH_SLOT: Record<string, number> = {
  'hood': 0,
  'prince-of-wales': 1,
  'ark-royal': 2,
  'king-george-v': 3,
  'rodney': 4,
  'renown': 5,
  'repulse': 6,
  'victorious': 7,
  'ramillies': 8,
  'norfolk': 9,
  'suffolk': 10,
  'dummy-1': 11,
  'dummy-2': 12,
  'dummy-3': 13,
  'dummy-4': 14,
}

function phaseSlotIndex(obs: GameObservation, action: GameAction) {
  const shipId = action.params?.shipId
  if (shipId && obs.activePlayer === 'german') return GERMAN_SLOT[shipId] ?? 15
  if (shipId && obs.activePlayer === 'british') return BRITISH_SLOT[shipId] ?? 15
  if (obs.phase === 'british-search' && action.type === 'air-search') return 2
  return 15
}

function choosePair(gameIndex: number, gerPop: Weights[], britPop: Weights[]): { german: PolicySpec; british: PolicySpec; bucket: string } {
  const r = Math.random()
  if (r < 0.35) {
    return {
      bucket: 'state_machine_vs_state_machine',
      german: { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) },
      british: { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) },
    }
  }
  if (r < 0.60) {
    const yanfuGerman = gameIndex % 2 === 0
    return {
      bucket: 'state_machine_vs_yanfu',
      german: yanfuGerman ? { kind: 'yanfu', label: 'yanfu' } : { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) },
      british: yanfuGerman ? { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) } : { kind: 'yanfu', label: 'yanfu' },
    }
  }
  if (r < 0.75) {
    const randomGerman = gameIndex % 2 === 0
    return {
      bucket: 'state_machine_vs_random',
      german: randomGerman ? { kind: 'random', label: 'random' } : { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) },
      british: randomGerman ? { kind: 'state_machine', label: 'v11_state_machine', germanWeights: pick(gerPop), britishWeights: pick(britPop) } : { kind: 'random', label: 'random' },
    }
  }
  if (r < 0.85) {
    return {
      bucket: 'default_weak_mix',
      german: { kind: 'state_machine', label: 'default', germanWeights: DEFAULT_WEIGHTS, britishWeights: DEFAULT_WEIGHTS },
      british: { kind: gameIndex % 2 ? 'random' : 'state_machine', label: gameIndex % 2 ? 'random' : 'default', germanWeights: DEFAULT_WEIGHTS, britishWeights: DEFAULT_WEIGHTS },
    }
  }
  if (r < 0.95) {
    return {
      bucket: 'mutated_state_machine',
      german: { kind: 'state_machine', label: 'mutated_state_machine', germanWeights: mutateWeights(pick(gerPop)), britishWeights: mutateWeights(pick(britPop)) },
      british: { kind: 'state_machine', label: 'mutated_state_machine', germanWeights: mutateWeights(pick(gerPop)), britishWeights: mutateWeights(pick(britPop)) },
    }
  }
  return {
    bucket: 'optional_high_quality_fallback',
    german: { kind: 'yanfu', label: 'yanfu' },
    british: { kind: 'state_machine', label: 'v11_state_machine', germanWeights: V11_GERMAN_BEST, britishWeights: V11_BRITISH_BEST },
  }
}

function runGame(gameIndex: number, outDir: string, seed: number, gerPop: Weights[], britPop: Weights[]) {
  const originalRandom = Math.random
  Math.random = rng(seed)
  try {
    const pair = choosePair(gameIndex, gerPop, britPop)
    const env = new BismarckEnv(seed)
    const germanPolicy = buildPolicy(pair.german)
    const britishPolicy = buildPolicy(pair.british)
    const steps: RlTensorV3Step[] = []
    const stepByTimeSlot = new Map<string, RlTensorV3Step>()
    let totalSteps = 0
    let stuck = 0
    let lastPhase = ''

    while (!env.game.state.gameOver && totalSteps < 500) {
      const obs = env.getObservation()
      ;(obs as any).raw = cloneGameState(env.game.state)
      if (obs.phase !== 'setup-british' && obs.actions.length === 0) break

      if (obs.phase === lastPhase) stuck++
      else { stuck = 0; lastPhase = obs.phase }

      if (obs.phase === 'setup-british') {
        setupBritish(env)
        totalSteps++
        continue
      }

      let action: GameAction | undefined
      if (stuck > 15) action = obs.actions.find(a => a.type === 'finish-phase')
      action ??= obs.activePlayer === 'german'
        ? selectAction(germanPolicy, pair.german, obs)
        : selectAction(britishPolicy, pair.british, obs)

      const before = snapshot(env)
      env.step(action)
      const after = snapshot(env)
      const rewards = computeReward(before, after, env)
      const timeIndex = phaseTimeIndex(obs)
      const slotIndex = phaseSlotIndex(obs, action)
      if (timeIndex >= 0 && timeIndex < RL_TENSOR_V3.T) {
        const key = `${timeIndex}:${slotIndex}`
        const existing = stepByTimeSlot.get(key)
        if (existing) {
          existing.rewardGerman += rewards.rewardGerman
          existing.rewardBritish += rewards.rewardBritish
        } else {
          const step = { timeIndex, slotIndex, observation: obs, action, nextEnemyTargetPos: -1, ...rewards }
          stepByTimeSlot.set(key, step)
          steps.push(step)
        }
      }
      totalSteps++
    }

    nextEnemyTargets(steps)

    const gameId = `game_${String(gameIndex).padStart(6, '0')}`
    const recordedPhases = new Set(steps.map(s => s.timeIndex)).size
    const result: RlTensorV3Result = {
      game_id: gameId,
      winner: env.game.state.winner,
      victory_reason: env.game.state.victoryReason,
      vp_german: env.game.state.vp.german,
      vp_british: env.game.state.vp.british,
      turns: env.game.state.turn,
      total_steps: totalSteps,
      recorded_steps: recordedPhases,
      action_records: steps.length,
      truncated: false,
      seed,
      policy_source_german: `${pair.bucket}:${pair.german.label}`,
      policy_source_british: `${pair.bucket}:${pair.british.label}`,
      tensor_schema: RL_TENSOR_V3.schema,
      state_shape: [RL_TENSOR_V3.T, RL_TENSOR_V3.C, RL_TENSOR_V3.H, RL_TENSOR_V3.W],
      mask_shape: [RL_TENSOR_V3.T, RL_TENSOR_V3.UNIT_SLOTS, RL_TENSOR_V3.ACTIONS],
      action_shape: [RL_TENSOR_V3.T, RL_TENSOR_V3.UNIT_SLOTS, 8],
      target_shape: [RL_TENSOR_V3.T, RL_TENSOR_V3.TARGET_FIELDS],
    }
    writeRlTensorV3Game(outDir, result, steps)
    return result
  } finally {
    Math.random = originalRandom
  }
}

async function main() {
  const games = Number(arg('--games', '100'))
  const outDir = path.resolve(arg('--out', DEFAULT_OUT))
  const seed0 = Number(arg('--seed', '1779700000'))
  const progressEverySec = Number(arg('--progress-every-sec', '10'))
  const dryRun = flag('--dry-run')
  fs.mkdirSync(outDir, { recursive: true })

  const gerPop = loadV11Pop('ger')
  const britPop = loadV11Pop('brit')
  const results: RlTensorV3Result[] = []
  console.log(`RL tensor v3 generation: games=${games}, out=${outDir}`)
  console.log(`Progress logging: every ${progressEverySec}s or ~1% of games, whichever comes first.`)

  const startedAt = Date.now()
  let lastProgressAt = startedAt
  const progressEveryGames = Math.max(1, Math.floor(games / 100))
  const logProgress = (done: number, force = false) => {
    const now = Date.now()
    if (!force && done % progressEveryGames !== 0 && now - lastProgressAt < progressEverySec * 1000) return
    lastProgressAt = now
    const elapsed = now - startedAt
    const rate = done > 0 ? done / (elapsed / 1000) : 0
    const remaining = rate > 0 ? (games - done) / rate * 1000 : Number.NaN
    const germanWins = results.filter(r => r.winner === 'german').length
    const britishWins = results.filter(r => r.winner === 'british').length
    const truncated = results.filter(r => r.truncated).length
    const pct = games > 0 ? (done / games * 100).toFixed(1) : '100.0'
    console.log(
      `[progress] ${done}/${games} (${pct}%) ` +
      `rate=${rate.toFixed(2)} games/s elapsed=${formatDuration(elapsed)} eta=${formatDuration(remaining)} ` +
      `wins G/B=${germanWins}/${britishWins} truncated=${truncated}`
    )
  }

  if (!dryRun) {
    for (let i = 0; i < games; i++) {
      const r = runGame(i, outDir, seed0 + i, gerPop, britPop)
      results.push(r)
      logProgress(i + 1, i + 1 === games)
    }
  }

  const summary = {
    tensor_schema: RL_TENSOR_V3.schema,
    generated_at: new Date().toISOString(),
    games_requested: games,
    games_written: results.length,
    winners: {
      german: results.filter(r => r.winner === 'german').length,
      british: results.filter(r => r.winner === 'british').length,
    },
    truncated: results.filter(r => r.truncated).length,
    avg_turns: results.length ? results.reduce((s, r) => s + r.turns, 0) / results.length : 0,
    avg_recorded_steps: results.length ? results.reduce((s, r) => s + r.recorded_steps, 0) / results.length : 0,
    action_records: results.reduce((s, r) => s + (r.action_records ?? 0), 0),
    avg_action_records: results.length ? results.reduce((s, r) => s + (r.action_records ?? 0), 0) / results.length : 0,
    unit_slots: RL_TENSOR_V3.UNIT_SLOTS,
    note: 'Stage 1 baseline data; fixed 73-step final-standard tensors; one setup slot plus four phase slots per turn, with 16 unit action slots inside each phase.',
  }
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`Saved summary: ${path.join(outDir, 'summary.json')}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
