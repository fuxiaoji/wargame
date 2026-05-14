import { GameState } from './types'
import { isBrest } from './map'

export interface VictoryCheck {
  gameOver: boolean
  winner: 'german' | 'british' | null
  reason: string
}

/** 检查即时胜利条件 + 回合结束条件 */
export function checkVictory(state: GameState): VictoryCheck {
  // 德军 6 VP 立即胜利
  if (state.vp.german >= 6) {
    return { gameOver: true, winner: 'german', reason: '德军获得 6 分，立即胜利!' }
  }

  // 俾斯麦被击沉 → 英军立即胜利
  const bismarck = state.germanShips.find(s => s.def.id === 'bismarck')
  if (bismarck && bismarck.steps <= 0) {
    return { gameOver: true, winner: 'british', reason: '俾斯麦号被击沉，英军胜利!' }
  }

  return { gameOver: false, winner: null, reason: '' }
}

/** 回合结束时检查胜利条件 */
export function checkEndTurnVictory(state: GameState): VictoryCheck {
  // 先查即时条件
  const immediate = checkVictory(state)
  if (immediate.gameOver) return immediate

  // 18 回合结束 → 英军胜利
  if (state.turn > 18) {
    return { gameOver: true, winner: 'british', reason: '18 回合结束，德军未达成胜利条件，英军胜利!' }
  }

  // 德军占据布雷斯特且 VP 领先 → 德军胜利
  const bismarck = state.germanShips.find(s => s.def.id === 'bismarck')
  if (bismarck && bismarck.steps > 0) {
    const bismarckPos = state.germanPositions.get('bismarck')
    if (bismarckPos && isBrest(bismarckPos) && state.vp.german > state.vp.british) {
      return {
        gameOver: true,
        winner: 'german',
        reason: '俾斯麦号抵达布雷斯特且德军 VP 领先，德军胜利!',
      }
    }

    // 占据布雷斯特但 VP 不领先 → 继续
    if (bismarckPos && isBrest(bismarckPos) && state.vp.german <= state.vp.british) {
      return { gameOver: false, winner: null, reason: '' }
    }
  }

  return { gameOver: false, winner: null, reason: '' }
}
