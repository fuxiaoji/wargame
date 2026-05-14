import { useState, useCallback, useRef } from 'react'
import { BismarckGame } from '../../engine/game'
import { GameState } from '../../engine/types'
import { getGermanReachableLabels, getBritishReachableLabels } from '../../engine/movement'
import { getAirSearchTargets } from '../../engine/search'
import { getTransportAttackers } from '../../engine/transport'

export function useGame(log?: import('../../engine/log').GameLog) {
  const gameRef = useRef(new BismarckGame(undefined, log))
  const game = gameRef.current

  const [, setState] = useState<GameState>({ ...game.state })
  const refresh = useCallback(() => {
    setState({ ...game.state })
  }, [game])

  // UI 状态
  const [selectedHex, setSelectedHex] = useState<string | null>(null)
  const [selectedShip, setSelectedShip] = useState<string | null>(null)
  const [highlightedHexes, setHighlightedHexes] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<string>('')
  const [error, setError] = useState<string>('')

  const showError = useCallback((msg: string) => {
    setError(msg)
    setTimeout(() => setError(''), 3000)
  }, [])

  const showMessage = useCallback((msg: string) => {
    setMessage(msg)
    setTimeout(() => setMessage(''), 3000)
  }, [])

  // ========== Setup ==========

  const setupGermanStart = useCallback((label: string) => {
    const result = game.setGermanStart(label)
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    showMessage(`德军起始格设为 ${label}`)
    return true
  }, [game, refresh, showError, showMessage])

  const placeBritishToken = useCallback((shipId: string, label: string) => {
    const result = game.placeBritishToken(shipId, label)
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    return true
  }, [game, refresh, showError])

  const finishSetup = useCallback(() => {
    const result = game.finishSetup()
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    showMessage('布阵完成，游戏开始! 德军请移动。')
    return true
  }, [game, refresh, showError, showMessage])

  // ========== German Move ==========

  const germanMove = useCallback((shipId: string, targetLabel: string) => {
    const result = game.germanMove(shipId, targetLabel)
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    return true
  }, [game, refresh, showError])

  const finishGermanMove = useCallback(() => {
    const result = game.finishGermanMove()
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    showMessage('英军移动阶段')
    return true
  }, [game, refresh, showError, showMessage])

  // ========== British Move ==========

  const britishMove = useCallback((shipId: string, targetLabel: string) => {
    const result = game.britishMove(shipId, targetLabel)
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    return true
  }, [game, refresh, showError])

  const finishBritishMove = useCallback(() => {
    const result = game.finishBritishMove()
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    showMessage('索敌阶段: 检查同格索敌...')
    return true
  }, [game, refresh, showError, showMessage])

  // ========== Search ==========

  const doSearch = useCallback(() => {
    const result = game.doSearch()
    refresh()
    if (result.type === 'co-locate') {
      showMessage(`发现德军! 在格 ${result.germanLabel}`)
    }
    return result
  }, [game, refresh, showMessage])

  const doAirSearch = useCallback((adjacentLabel: string) => {
    const result = game.doAirSearch(adjacentLabel)
    refresh()
    if (result.foundShips.length > 0) {
      showMessage(`航空索敌发现德军在 ${adjacentLabel}!`)
    } else {
      showMessage(`航空索敌 ${adjacentLabel}: 未发现。`)
    }
    return result
  }, [game, refresh, showMessage])

  const finishSearch = useCallback(() => {
    const result = game.finishSearch()
    if (!result.ok) { showError(result.error!); return false }
    refresh()
    return true
  }, [game, refresh, showError])

  // ========== Combat ==========

  const doCombat = useCallback(() => {
    const result = game.doCombat()
    refresh()
    return result
  }, [game, refresh])

  // ========== Transport ==========

  const doTransportAttack = useCallback((shipId: string) => {
    const result = game.doTransportAttack(shipId)
    refresh()
    showMessage(result.description)
    return result
  }, [game, refresh, showMessage])

  const skipTransportAttack = useCallback(() => {
    game.skipTransportAttack()
    refresh()
    showMessage('跳过运输攻击，进入下一回合')
  }, [game, refresh, showMessage])

  // ========== Helpers ==========

  const undoLastMove = useCallback((shipId: string) => {
    const r = game.undoLastMove(shipId)
    if (r.ok) refresh()
    return r
  }, [game, refresh])

  const getReachableHexes = useCallback((shipId: string) => {
    const gShip = game.state.germanShips.find(s => s.def.id === shipId)
    if (gShip && gShip.steps > 0) {
      const pos = game.state.germanPositions.get(shipId)
      if (pos) return new Set(getGermanReachableLabels(gShip, pos))
    }
    const bShip = game.state.britishShips.find(s => s.def.id === shipId)
    if (bShip && bShip.steps > 0) {
      const pos = game.state.britishPositions.get(shipId)
      if (pos) return new Set(getBritishReachableLabels(game.state, bShip, pos))
    }
    return new Set<string>()
  }, [game])

  const getAirSearchTargetsForArkRoyal = useCallback(() => {
    const arkRoyal = game.state.britishShips.find(s => s.def.id === 'ark-royal')
    if (!arkRoyal || arkRoyal.steps <= 0) return []
    const pos = game.state.britishPositions.get('ark-royal')
    if (!pos) return []
    return getAirSearchTargets(game.state, pos)
  }, [game])

  const getTransportAttackersForUI = useCallback(() => {
    return getTransportAttackers(game.state)
  }, [game])

  return {
    // state
    game,
    gameState: game.state,
    // UI state
    selectedHex,
    setSelectedHex,
    selectedShip,
    setSelectedShip,
    highlightedHexes,
    setHighlightedHexes,
    message,
    error,
    // actions
    setupGermanStart,
    placeBritishToken,
    finishSetup,
    germanMove,
    finishGermanMove,
    britishMove,
    finishBritishMove,
    doSearch,
    doAirSearch,
    finishSearch,
    doCombat,
    doTransportAttack,
    skipTransportAttack,
    // helpers
    undoLastMove,
    getReachableHexes,
    getAirSearchTargetsForArkRoyal,
    getTransportAttackersForUI,
    refresh,
  }
}
