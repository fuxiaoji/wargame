import { useState } from 'react'
import { GameState } from '../../engine/types'
import { GERMAN_START_HEXES } from '../../engine/map'
import { ALL_BRITISH_TOKENS } from '../../engine/units'

interface SetupScreenProps {
  gameState: GameState
  onGermanStart: (label: string) => void
  onPlaceBritish: (shipId: string, label: string) => void
  onFinishSetup: () => void
  onRandomPlace: () => void
  selectedHex: string | null
}

export function SetupScreen({
  gameState,
  onGermanStart,
  onPlaceBritish,
  onFinishSetup,
  onRandomPlace,
  selectedHex,
}: SetupScreenProps) {
  const [selectedToken, setSelectedToken] = useState<string | null>(null)
  const isGermanSetup = gameState.phase === 'setup-german'

  // ===== 德军布置 =====
  if (isGermanSetup) {
    return (
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
        <h2 className="text-lg font-bold text-white mb-3">德军初始布置</h2>
        <p className="text-slate-300 text-sm mb-4">
          选择德军舰队起始格 (A5, A6, 或 B7)。所有德军舰船从同一格出发。
        </p>
        <div className="flex gap-2 mb-4">
          {GERMAN_START_HEXES.map(label => (
            <button
              key={label}
              onClick={() => onGermanStart(label)}
              className="px-6 py-3 bg-red-700 hover:bg-red-600 text-white rounded-lg font-bold text-lg transition"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-slate-400 text-xs">也可直接点击地图上的 A5/A6/B7 格</p>
      </div>
    )
  }

  // ===== 英军布置 =====
  const placed = new Set<string>()
  for (const [id] of gameState.britishPositions) {
    placed.add(id)
  }
  const unplaced = ALL_BRITISH_TOKENS.filter(t => !placed.has(t.id))
  const allPlaced = unplaced.length === 0

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
      <h2 className="text-lg font-bold text-white mb-3">英军初始布置</h2>
      <p className="text-slate-300 text-sm mb-3">
        选择算子，再点击地图格子放置。同一格可放多个算子。
      </p>

      {/* 算子列表 */}
      <div className="flex flex-wrap gap-2 mb-4 max-h-48 overflow-y-auto">
        {ALL_BRITISH_TOKENS.map(tok => {
          const isPlaced = placed.has(tok.id)
          const isSelected = selectedToken === tok.id
          return (
            <button
              key={tok.id}
              onClick={() => setSelectedToken(isSelected ? null : tok.id)}
              disabled={isPlaced}
              className={`px-3 py-2 rounded text-sm font-medium transition ${
                isPlaced
                  ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                  : isSelected
                  ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                  : 'bg-blue-900 text-blue-200 hover:bg-blue-800'
              }`}
            >
              {tok.name}
              {tok.isDummy && ''}
              {isPlaced && ' ✓'}
            </button>
          )
        })}
      </div>

      {selectedToken && selectedHex && (
        <button
          onClick={() => {
            onPlaceBritish(selectedToken, selectedHex)
            setSelectedToken(null)
          }}
          className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold transition w-full"
        >
          将 {ALL_BRITISH_TOKENS.find(t => t.id === selectedToken)?.name} 放置在 {selectedHex}
        </button>
      )}

      {selectedToken && !selectedHex && (
        <p className="text-yellow-400 text-sm">请在地图上点击目标格放置算子</p>
      )}

      {!allPlaced && (
        <button onClick={onRandomPlace}
          className="w-full px-4 py-2 bg-yellow-700 hover:bg-yellow-600 text-white rounded text-sm font-bold transition mb-2">
          🎲 随机分布剩余 {unplaced.length} 个算子
        </button>
      )}

      <div className="mt-2 border-t border-slate-600 pt-3">
        <button
          onClick={onFinishSetup}
          disabled={!allPlaced}
          className={`w-full px-6 py-2 rounded font-bold transition ${
            allPlaced
              ? 'bg-green-600 hover:bg-green-500 text-white'
              : 'bg-slate-700 text-slate-500 cursor-not-allowed'
          }`}
        >
          {allPlaced ? '布阵完成，开始游戏!' : `还有 ${unplaced.length} 个算子未放置`}
        </button>
      </div>
    </div>
  )
}
