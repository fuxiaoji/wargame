import { GameState, ShipState } from './types'
import { hexEquals } from './map'
import { Randomizer } from './random'

export interface CombatRound {
  attacker: string       // ship name
  target: string         // ship name
  attackDice: number     // 投骰数
  defenseTarget: number  // 目标值
  rolls: number[]        // 每次骰点
  hits: number           // 成功命中数
}

export interface CombatResult {
  rounds: CombatRound[]
  germanVpGained: number
  britishVpGained: number
  shipsSunk: string[]
  log: string[]
}

/** 结算单次攻击 */
function resolveAttack(
  attacker: ShipState,
  target: ShipState,
  rng: Randomizer,
): CombatRound {
  const attackDice = Math.max(0, getEffectiveAttack(attacker))
  const defenseTarget = target.def.defense
  const rolls: number[] = []
  let hits = 0

  for (let i = 0; i < attackDice; i++) {
    const roll = rng.d6()
    rolls.push(roll)
    if (roll >= defenseTarget) hits++
  }

  return {
    attacker: attacker.def.name,
    target: target.def.name,
    attackDice,
    defenseTarget,
    rolls,
    hits,
  }
}

/** 获取有效攻击力 (英军2Step舰受损后-2) */
function getEffectiveAttack(ship: ShipState): number {
  if (ship.def.side === 'british' && ship.def.maxSteps === 2 && ship.steps < ship.def.maxSteps) {
    return Math.max(0, ship.def.attack - 2)
  }
  return ship.def.attack
}

/** 造成伤害并返回获得的 VP */
function applyDamage(target: ShipState, hits: number): number {
  const actualHits = Math.min(hits, target.steps)
  target.steps -= actualHits
  return actualHits
}

/** 主战斗结算 (7.0) */
export function resolveCombat(
  state: GameState,
  combatCoord: { q: number; r: number },
  rng: Randomizer,
  isAirAttack: boolean = false,
  airAttackTarget?: ShipState,
): CombatResult {
  const result: CombatResult = {
    rounds: [],
    germanVpGained: 0,
    britishVpGained: 0,
    shipsSunk: [],
    log: [],
  }

  // 收集该格的双方舰船
  const germanShips: ShipState[] = []
  const britishShips: ShipState[] = []

  for (const s of state.germanShips) {
    if (s.steps <= 0) continue
    const pos = state.germanPositions.get(s.def.id)
    if (pos && hexEquals(pos, combatCoord)) germanShips.push(s)
  }
  for (const s of state.britishShips) {
    if (s.steps <= 0 || s.def.isDummy) continue
    const pos = state.britishPositions.get(s.def.id)
    if (pos && hexEquals(pos, combatCoord)) britishShips.push(s)
  }

  // 航空攻击先结算
  if (isAirAttack && airAttackTarget) {
    // Ark Royal 攻击目标
    const arkRoyal = state.britishShips.find(s => s.def.id === 'ark-royal')
    if (arkRoyal && arkRoyal.steps > 0) {
      const round = resolveAttack(arkRoyal, airAttackTarget, rng)
      result.rounds.push(round)

      const vp = applyDamage(airAttackTarget, round.hits)
      result.britishVpGained += vp
      result.log.push(
        `航空攻击: ${arkRoyal.def.name} → ${airAttackTarget.def.name}, ` +
        `投骰 [${round.rolls.join(', ')}], 命中 ${round.hits} 次`
      )
      if (airAttackTarget.steps <= 0) {
        result.shipsSunk.push(airAttackTarget.def.name)
        result.log.push(`${airAttackTarget.def.name} 被击沉!`)
      }
    }
  }

  // 表面战斗: 按攻击力从高到低，每单位选一个目标
  const allAttackers = [...germanShips, ...britishShips]
    .filter(s => s.steps > 0)
    .sort((a, b) => getEffectiveAttack(b) - getEffectiveAttack(a))

  for (const attacker of allAttackers) {
    if (attacker.steps <= 0) continue
    // 航空战斗时 Ark Royal 在邻格，不作为表面战斗目标
    if (isAirAttack && attacker.def.id === 'ark-royal') continue

    // 选对方阵营存活目标中攻击力最高的
    const targets = (attacker.def.side === 'german' ? britishShips : germanShips)
      .filter(t => t.steps > 0)
      .sort((a, b) => getEffectiveAttack(b) - getEffectiveAttack(a))

    const target = targets[0]
    if (!target) continue

    const round = resolveAttack(attacker, target, rng)
    result.rounds.push(round)

    const vp = applyDamage(target, round.hits)
    if (attacker.def.side === 'german') {
      result.germanVpGained += vp
    } else {
      result.britishVpGained += vp
    }

    result.log.push(
      `${attacker.def.name} → ${target.def.name}: ` +
      `投骰 [${round.rolls.join(', ')}], 命中 ${round.hits} 次`
    )

    if (target.steps <= 0) {
      result.shipsSunk.push(target.def.name)
      result.log.push(`${target.def.name} 被击沉!`)
    }
  }

  return result
}

/** 获取指定格是否可发生战斗 */
export function canCombat(state: GameState, coord: { q: number; r: number }): boolean {
  let hasGerman = false
  let hasBritish = false

  for (const s of state.germanShips) {
    if (s.steps <= 0) continue
    const pos = state.germanPositions.get(s.def.id)
    if (pos && hexEquals(pos, coord)) hasGerman = true
  }
  for (const s of state.britishShips) {
    if (s.steps <= 0 || s.def.isDummy) continue
    const pos = state.britishPositions.get(s.def.id)
    if (pos && hexEquals(pos, coord)) hasBritish = true
  }

  return hasGerman && hasBritish
}
