import { CombatResult } from '../../engine/combat'

interface CombatDialogProps {
  result: CombatResult | null
  onClose: () => void
}

export function CombatDialog({ result, onClose }: CombatDialogProps) {
  if (!result) return null

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 border-2 border-red-500 rounded-xl p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-bold text-red-400 mb-4">战斗结算</h2>

        {/* VP 变化 */}
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

        {/* 战斗日志 */}
        <div className="bg-slate-900 rounded-lg p-3 mb-4 max-h-64 overflow-y-auto">
          {result.log.map((line, i) => {
            const isSunk = line.includes('击沉')
            return (
              <div
                key={i}
                className={`text-sm py-0.5 ${
                  isSunk ? 'text-red-400 font-bold' : 'text-slate-300'
                }`}
              >
                {line}
              </div>
            )
          })}
        </div>

        {/* 投骰明细 */}
        {result.rounds.length > 0 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white mb-2">投骰明细</h3>
            {result.rounds.map((round, i) => (
              <div key={i} className="bg-slate-700 rounded p-2 mb-2 text-xs text-slate-300">
                <span className="text-white">{round.attacker}</span>
                {' → '}
                <span className="text-white">{round.target}</span>
                <span className="text-slate-500 ml-2">
                  ({round.attackDice}d6 ≥{round.defenseTarget})
                </span>
                <div className="mt-1 flex gap-1">
                  {round.rolls.map((r, j) => (
                    <span
                      key={j}
                      className={`inline-flex w-5 h-5 items-center justify-center rounded ${
                        r >= round.defenseTarget
                          ? 'bg-green-600 text-white'
                          : 'bg-slate-600 text-slate-400'
                      }`}
                    >
                      {r}
                    </span>
                  ))}
                  <span className="ml-2 text-slate-400">
                    → {round.hits} 命中
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 沉没舰船 */}
        {result.shipsSunk.length > 0 && (
          <div className="bg-red-900/30 border border-red-500 rounded p-3 mb-4">
            <span className="text-red-400 font-bold">击沉: </span>
            <span className="text-white">{result.shipsSunk.join(', ')}</span>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-3 bg-slate-600 hover:bg-slate-500 text-white rounded-lg font-bold transition"
        >
          确认
        </button>
      </div>
    </div>
  )
}
