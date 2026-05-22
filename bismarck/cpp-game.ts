/** C++ 引擎的 TS 适配包装 — 与 BismarckGame 接口一致 */
import { send } from './cpp-bridge'
type ShipSide = 'german' | 'british'

// 注意：这个适配器运行在 Node 端（useGame 内部），不依赖浏览器 API

function toPhase(rawPhase: number) {
  // C++ enum Phase: setup_german=0, setup_british=1, german_move=2, british_move=3,
  //                 british_search=4, combat=5, transport_attack=6, game_over=7
  const map: Record<number, string> = {
    0: 'setup-german', 1: 'setup-british', 2: 'german-move', 3: 'british-move',
    4: 'british-search', 5: 'combat', 6: 'transport-attack', 7: 'game-over'
  }
  return map[rawPhase] ?? 'game-over'
}

function toShip(s: any): any {
  return {
    def: { id: s.id, name: s.name, side: s.id.includes('dummy') ? 'british' : (['bismarck','prinz-eugen'].includes(s.id) ? 'german' : 'british'), attack: s.attack, defense: s.defense, maxSteps: s.maxSteps, speed: 3, isCarrier: false, isDummy: s.isDummy ?? false },
    steps: s.steps,
    revealed: s.revealed ?? false,
    moveTarget: null,
    _prevPos: undefined,
  }
}

function parseState(raw: any): any {
  if (!raw) return null
  const phase = toPhase(raw.phase)

  const germanPositions = new Map<string, any>()
  if (raw.germanPositions) {
    for (const [id, label] of Object.entries(raw.germanPositions) as [string, string][]) {
      germanPositions.set(id, parseLabel(label))
    }
  }
  const britishPositions = new Map<string, any>()
  if (raw.britishPositions) {
    for (const [id, label] of Object.entries(raw.britishPositions) as [string, string][]) {
      britishPositions.set(id, parseLabel(label))
    }
  }

  const germanShips = (raw.ships?.german ?? []).map((s: any) => toShip(s))
  const britishShips = (raw.ships?.british ?? []).map((s: any) => toShip(s))

  const winner = raw.winner === 'german' ? 'german' as ShipSide : raw.winner === 'british' ? 'british' as ShipSide : null

  return {
    germanShips, britishShips,
    germanPositions, britishPositions,
    turn: raw.turn,
    phase,
    phaseStep: 0,
    vp: { german: raw.vpGerman ?? 0, british: raw.vpBritish ?? 0 },
    bismarckFound: raw.bismarckFound ?? false,
    combatPending: raw.combatPending ?? false,
    transportPending: raw.transportPending ?? false,
    germanPositionPublic: false,
    movedThisTurn: new Set<string>(),
    gameOver: raw.gameOver ?? false,
    winner,
    victoryReason: raw.victoryReason ?? '',
  }
}

function parseLabel(label: string): { q: number; r: number } | null {
  // A3 → {q:0, r:3}
  const colMap: Record<string, number> = { A:0, B:1, C:2, D:3, E:4, F:5 }
  if (!label || label.length < 2) return null
  const col = colMap[label[0].toUpperCase()]
  const row = parseInt(label.slice(1))
  if (col === undefined || isNaN(row)) return null
  return { q: col, r: row }
}

export class CppGame {
  state: any = null
  private _updateTimer: any = null

  constructor() {
    this._pollState()
  }

  private async _pollState() {
    try {
      const raw = await send('state')
      this.state = parseState(raw)
    } catch { /* 首次连接可能失败，稍后重试 */ }
  }

  async refresh() {
    const raw = await send('state')
    this.state = parseState(raw)
  }

  async setGermanStart(label: string): Promise<{ ok: boolean; error?: string }> {
    const r = await send('setGermanStart', label)
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async placeBritishToken(shipId: string, label: string): Promise<{ ok: boolean; error?: string }> {
    const r = await send('placeBritishToken', shipId, label)
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async finishSetup(): Promise<{ ok: boolean; error?: string }> {
    const r = await send('finishSetup')
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async germanMove(shipId: string, targetLabel: string): Promise<{ ok: boolean; error?: string }> {
    const r = await send('germanMove', shipId, targetLabel)
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async finishGermanMove(): Promise<{ ok: boolean; error?: string }> {
    const r = await send('finishGermanMove')
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async britishMove(shipId: string, targetLabel: string): Promise<{ ok: boolean; error?: string }> {
    const r = await send('britishMove', shipId, targetLabel)
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async finishBritishMove(): Promise<{ ok: boolean; error?: string }> {
    const r = await send('finishBritishMove')
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async doSearch(): Promise<any> {
    const r = await send('doSearch')
    this.state = parseState(r.state)
    return r
  }

  async doAirSearch(adjacentLabel: string): Promise<any> {
    const r = await send('doAirSearch', adjacentLabel)
    this.state = parseState(r.state)
    return r
  }

  async finishSearch(): Promise<{ ok: boolean; error?: string }> {
    const r = await send('finishSearch')
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async doCombat(): Promise<any> {
    const r = await send('doCombat')
    this.state = parseState(r.state)
    return r
  }

  async doTransportAttack(shipId: string): Promise<any> {
    const r = await send('doTransportAttack', shipId)
    this.state = parseState(r.state)
    return r
  }

  async skipTransportAttack(): Promise<void> {
    const r = await send('skipTransportAttack')
    this.state = parseState(r.state)
  }

  async undoLastMove(shipId: string): Promise<{ ok: boolean; error?: string }> {
    const r = await send('undoLastMove', shipId)
    this.state = parseState(r.state)
    return { ok: r.ok, error: r.error || undefined }
  }

  async getReachableLabels(shipId: string): Promise<string[]> {
    const r = await send('getReachable', shipId)
    return r.labels ?? []
  }

  async getAirSearchTargets(): Promise<string[]> {
    const r = await send('getAirSearchTargets')
    return r.labels ?? []
  }

  async getTransportAttackers(): Promise<string[]> {
    const r = await send('getTransportAttackers')
    return r.ids ?? []
  }

  async newGame(): Promise<void> {
    const r = await send('newGame')
    this.state = parseState(r.state)
  }

  getActivePlayer(): any {
    if (!this.state) return 'british'
    const p = this.state.phase
    if (p === 'setup-german' || p === 'german-move' || p === 'transport-attack') return 'german'
    return 'british'
  }
}
