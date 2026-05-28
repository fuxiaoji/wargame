import { useEffect, useRef } from 'react'
import { CombatResult } from '../../engine/combat'
import { GameState } from '../../engine/types'
import { SpineCharacter } from '../spine/SpineCharacter'
import { SpineManager } from '../spine/SpineManager'

interface CombatDialogProps {
  result: CombatResult | null
  onClose: () => void
  gameState?: GameState
  displayMode?: 'token' | 'sprite'
}

export function CombatDialog({ result, onClose, gameState, displayMode }: CombatDialogProps) {
  if (!result) return null

  const allShips = gameState ? [...gameState.britishShips, ...gameState.germanShips] : []

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 border-2 border-red-500 rounded-xl p-6 max-w-3xl w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-red-400 mb-4">战斗结算</h2>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-red-900/50 rounded-lg p-3 text-center">
            <div className="text-xs text-red-400">德军 VP</div>
            <div className="text-2xl font-bold text-red-300">+{result.germanVpGained}</div>
          </div>
          <div className="bg-blue-900/50 rounded-lg p-3 text-center">
            <div className="text-xs text-blue-400">英军 VP</div>
            <div className="text-2xl font-bold text-blue-300">+{result.britishVpGained}</div>
          </div>
        </div>

        {/* 投骰明细 — 每条旁边放战斗小人 */}
        {result.rounds.map((round, i) => {
          const attackerShip = allShips.find(s => s.def.name === round.attacker)
          const targetShip = allShips.find(s => s.def.name === round.target)

          return (
            <div key={i} className="flex items-center gap-3 bg-slate-700 rounded p-2 mb-2">
              {/* 攻击方小人 */}
              {displayMode === 'sprite' && attackerShip && (
                <RoundSpineAnim shipId={attackerShip.def.id} anim="attack" />
              )}

              <div className="flex-1 text-xs text-slate-300">
                <span className="text-white">{round.attacker}</span>
                {' → '}
                <span className="text-white">{round.target}</span>
                <span className="text-slate-500 ml-2">
                  ({round.attackDice}d6 ≥{round.defenseTarget})
                </span>
                <div className="mt-1 flex gap-1">
                  {round.rolls.map((r, j) => (
                    <span key={j} className={`inline-flex w-5 h-5 items-center justify-center rounded ${r >= round.defenseTarget ? 'bg-green-600 text-white' : 'bg-slate-600 text-slate-400'}`}>
                      {r}
                    </span>
                  ))}
                  <span className="ml-2 text-slate-400">→ {round.hits} 命中</span>
                </div>
              </div>

              {/* 防御方小人 */}
              {displayMode === 'sprite' && targetShip && (
                <RoundSpineAnim shipId={targetShip.def.id} anim="damaged" />
              )}
            </div>
          )
        })}

        {result.shipsSunk.length > 0 && (
          <div className="bg-red-900/30 border border-red-500 rounded p-3 mb-4">
            <span className="text-red-400 font-bold">击沉: </span>
            <span className="text-white">{result.shipsSunk.join(', ')}</span>
          </div>
        )}

        <button onClick={onClose}
          className="w-full py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-lg font-bold transition">
          确认
        </button>
      </div>
    </div>
  )
}

/** 单条投骰旁边的战斗小人 (80x80) */
function RoundSpineAnim({ shipId, anim }: { shipId: string; anim: 'attack' | 'damaged' }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const raw = SpineManager.getAsset(shipId)
    if (!raw || !ref.current) return

    const char = new SpineCharacter(raw, 100, 100)
    char.setAnimation(anim)
    ref.current.appendChild(char.getCanvas())

    return () => char.destroy()
  }, [shipId, anim])

  return <div ref={ref} className="w-24 h-24 bg-slate-900/50 rounded flex-shrink-0 flex items-center justify-center" />
}
