export type LogEntryType = 'setup' | 'move' | 'search' | 'combat' | 'transport' | 'turn' | 'victory' | 'llm'

export interface LogEntry {
  turn: number
  phase: string
  type: LogEntryType
  message: string
  detail?: string
  timestamp: number
}

export interface GameSession {
  id: string
  startTime: number
  endTime?: number
  entries: LogEntry[]
  winner?: string
  victoryReason?: string
  finalVp?: { german: number; british: number }
  germanStart?: string
}

const STORAGE_KEY = 'bismarck_sessions'

export class GameLog {
  private session: GameSession
  private turn = 0
  private phase = ''

  constructor(sessionId?: string) {
    this.session = {
      id: sessionId ?? `game-${Date.now()}`,
      startTime: Date.now(),
      entries: [],
    }
  }

  get sessionId() { return this.session.id }
  get entries() { return this.session.entries }

  setContext(turn: number, phase: string) {
    this.turn = turn
    this.phase = phase
  }

  L(type: LogEntryType, message: string, detail?: string) {
    this.session.entries.push({
      turn: this.turn,
      phase: this.phase,
      type,
      message,
      timestamp: Date.now(),
      detail,
    })
    this.autoSave()
  }

  setGermanStart(label: string) {
    this.session.germanStart = label
  }

  endSession(winner: string | null, reason: string, vp: { german: number; british: number }) {
    this.session.endTime = Date.now()
    this.session.winner = winner ?? undefined
    this.session.victoryReason = reason
    this.session.finalVp = { ...vp }
    this.save()
  }

  /** 保存到 localStorage */
  save() {
    try {
      const sessions = GameLog.loadAllSessions()
      const idx = sessions.findIndex(s => s.id === this.session.id)
      if (idx >= 0) sessions[idx] = { ...this.session }
      else sessions.push({ ...this.session })
      // 只保留最近 50 局
      if (sessions.length > 50) sessions.splice(0, sessions.length - 50)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
    } catch { /* 忽略存储错误 */ }
  }

  private autoSave() {
    // 每 5 条自动存一次，避免频繁写入
    if (this.session.entries.length % 5 === 0) this.save()
  }

  /** 导出当前局为 JSON 文件 */
  exportSession(): string {
    return JSON.stringify(this.session, null, 2)
  }

  /** 导出为 CSV 文本 */
  exportCsv(): string {
    const header = '回合,阶段,类型,消息,详情,时间'
    const rows = this.session.entries.map(e =>
      `${e.turn},${e.phase},${e.type},"${e.message}","${e.detail ?? ''}",${new Date(e.timestamp).toISOString()}`
    )
    return [header, ...rows].join('\n')
  }

  // ---- 静态方法 ----

  static loadAllSessions(): GameSession[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  static getSession(id: string): GameSession | null {
    return GameLog.loadAllSessions().find(s => s.id === id) ?? null
  }

  static deleteSession(id: string) {
    const sessions = GameLog.loadAllSessions().filter(s => s.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
  }

  static clearAll() {
    localStorage.removeItem(STORAGE_KEY)
  }
}
