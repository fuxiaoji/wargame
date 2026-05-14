import { GameState } from '../../engine/types'
import { hexToLabel } from '../../engine/map'
import { canMoveBeforeDetection } from '../../engine/units'

interface BritishMovePanelProps {
  gameState: GameState
  selectedShip: string | null
  selectedHex: string | null
  onSelectShip: (shipId: string) => void
  onMove: (shipId: string, targetLabel: string) => void
  onFinish: () => void
}

export function BritishMovePanel({
  gameState,
  selectedShip,
  selectedHex,
  onSelectShip,
  onMove,
  onFinish,
}: BritishMovePanelProps) {
  const liveShips = gameState.britishShips.filter(s => s.steps > 0)
  const canMove = (shipId: string) => {
    const ship = liveShips.find(s => s.def.id === shipId)
    if (!ship) return false
    return gameState.bismarckFound || canMoveBeforeDetection(ship.def)
  }

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
      <h2 className="text-lg font-bold text-blue-400 mb-3">英军移动阶段</h2>
      <p className="text-slate-300 text-sm mb-3">
        选择舰船(算子)，再点击高亮格移动。每艘船可移动 1-3 格。
        {!gameState.bismarckFound && (
          <span className="text-yellow-400"> (发现俾斯麦前，仅部分舰船可移动)</span>
        )}
      </p>

      {/* 舰船列表 */}
      <div className="flex flex-wrap gap-2 mb-4 max-h-48 overflow-y-auto">
        {liveShips.map(ship => {
          const pos = gameState.britishPositions.get(ship.def.id)
          const label = pos ? hexToLabel(pos) : '?'
          const isSelected = selectedShip === ship.def.id
          const movable = canMove(ship.def.id)

          return (
            <button
              key={ship.def.id}
              onClick={() => movable && onSelectShip(ship.def.id)}
              disabled={!movable}
              className={`px-3 py-2 rounded-lg text-left text-sm transition ${
                !movable
                  ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                  : isSelected
                  ? 'bg-blue-700 ring-2 ring-yellow-400'
                  : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <div className="font-bold text-white">
                {ship.def.name}
                {ship.def.isDummy && ' (伪装)'}
                {!movable && ' 🔒'}
              </div>
              <div className="text-xs text-slate-400">
                {ship.revealed ? '已翻开' : '背面'} |
                Step: {ship.steps}/{ship.def.maxSteps} |
                攻: {ship.def.isDummy ? '-' : ship.def.attack}
              </div>
              <div className="text-xs text-slate-500">{label}</div>
            </button>
          )
        })}
      </div>

      {/* 移动确认 */}
      {selectedShip && selectedHex && (
        <div className="mb-3">
          <button
            onClick={() => onMove(selectedShip, selectedHex)}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold transition"
          >
            移动至 {selectedHex}
          </button>
        </div>
      )}

      {selectedShip && !selectedHex && (
        <p className="text-yellow-400 text-sm mb-3">点击地图上的高亮格选择目标</p>
      )}

      {/* 完成 */}
      <button
        onClick={onFinish}
        className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition"
      >
        英军移动完成，进入索敌
      </button>
    </div>
  )
}
