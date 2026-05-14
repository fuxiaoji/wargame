import * as fs from 'fs'
import * as path from 'path'

export interface BattleResult {
  gameId: string
  winner: string | null
  germanVp: number
  britishVp: number
  turns: number
  reason: string
  timestamp: number
  germanModel: string
  britishModel: string
}

export interface BattleProgress {
  gameId: string
  turn: number
  phase: string
  germanVp: number
  britishVp: number
  stepCount: number
}

export interface ServerConfig {
  german: { baseUrl: string; apiKey: string; model: string }
  british: { baseUrl: string; apiKey: string; model: string }
  swapSides: boolean
  parallel: number
}

export interface ServerState {
  config: ServerConfig
  total: number
  completed: number
  results: BattleResult[]
  current: BattleProgress[]
  running: boolean
  paused: boolean
}

const DEFAULT_CONFIG: ServerConfig = {
  german: { baseUrl: 'http://localhost:8000/v1', apiKey: 'sk-local', model: 'qwen3' },
  british: { baseUrl: 'http://localhost:8000/v1', apiKey: 'sk-local', model: 'qwen3' },
  swapSides: false,
  parallel: 4,
}

const STATE_FILE = path.join(process.cwd(), 'battle-state.json')

export class StateManager {
  state: ServerState

  constructor() {
    this.state = this.load()
  }

  load(): ServerState {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf-8')
        const saved = JSON.parse(raw) as Partial<ServerState>
        return {
          config: { ...DEFAULT_CONFIG, ...saved.config },
          total: saved.total ?? 100,
          completed: saved.completed ?? 0,
          results: saved.results ?? [],
          current: saved.current ?? [],
          running: false,  // 启动时总是停止
          paused: false,
        }
      }
    } catch { /* 忽略损坏的存档 */ }
    return {
      config: { ...DEFAULT_CONFIG },
      total: 100, completed: 0, results: [], current: [],
      running: false, paused: false,
    }
  }

  save() {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2))
    } catch { /* 忽略 */ }
  }

  updateConfig(config: Partial<ServerConfig>) {
    this.state.config = { ...this.state.config, ...config }
    this.save()
  }

  reset(keepConfig = true) {
    const cfg = this.state.config
    this.state = this.load()
    if (keepConfig) this.state.config = cfg
    this.save()
  }

  addResult(r: BattleResult) {
    this.state.results.push(r)
    this.state.completed++
    this.save()
  }

  setProgress(p: BattleProgress) {
    const idx = this.state.current.findIndex(c => c.gameId === p.gameId)
    if (idx >= 0) this.state.current[idx] = p
    else this.state.current.push(p)
  }

  removeProgress(gameId: string) {
    this.state.current = this.state.current.filter(c => c.gameId !== gameId)
    this.save()
  }

  /** 统计 */
  stats() {
    const r = this.state.results
    if (r.length === 0) return { germanWins: 0, britishWins: 0, total: 0, avgGermanVp: 0, avgBritishVp: 0, avgTurns: 0 }
    const germanWins = r.filter(x => x.winner === 'german').length
    const britishWins = r.filter(x => x.winner === 'british').length
    return {
      germanWins, britishWins, total: r.length,
      avgGermanVp: r.reduce((s, x) => s + x.germanVp, 0) / r.length,
      avgBritishVp: r.reduce((s, x) => s + x.britishVp, 0) / r.length,
      avgTurns: r.reduce((s, x) => s + x.turns, 0) / r.length,
    }
  }
}
