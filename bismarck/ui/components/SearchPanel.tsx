import { GameState } from '../../engine/types'

interface SearchPanelProps {
  gameState: GameState
  airSearchTargets: string[]
  onDoSearch: () => void
  onAirSearch: (label: string) => void
  onFinish: () => void
}

export function SearchPanel({
  gameState,
  airSearchTargets,
  onDoSearch,
  onAirSearch,
  onFinish,
}: SearchPanelProps) {
  const hasArkRoyal = gameState.britishShips.find(
    s => s.def.id === 'ark-royal' && s.steps > 0
  )
  const bismarckFound = gameState.bismarckFound

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
      <h2 className="text-lg font-bold text-blue-400 mb-3">索敌阶段</h2>

      <div className="space-y-4">
        {/* 同格索敌 */}
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">1. 同格索敌</h3>
          <p className="text-xs text-slate-400 mb-2">
            系统自动检查是否有英军与德军同格。如有则德军必须宣告位置。
          </p>
          {!gameState.combatPending ? (
            <button
              onClick={onDoSearch}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold text-sm transition"
            >
              执行同格索敌
            </button>
          ) : (
            <div className="text-green-400 text-sm font-bold">
              ✓ 发现德军! 进入战斗阶段。
            </div>
          )}
        </div>

        {/* 航空索敌 */}
        {!bismarckFound && hasArkRoyal && !gameState.combatPending && (
          <div className="border-t border-slate-600 pt-3">
            <h3 className="text-sm font-semibold text-white mb-2">2. 航空索敌 (皇家方舟号)</h3>
            <p className="text-xs text-slate-400 mb-2">
              皇家方舟号可搜索相邻一格。若发现德军则立即结算航空攻击。
            </p>
            {airSearchTargets.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {airSearchTargets.map(label => (
                  <button
                    key={label}
                    onClick={() => onAirSearch(label)}
                    className="px-3 py-2 bg-indigo-700 hover:bg-indigo-600 text-white rounded text-sm transition"
                  >
                    搜索 {label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-slate-500 text-sm">皇家方舟号不在有效位置</p>
            )}
          </div>
        )}

        {/* 完成索敌 */}
        <div className="border-t border-slate-600 pt-3">
          <button
            onClick={onFinish}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition"
          >
            {gameState.combatPending ? '进入战斗阶段' : '索敌完成 (未发现德军)'}
          </button>
        </div>
      </div>
    </div>
  )
}
