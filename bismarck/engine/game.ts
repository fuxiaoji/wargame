import { GameState, ShipState } from './types'
import { createGameState, BRITISH_FIXED_POSITIONS } from './setup'
import { labelToHex, isLand, hexEquals, hexDistance, hexToLabel } from './map'
import { Randomizer, DefaultRandom, SeededRandom } from './random'
import {
  validateGermanMove,
  validateBritishMove,
} from './movement'
import {
  checkCoLocationSearch,
  performAirSearch,
  checkDummyIdentification,
  SearchResult,
} from './search'
import { resolveCombat } from './combat'
import { attackTransport, getTransportAttackers } from './transport'
import { checkVictory, checkEndTurnVictory } from './victory'
import { GameLog } from './log'

export { createGameState } from './setup'

export class BismarckGame {
  state: GameState
  rng: Randomizer
  log: GameLog

  constructor(seed?: number, log?: GameLog) {
    this.rng = seed !== undefined ? new SeededRandom(seed) : new DefaultRandom()
    this.log = log ?? new GameLog()
    this.state = createGameState(this.rng)
  }

  private L(type: import('./log').LogEntryType, msg: string, detail?: string) {
    this.log.setContext(this.state.turn, this.state.phase)
    this.log.L(type, msg, detail)
  }

  private endGame(victory: { winner: string | null; reason: string }) {
    this.state.gameOver = true
    this.state.winner = victory.winner as any
    this.state.victoryReason = victory.reason
    this.state.phase = 'game-over'
    this.L('victory', `游戏结束: ${victory.reason}`)
    this.log.endSession(victory.winner, victory.reason, { ...this.state.vp })
    this.log.save()
  }

  // ========== 初始化 ==========

  /** 设置德军起始格 (setup-german 阶段) */
  setGermanStart(label: string): { ok: boolean; error?: string } {
    if (this.state.phase !== 'setup-german') {
      return { ok: false, error: '当前不是德军初始布置阶段' }
    }
    const coord = labelToHex(label)
    if (!coord) return { ok: false, error: `无效格号: ${label}` }
    if (isLand(coord)) return { ok: false, error: `${label} 是陆地块` }

    // 所有德军舰船放在同一格
    for (const ship of this.state.germanShips) {
      this.state.germanPositions.set(ship.def.id, coord)
    }

    // 自动放置英军固定位置舰船
    for (const [hexLabel, shipIds] of Object.entries(BRITISH_FIXED_POSITIONS)) {
      const coord = labelToHex(hexLabel)
      if (!coord) continue
      for (const shipId of shipIds) {
        this.state.britishPositions.set(shipId, coord)
      }
    }

    this.state.phase = 'setup-british'
    this.log.setGermanStart(label)
    this.L('setup', `德军起始格设为 ${label}`)
    return { ok: true }
  }

  /** 放置一个英军算子 (setup-british 阶段) */
  placeBritishToken(
    shipId: string,
    label: string,
  ): { ok: boolean; error?: string } {
    if (this.state.phase !== 'setup-british') {
      return { ok: false, error: '当前不是英军布置阶段' }
    }
    const coord = labelToHex(label)
    if (!coord) return { ok: false, error: `无效格号: ${label}` }
    if (isLand(coord)) return { ok: false, error: `${label} 是陆地块` }

    const ship = this.state.britishShips.find(s => s.def.id === shipId)
    if (!ship) return { ok: false, error: `找不到算子: ${shipId}` }

    this.state.britishPositions.set(shipId, coord)
    // 所有英军算子初始背面朝上 (revealed = false)
    ship.revealed = false
    return { ok: true }
  }

  /** 英军布置完成，开始游戏 */
  finishSetup(): { ok: boolean; error?: string } {
    if (this.state.phase !== 'setup-british') {
      return { ok: false, error: '当前不是英军布置阶段' }
    }
    // 检查所有英军算子已放置
    const unplaced = this.state.britishShips.filter(
      s => !this.state.britishPositions.has(s.def.id)
    )
    if (unplaced.length > 0) {
      return { ok: false, error: `以下算子未放置: ${unplaced.map(s => s.def.name).join(', ')}` }
    }

    this.state.phase = 'german-move'
    this.L('setup', '英军布阵完成，游戏开始')
    return { ok: true }
  }

  // ========== 德军移动 ==========

  /** 移动德军舰船 (german-move 阶段) */
  germanMove(
    shipId: string,
    targetLabel: string,
  ): { ok: boolean; error?: string } {
    if (this.state.phase !== 'german-move') {
      return { ok: false, error: '当前不是德军移动阶段' }
    }

    const ship = this.state.germanShips.find(s => s.def.id === shipId)
    if (!ship) return { ok: false, error: `找不到德军舰船: ${shipId}` }
    if (ship.steps <= 0) return { ok: false, error: '舰船已沉没' }

    const targetCoord = labelToHex(targetLabel)
    if (!targetCoord) return { ok: false, error: `无效格号: ${targetLabel}` }

    const from = this.state.germanPositions.get(shipId)
    if (!from) return { ok: false, error: '舰船位置无效' }

    const validation = validateGermanMove(ship, from, targetCoord)
    if (!validation.valid) return { ok: false, error: validation.reason }

    // 保存旧位置以便悔棋
    ship._prevPos = from

    this.state.germanPositions.set(shipId, targetCoord)
    this.state.movedThisTurn.add(shipId)
    this.L('move', `德军 ${ship.def.name} → ${targetLabel}`)
    return { ok: true }
  }

  /** 悔棋: 撤销最近一次移动 */
  undoLastMove(shipId: string): { ok: boolean; error?: string } {
    const ship = [...this.state.germanShips, ...this.state.britishShips].find(s => s.def.id === shipId)
    if (!ship) return { ok: false, error: '找不到舰船' }
    if (!ship._prevPos) return { ok: false, error: '没有可撤销的移动' }

    const posMap = ship.def.side === 'german' ? this.state.germanPositions : this.state.britishPositions
    posMap.set(shipId, ship._prevPos)
    this.state.movedThisTurn.delete(shipId)
    this.L('move', `↩ 撤销 ${ship.def.name} 移动`)
    ship._prevPos = undefined
    return { ok: true }
  }

  /** 德军移动完成，进入英军移动阶段 */
  finishGermanMove(): { ok: boolean; error?: string } {
    if (this.state.phase !== 'german-move') {
      return { ok: false, error: '当前不是德军移动阶段' }
    }

    // 伪装鉴定失败 → 只有鉴定失败的那些伪装跟随俾斯麦 (规则 6.2)
    if (this.state.germanPositionPublic) {
      const bismarckPos = this.state.germanPositions.get('bismarck')
      if (bismarckPos && this.state.failedDummies.size > 0) {
        for (const bShip of this.state.britishShips) {
          if (this.state.failedDummies.has(bShip.def.id) && bShip.steps > 0) {
            this.state.britishPositions.set(bShip.def.id, bismarckPos)
          }
        }
      }
      this.state.germanPositionPublic = false
      this.state.failedDummies = new Set()
    }

    // 翻回所有英军算子 (5.0)
    for (const ship of this.state.britishShips) {
      ship.revealed = false
    }

    this.state.movedThisTurn = new Set()
    this.state.phase = 'british-move'
    return { ok: true }
  }

  // ========== 英军移动 ==========

  /** 移动英军舰船 (british-move 阶段) */
  britishMove(
    shipId: string,
    targetLabel: string,
  ): { ok: boolean; error?: string } {
    if (this.state.phase !== 'british-move') {
      return { ok: false, error: '当前不是英军移动阶段' }
    }

    const ship = this.state.britishShips.find(s => s.def.id === shipId)
    if (!ship) return { ok: false, error: `找不到英军舰船: ${shipId}` }
    if (ship.steps <= 0) return { ok: false, error: '舰船已沉没' }

    const targetCoord = labelToHex(targetLabel)
    if (!targetCoord) return { ok: false, error: `无效格号: ${targetLabel}` }

    const from = this.state.britishPositions.get(shipId)
    if (!from) return { ok: false, error: '舰船位置无效' }

    const validation = validateBritishMove(this.state, ship, from, targetCoord)
    if (!validation.valid) return { ok: false, error: validation.reason }

    ship._prevPos = from
    this.state.britishPositions.set(shipId, targetCoord)
    this.state.movedThisTurn.add(shipId)
    this.L('move', `英军 ${ship.def.name} → ${targetLabel}`)
    return { ok: true }
  }

  /** 英军移动完成，进入索敌阶段 */
  finishBritishMove(): { ok: boolean; error?: string } {
    if (this.state.phase !== 'british-move') {
      return { ok: false, error: '当前不是英军移动阶段' }
    }
    // 注意：bismarckFound 一旦为 true 就不再清除——规则 5.1，发现后所有英军永久解锁
    this.state.combatPending = false
    this.state.transportRevealedHex = null  // 标记已在英军移动阶段展示过，清除
    this.state.phase = 'british-search'
    return { ok: true }
  }

  // ========== 索敌 ==========

  /** 执行同格索敌 */
  doSearch(): SearchResult {
    const result = checkCoLocationSearch(this.state)
    if (result.type === 'co-locate') {
      this.state.bismarckFound = true
      this.L('search', `同格索敌: 发现德军在 ${result.germanLabel}!`)

      // 6.2 伪装算子鉴定: 先处理所有被翻开的伪装算子
      for (const bShip of result.revealedBritish ?? []) {
        if (bShip.def.isDummy) {
          const idResult = checkDummyIdentification(this.state, bShip, this.rng)
          if (idResult.removed) {
            bShip.steps = 0
            this.state.britishPositions.delete(bShip.def.id)
            this.L('search', `伪装鉴定: ${bShip.def.name} 鉴定成功，移除`)
          } else {
            this.state.germanPositionPublic = true
            this.state.failedDummies.add(bShip.def.id)
            this.L('search', `伪装鉴定: ${bShip.def.name} 鉴定失败，德军下回合位置公开`)
          }
        }
      }

      // 只有同格存在非伪装、未沉没的英军真船时才进入战斗
      const hasRealCombat = result.revealedBritish.some(
        s => !s.def.isDummy && s.steps > 0
      )
      if (hasRealCombat) {
        this.state.combatPending = true
      }
    } else {
      this.L('search', '同格索敌: 未发现德军')
    }
    return result
  }

  /** 执行航空索敌 */
  doAirSearch(adjacentLabel: string): ReturnType<typeof performAirSearch> {
    if (this.state.phase !== 'british-search') {
      return { type: 'none' as const, foundShips: [], revealedBritish: [] }
    }
    const result = performAirSearch(this.state, adjacentLabel)
    if (result.foundShips.length > 0) {
      this.state.bismarckFound = true
      this.state.combatPending = true
      this.L('search', `航空索敌: 发现德军在 ${adjacentLabel}!`)
    } else {
      this.L('search', `航空索敌 (${adjacentLabel}): 未发现`)
    }
    return result
  }

  /** 索敌完成 */
  finishSearch(): { ok: boolean; error?: string } {
    if (this.state.phase !== 'british-search') {
      return { ok: false, error: '当前不是索敌阶段' }
    }

    if (this.state.combatPending) {
      this.state.phase = 'combat'
    } else {
      // 检查是否可以攻击运输舰队
      const attackers = getTransportAttackers(this.state)
      if (attackers.length > 0) {
        this.state.transportPending = true
        this.state.phase = 'transport-attack'
      } else {
        this.endTurn()
      }
    }
    return { ok: true }
  }

  // ========== 战斗 ==========

  /** 结算战斗 */
  doCombat(): ReturnType<typeof resolveCombat> {
    if (this.state.phase !== 'combat') {
      return { rounds: [], germanVpGained: 0, britishVpGained: 0, shipsSunk: [], log: ['当前不是战斗阶段'] }
    }

    // 收集所有交火格 (德舰与英舰同格的每个位置)
    const combatCoords = new Set<string>()
    for (const bShip of this.state.britishShips) {
      if (bShip.steps <= 0 || bShip.def.isDummy) continue
      const bPos = this.state.britishPositions.get(bShip.def.id)
      if (!bPos) continue
      for (const gShip of this.state.germanShips) {
        if (gShip.steps <= 0) continue
        const gPos = this.state.germanPositions.get(gShip.def.id)
        if (gPos && hexEquals(gPos, bPos)) combatCoords.add(`${gPos.q},${gPos.r}`)
      }
    }

    // Ark Royal 航空攻击相邻格德军
    let airTarget: ShipState | undefined; let airCoord: string | undefined
    const arkRoyal = this.state.britishShips.find(s => s.def.id === 'ark-royal' && s.steps > 0)
    if (arkRoyal) {
      const arPos = this.state.britishPositions.get('ark-royal')
      if (arPos) {
        for (const gShip of this.state.germanShips) {
          if (gShip.steps <= 0) continue
          const gPos = this.state.germanPositions.get(gShip.def.id)
          if (gPos && hexDistance(arPos, gPos) === 1) {
            airTarget = gShip; airCoord = `${gPos.q},${gPos.r}`; break
          }
        }
      }
    }
    if (airCoord) combatCoords.add(airCoord)

    if (combatCoords.size === 0) {
      return { rounds: [], germanVpGained: 0, britishVpGained: 0, shipsSunk: [], log: ['没有发现战斗格'] }
    }

    // 每个交火格依次结算
    const merged: ReturnType<typeof resolveCombat> = { rounds: [], germanVpGained: 0, britishVpGained: 0, shipsSunk: [], log: [] }
    for (const key of combatCoords) {
      const [q, r] = key.split(',').map(Number)
      const coord = { q, r }
      const isAir = airCoord === key && !!airTarget
      const r2 = resolveCombat(this.state, coord, this.rng, isAir, isAir ? airTarget : undefined)
      merged.rounds.push(...r2.rounds); merged.germanVpGained += r2.germanVpGained; merged.britishVpGained += r2.britishVpGained
      merged.shipsSunk.push(...r2.shipsSunk); merged.log.push(...r2.log)
      this.state.vp.german += r2.germanVpGained; this.state.vp.british += r2.britishVpGained
      this.L('combat', `战斗(${hexToLabel(coord)}): 德+${r2.germanVpGained}VP 英+${r2.britishVpGained}VP`, r2.log.join('; '))
      if (r2.shipsSunk.length > 0) this.L('combat', `击沉: ${r2.shipsSunk.join(', ')}`)
    }

    const victory = checkVictory(this.state)
    if (victory.gameOver) { this.endGame(victory) } else { this.endTurn() }
    return merged
  }

  // ========== 运输舰队攻击 ==========

  /** 攻击运输舰队 */
  doTransportAttack(shipId: string): ReturnType<typeof attackTransport> {
    const ship = this.state.germanShips.find(s => s.def.id === shipId)
    if (!ship) {
      return { positionRevealed: false, vpGained: 0, description: '舰船不存在' }
    }
    const result = attackTransport(this.state, ship, this.rng)
    this.L('transport', result.description)
    // 信号泄露：记录暴露位置 + 激活所有英军战舰
    if (result.positionRevealed) {
      const pos = this.state.germanPositions.get(shipId)
      if (pos) this.state.transportRevealedHex = hexToLabel(pos)
      this.state.bismarckFound = true  // 英军获知德军位置，所有战舰解锁
    }

    // 攻击后进入回合结束
    this.state.transportPending = false
    this.endTurn()

    return result
  }

  /** 跳过运输舰队攻击 */
  skipTransportAttack(): void {
    this.state.transportPending = false
    this.endTurn()
  }

  // ========== 回合流转 ==========

  private endTurn(): void {
    this.state.phaseStep = 0

    const victory = checkEndTurnVictory(this.state)
    if (victory.gameOver) {
      this.endGame(victory)
      return
    }

    // 前进到下一回合
    this.L('turn', `第 ${this.state.turn} 回合结束, VP 德${this.state.vp.german}/英${this.state.vp.british}`)
    this.state.turn++
    this.state.combatPending = false
    this.state.transportPending = false
    // transportRevealedHex 不清除——保留到英军移动阶段让玩家看到
    this.state.phase = 'german-move'
  }

  /** 获取当前阶段的玩家视角 ("german" | "british") */
  getActivePlayer(): 'german' | 'british' {
    switch (this.state.phase) {
      case 'setup-german':
      case 'german-move':
      case 'transport-attack':
        return 'german'
      default:
        return 'british'
    }
  }
}
