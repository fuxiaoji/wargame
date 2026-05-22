import { useState, useCallback, useRef } from 'react'
import { CppGame } from '../../cpp-game'

function parseLabel(label: string): { q: number; r: number } | null {
  const colMap: Record<string, number> = { A:0, B:1, C:2, D:3, E:4, F:5 }
  if (!label || label.length < 2) return null
  const col = colMap[label[0].toUpperCase()]
  const row = parseInt(label.slice(1))
  if (col === undefined || isNaN(row)) return null
  return { q: col, r: row }
}

export function useCppGame() {
  const gameRef = useRef<CppGame | null>(null)
  const [state, setState] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [selectedHex, setSelectedHex] = useState<string | null>(null)
  const [selectedShip, setSelectedShip] = useState<string | null>(null)
  const [highlightedHexes, setHighlightedHexes] = useState<Set<string>>(new Set())

  const showMsg = (cb: (m: string) => void, msg: string) => { cb(msg); setTimeout(() => cb(''), 3000) }

  const refresh = useCallback(async () => {
    if (!gameRef.current) return
    try {
      await gameRef.current.refresh()
      setState({ ...gameRef.current.state })
    } catch { /* ignore */ }
  }, [])

  const init = useCallback(async () => {
    setLoading(true)
    try {
      const g = new CppGame()
      await g.refresh()
      gameRef.current = g
      setState({ ...g.state })
    } catch (e: any) {
      showMsg(setError, 'C++ 引擎连接失败: ' + (e.message ?? 'unknown'))
    }
    setLoading(false)
  }, [])

  const run = useCallback(async (fn: (g: CppGame) => Promise<any>) => {
    if (!gameRef.current) return null
    try {
      const r = await fn(gameRef.current)
      await refresh()
      return r
    } catch (e: any) {
      showMsg(setError, e.message ?? 'error')
      return null
    }
  }, [refresh])

  const setupGermanStart  = useCallback((label: string) => run(g => g.setGermanStart(label)), [run])
  const placeBritishToken = useCallback((shipId: string, label: string) => run(g => g.placeBritishToken(shipId, label)), [run])
  const finishSetup        = useCallback(() => run(g => g.finishSetup()), [run])
  const germanMove         = useCallback((shipId: string, label: string) => run(g => g.germanMove(shipId, label)), [run])
  const finishGermanMove   = useCallback(() => run(g => g.finishGermanMove()), [run])
  const britishMove        = useCallback((shipId: string, label: string) => run(g => g.britishMove(shipId, label)), [run])
  const finishBritishMove  = useCallback(() => run(g => g.finishBritishMove()), [run])
  const doSearch           = useCallback(() => run(g => g.doSearch()), [run])
  const doAirSearch        = useCallback((label: string) => run(g => g.doAirSearch(label)), [run])
  const finishSearch       = useCallback(() => run(g => g.finishSearch()), [run])
  const doCombat           = useCallback(() => run(g => g.doCombat()), [run])
  const doTransportAttack  = useCallback((shipId: string) => run(g => g.doTransportAttack(shipId)), [run])
  const skipTransportAttack= useCallback(() => run(g => g.skipTransportAttack()), [run])
  const undoLastMove       = useCallback((shipId: string) => run(g => g.undoLastMove(shipId)), [run])
  const newGame            = useCallback(() => run(g => g.newGame()), [run])

  const getReachableHexes = useCallback(async (shipId: string) => {
    if (!gameRef.current) return new Set<string>()
    const labels = await gameRef.current.getReachableLabels(shipId)
    return new Set(labels)
  }, [])

  const getAirSearchTargets = useCallback(async () => {
    if (!gameRef.current) return []
    return gameRef.current.getAirSearchTargets()
  }, [])

  const getTransportAttackers = useCallback(async () => {
    if (!gameRef.current) return []
    return gameRef.current.getTransportAttackers()
  }, [])

  return {
    gameState: state,
    loading,
    error, message,
    selectedHex, setSelectedHex,
    selectedShip, setSelectedShip,
    highlightedHexes, setHighlightedHexes,
    init,
    setupGermanStart, placeBritishToken, finishSetup,
    germanMove, finishGermanMove,
    britishMove, finishBritishMove,
    doSearch, doAirSearch, finishSearch,
    doCombat, doTransportAttack, skipTransportAttack,
    undoLastMove, newGame,
    getReachableHexes, getAirSearchTargets, getTransportAttackers,
    refresh,
  }
}
