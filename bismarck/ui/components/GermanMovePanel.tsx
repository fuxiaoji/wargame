import { GameState } from '../../engine/types'
import { hexToLabel } from '../../engine/map'
import { getShipSpeed } from '../../engine/movement'

interface GermanMovePanelProps {
  gameState: GameState
  selectedShip: string | null
  selectedHex: string | null
  onSelectShip: (shipId: string) => void
  onMove: (shipId: string, targetLabel: string) => void
  onFinish: () => void
  onUndo?: (shipId: string) => void
  undoableShip?: string | null
}

export function GermanMovePanel({
  gameState,
  selectedShip,
  selectedHex,
  onSelectShip,
  onMove,
  onFinish,
}: GermanMovePanelProps) {
  const liveShips = gameState.germanShips.filter(s => s.steps > 0)

  const handleMove = () => {
    if (selectedShip && selectedHex) {
      onMove(selectedShip, selectedHex)
    }
  }

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg p-4">
      <h2 className="text-lg font-bold text-red-400 mb-3">德军移动阶段</h2>
      <p className="text-slate-300 text-sm mb-3">
        德军位置不在地图上显示。选择舰船，再点击目标格移动。
        {gameState.germanPositionPublic && (
          <span className="text-yellow-400 font-bold"> (当前位置已公开!)</span>
        )}
      </p>

      {/* 舰船列表 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {liveShips.map(ship => {
          const pos = gameState.germanPositions.get(ship.def.id)
          const label = pos ? hexToLabel(pos) : '?'
          const isSelected = selectedShip === ship.def.id
          const speed = getShipSpeed(ship)

          return (
            <button
              key={ship.def.id}
              onClick={() => onSelectShip(ship.def.id)}
              className={`px-4 py-3 rounded-lg text-left transition ${
                isSelected
                  ? 'bg-red-700 ring-2 ring-yellow-400'
                  : 'bg-slate-700 hover:bg-slate-600'
              }`}
            >
              <div className="font-bold text-white text-sm">{ship.def.name}</div>
              <div className="text-xs text-slate-400">
                Step: {ship.steps}/{ship.def.maxSteps} | 速度: {speed} | 攻: {ship.def.attack} | 防: {ship.def.defense}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                当前位置: {gameState.germanPositionPublic || gameState.bismarckFound ? label : '???'}
              </div>
            </button>
          )
        })}
      </div>

      {/* 移动确认 */}
      {selectedShip && (
        <div className="bg-slate-700 rounded p-3 mb-3">
          <p className="text-sm text-slate-300">
            已选择: <span className="text-white font-bold">{gameState.germanShips.find(s => s.def.id === selectedShip)?.def.name}</span>
            {selectedHex && (
              <span className="text-green-400 ml-2">→ 目标: {selectedHex}</span>
            )}
          </p>
          {selectedHex && (
            <button
              onClick={handleMove}
              className="mt-2 px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold transition"
            >
              移动至 {selectedHex}
            </button>
          )}
          {!selectedHex && (
            <p className="text-yellow-400 text-sm mt-1">点击地图上的高亮格选择目标</p>
          )}
        </div>
      )}

      {/* 完成按钮 */}
      <button
        onClick={onFinish}
        className="mt-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition"
      >
        德军移动完成，进入英军阶段
      </button>
    </div>
  )
}
