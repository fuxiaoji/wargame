import { BismarckGame } from './game'
import { GameLog } from './log'
import { GameState, ShipState } from './types'
import { hexToLabel } from './map'
import { getGermanReachableLabels, getBritishReachableLabels, getShipSpeed } from './movement'
import { getAirSearchTargets } from './search'
import { getTransportAttackers } from './transport'
import { canMoveBeforeDetection } from './units'
import { GERMAN_START_HEXES } from './map'
import { getBritishSetupLabels } from './setup'

// ========== 动作类型 ==========

export type ActionType = 'move' | 'finish-phase' | 'air-search' | 'combat' | 'transport'

export interface GameAction {
  id: number
  type: ActionType
  label: string
  /** 用于程序执行的参数 */
  params?: { shipId?: string; targetLabel?: string }
}

// ========== 游戏观察 (文本化) ==========

export interface GameObservation {
  /** 文本描述，可直接发给LLM */
  text: string
  /** 当前玩家 */
  activePlayer: 'german' | 'british'
  /** 当前阶段 */
  phase: string
  /** 可用动作列表 */
  actions: GameAction[]
  /** 是否终局 */
  gameOver: boolean
  /** 胜者 */
  winner: string | null
  /** 原始状态 */
  raw: GameState
}

// ========== 环境包装器 ==========

export class BismarckEnv {
  game: BismarckGame
  log: GameLog

  constructor(seed?: number) {
    this.log = new GameLog()
    this.game = new BismarckGame(seed, this.log)
  }

  /** 获取当前观察 */
  getObservation(): GameObservation {
    const s = this.game.state
    const player = this.game.getActivePlayer()
    const lines: string[] = []

    // 阶段上下文
    lines.push(`=== 第${s.turn}/18回合 | ${phaseName(s.phase)} ===`)
    lines.push(`德军VP:${s.vp.german}(需6) 英军VP:${s.vp.british}`)
    if (s.germanPositionPublic) lines.push('⚠ 德军位置本回合公开!（伪装鉴定失败）')
    if (s.transportRevealedHex) lines.push(`📡 信号泄露: 上回合德军曾在 ${s.transportRevealedHex}`)
    lines.push('')

    // 阶段提示
    const phaseHints: Record<string, string> = {
      'setup-german': '你需要选择德军舰队的起始格(A5/A6/B7)。所有德军舰船从同一格出发。',
      'setup-british': `一次性指定所有未放置算子的位置。用标准格式: (舰名,格号)(舰名,格号)... 如(胡德,E7)(诺福克,D1)。可选格: ${getBritishSetupLabels().join('/')}`,
      'german-move': '请选择德军舰船并移动到目标格。你的位置对英军隐藏。移动完成后需确认。',
      'british-move': '请选择英军舰船移动。发现俾斯麦前仅胡德/威尔士亲王/伪装可移动。',
      'british-search': '先执行同格索敌。如未发现且皇家方舟号可用，可航空索敌相邻格。',
      'combat': '双方在同一格，必须结算战斗。航空攻击优先，然后按攻击力降序。',
      'transport-attack': '德军舰船在航路上且未战斗，可攻击商船获取VP(有风险泄露位置)。',
    }
    if (phaseHints[s.phase]) lines.push(`📋 ${phaseHints[s.phase]}`)
    lines.push('')

    // 当前地图态势
    const occupiedHexes = new Map<string, string[]>()
    const addHex = (label: string, name: string) => {
      if (!occupiedHexes.has(label)) occupiedHexes.set(label, [])
      occupiedHexes.get(label)!.push(name)
    }
    for (const ship of s.britishShips) {
      if (ship.steps <= 0) continue
      const pos = s.britishPositions.get(ship.def.id)
      if (pos) addHex(hexToLabel(pos) ?? '?', ship.def.name)
    }
    if (player === 'german' || s.germanPositionPublic) {
      for (const ship of s.germanShips) {
        if (ship.steps <= 0) continue
        const pos = s.germanPositions.get(ship.def.id)
        if (pos) addHex(hexToLabel(pos) ?? '?', ship.def.name)
      }
    }
    if (occupiedHexes.size > 0) {
      lines.push('当前态势:')
      for (const [label, names] of occupiedHexes) {
        lines.push(`  ${label}: ${names.join(', ')}`)
      }
      lines.push('')
    }

    // 舰队状态
    if (player === 'german') {
      lines.push('== 德军舰队 (你) ==')
      for (const ship of s.germanShips) {
        if (ship.steps <= 0) continue
        const pos = s.germanPositions.get(ship.def.id)
        const label = pos ? hexToLabel(pos) : '?'
        lines.push(shipLine(ship, label ?? '??'))
      }
      lines.push('')
      lines.push('== 英军舰队 (公开可见) ==')
      for (const ship of s.britishShips) {
        if (ship.steps <= 0) continue
        const pos = s.britishPositions.get(ship.def.id)
        const label = pos ? hexToLabel(pos) : '?'
        if (ship.revealed) {
          lines.push(shipLine(ship, label ?? '??'))
        } else {
          lines.push(`  背面算子 [${label}]`)  // 德军看不到身份
        }
      }
    } else {
      lines.push('== 英军舰队 (你) ==')
      for (const ship of s.britishShips) {
        if (ship.steps <= 0) continue
        const pos = s.britishPositions.get(ship.def.id)
        const label = pos ? hexToLabel(pos) : '?'
        lines.push(shipLine(ship, label ?? '??'))
      }
      lines.push('')
      // bismarckFound 只用于解锁英军移动，不暴露当前位置
      // 当前位置仅在 germanPositionPublic(伪装鉴定失败)时公开
      if (s.germanPositionPublic) {
        lines.push('== 德军舰队 (公开) ==')
        for (const ship of s.germanShips) {
          if (ship.steps <= 0) continue
          const pos = s.germanPositions.get(ship.def.id)
          const label = pos ? hexToLabel(pos) : '?'
          lines.push(shipLine(ship, label ?? '??'))
        }
      } else {
        lines.push('== 德军舰队 ==')
        lines.push('  位置未知。需通过索敌发现。')
        if (s.bismarckFound) lines.push('  注意: 英军已发现过俾斯麦，所有战舰解锁可移动。')
        lines.push('  德军起始格: A5/A6/B7 之一')
      }
    }
    lines.push('')

    // setup-british 特殊格式：末尾显示坐标指令，不显示编号列表
    if (s.phase === 'setup-british') {
      const unplaced = s.britishShips.filter(sh => !s.britishPositions.has(sh.def.id))
      if (unplaced.length > 0) {
        const labels = getBritishSetupLabels()
        lines.push('')
        lines.push(`📝 需放置 ${unplaced.length} 个算子: ${unplaced.map(s=>s.def.name).join(', ')}`)
        lines.push(`   可选格号: ${labels.join(', ')}`)
        lines.push(`--- 请直接回复坐标 (不要编号) ---`)
        lines.push(`   ⚠️ 必须使用上面的精确算子名称！伪装算子只能叫"伪装算子1/2/3/4"`)
        lines.push(`   格式: (舰名,格号)(舰名,格号)...`)
        lines.push(`   例如: (胡德号,E7)(诺福克号,D1)(伪装算子1,E3)(伪装算子2,F2)`)
        return {
          text: lines.join('\n'),
          activePlayer: player,
          phase: s.phase,
          actions: this.getActions(),
          gameOver: s.gameOver,
          winner: s.winner,
          raw: s,
        }
      }
    }

    // 可用动作
    const actions = this.getActions()
    lines.push('--- 请选择操作 (回复数字编号) ---')
    for (const a of actions) {
      lines.push(`[${a.id}] ${a.label}`)
    }

    return {
      text: lines.join('\n'),
      activePlayer: player,
      phase: s.phase,
      actions,
      gameOver: s.gameOver,
      winner: s.winner,
      raw: s,
    }
  }

  /** 获取当前可用动作 */
  getActions(): GameAction[] {
    const s = this.game.state
    const actions: GameAction[] = []
    let nextId = 1

    if (s.phase === 'setup-german') {
      for (const label of GERMAN_START_HEXES) {
        actions.push({ id: nextId++, type: 'move', label: `选择起始格: ${label}`, params: { targetLabel: label } })
      }
    }

    if (s.phase === 'setup-british') {
      const unplaced = s.britishShips.filter(sh => !s.britishPositions.has(sh.def.id))
      if (unplaced.length > 0) {
        // 不生成编号动作——LLM 应直接回复坐标格式
        // 观察文本末尾会提示格式
      } else {
        actions.push({ id: nextId++, type: 'finish-phase', label: '布阵完成，开始游戏' })
      }
    }

    if (s.phase === 'german-move') {
      // 逐艘轮询：找出下一艘未动的德军船
      let allMoved = true
      for (const ship of s.germanShips) {
        if (ship.steps <= 0) continue
        if (s.movedThisTurn.has(ship.def.id)) continue
        allMoved = false
        const pos = s.germanPositions.get(ship.def.id)
        if (!pos) continue
        const curLabel = hexToLabel(pos) ?? ''
        const reachable = getGermanReachableLabels(ship, pos)
        // 不动选项
        actions.push({
          id: nextId++, type: 'move',
          label: `${ship.def.name} → 不动(${curLabel})`,
          params: { shipId: ship.def.id, targetLabel: curLabel }
        })
        for (const target of reachable) {
          if (target === curLabel) continue
          actions.push({
            id: nextId++, type: 'move',
            label: `${ship.def.name} → ${target}`,
            params: { shipId: ship.def.id, targetLabel: target }
          })
        }
        break // 只显示当前这艘船
      }
      if (allMoved) actions.push({ id: nextId++, type: 'finish-phase', label: '德军移动完成' })
    }

    if (s.phase === 'british-move') {
      // 逐艘轮询：找出下一艘可动且未动的英军船
      let allMoved = true
      for (const ship of s.britishShips) {
        if (ship.steps <= 0) continue
        if (s.movedThisTurn.has(ship.def.id)) continue
        if (!s.bismarckFound && !canMoveBeforeDetection(ship.def)) continue
        allMoved = false
        const pos = s.britishPositions.get(ship.def.id)
        if (!pos) continue
        const curLabel = hexToLabel(pos) ?? ''
        const reachable = getBritishReachableLabels(s, ship, pos)
        actions.push({
          id: nextId++, type: 'move',
          label: `${ship.def.name} → 不动(${curLabel})`,
          params: { shipId: ship.def.id, targetLabel: curLabel }
        })
        for (const target of reachable) {
          if (target === curLabel) continue
          actions.push({
            id: nextId++, type: 'move',
            label: `${ship.def.name} → ${target}`,
            params: { shipId: ship.def.id, targetLabel: target }
          })
        }
        break
      }
      if (allMoved) actions.push({ id: nextId++, type: 'finish-phase', label: '英军移动完成' })
    }

    if (s.phase === 'british-search') {
      // 航空索敌优先执行（在同格索敌之前）
      const arkRoyal = s.britishShips.find(sh => sh.def.id === 'ark-royal' && sh.steps > 0)
      if (arkRoyal) {
        const pos = s.britishPositions.get('ark-royal')
        if (pos) {
          for (const label of getAirSearchTargets(s, pos)) {
            actions.push({ id: nextId++, type: 'air-search', label: `航空索敌: ${label}`, params: { targetLabel: label } })
          }
        }
      }
      actions.push({ id: nextId++, type: 'finish-phase', label: '执行同格索敌' })
      if (!s.combatPending) {
        actions.push({ id: nextId++, type: 'finish-phase', label: '索敌完成' })
      }
    }

    if (s.phase === 'combat' && !s.gameOver) {
      actions.push({ id: nextId++, type: 'combat', label: '结算战斗' })
    }

    if (s.phase === 'transport-attack') {
      const attackers = getTransportAttackers(s)
      for (const ship of attackers) {
        actions.push({ id: nextId++, type: 'transport', label: `${ship.def.name} 攻击运输舰队`, params: { shipId: ship.def.id } })
      }
      actions.push({ id: nextId++, type: 'finish-phase', label: '跳过运输攻击' })
    }

    return actions
  }

  /** 执行动作 */
  step(action: GameAction): { ok: boolean; error?: string; observation: GameObservation } {
    const { type, params } = action

    switch (type) {
      case 'move': {
        // setup-german 只需要 targetLabel
        if (this.game.state.phase === 'setup-german' && params?.targetLabel) {
          const r = this.game.setGermanStart(params.targetLabel)
          if (!r.ok) return { ok: false, error: r.error, observation: this.getObservation() }
        } else if (this.game.state.phase === 'setup-british' && params?.shipId && params?.targetLabel) {
          const r = this.game.placeBritishToken(params.shipId, params.targetLabel)
          if (!r.ok) return { ok: false, error: r.error, observation: this.getObservation() }
        } else if (params?.shipId && params?.targetLabel) {
          if (this.game.state.phase === 'german-move') {
            const r = this.game.germanMove(params.shipId, params.targetLabel)
            if (!r.ok) return { ok: false, error: r.error, observation: this.getObservation() }
          } else if (this.game.state.phase === 'british-move') {
            const r = this.game.britishMove(params.shipId, params.targetLabel)
            if (!r.ok) return { ok: false, error: r.error, observation: this.getObservation() }
          }
        }
        break
      }
      case 'finish-phase': {
        if (this.game.state.phase === 'german-move') this.game.finishGermanMove()
        else if (this.game.state.phase === 'british-move') this.game.finishBritishMove()
        else if (this.game.state.phase === 'british-search') {
          this.game.doSearch()   // 始终执行同格索敌（处理伪装鉴定）
          this.game.finishSearch()
        } else if (this.game.state.phase === 'setup-british') {
          this.game.finishSetup()
        } else if (this.game.state.phase === 'transport-attack') this.game.skipTransportAttack()
        break
      }
      case 'air-search': {
        if (params?.targetLabel) this.game.doAirSearch(params.targetLabel)
        break
      }
      case 'combat': {
        this.game.doCombat()
        break
      }
      case 'transport': {
        if (params?.shipId) this.game.doTransportAttack(params.shipId)
        break
      }
    }

    return { ok: true, observation: this.getObservation() }
  }

  /** AI模式: 自动将未放置英军算子随机放到合法格 */
  autoPlaceBritish() {
    const s = this.game.state
    const unplaced = s.britishShips.filter(sh => !s.britishPositions.has(sh.def.id))
    if (unplaced.length === 0) return

    const availableLabels = getBritishSetupLabels()

    for (const ship of unplaced) {
      const label = availableLabels[Math.floor(Math.random() * availableLabels.length)]
      this.game.placeBritishToken(ship.def.id, label)
    }
  }

  /** 重开一局 */
  reset() {
    this.log = new GameLog()
    this.game = new BismarckGame(undefined, this.log)
  }
}

// ========== 辅助 ==========

function phaseName(p: string): string {
  const m: Record<string, string> = {
    'setup-german': '德军布置', 'setup-british': '英军布置',
    'german-move': '德军移动', 'british-move': '英军移动',
    'british-search': '英军索敌', 'combat': '战斗', 'transport-attack': '攻击运输',
    'game-over': '结束'
  }
  return m[p] ?? p
}

function shipLine(ship: ShipState, label: string): string {
  const s = ship.def
  if (s.isDummy) return `  伪装算子 [${label}]`
  const spd = getShipSpeed(ship)
  return `  ${s.name} [Step:${ship.steps}/${s.maxSteps} 攻:${s.attack} 防:${s.defense} 速:${spd}] ${label}`
}
