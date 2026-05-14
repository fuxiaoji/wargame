import { GameState } from '../../engine/types'

interface VictoryScreenProps {
  gameState: GameState
  onNewGame: () => void
  onShowLog: () => void
}

export function VictoryScreen({ gameState, onNewGame, onShowLog }: VictoryScreenProps) {
  const isGermanWin = gameState.winner === 'german'

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className={`rounded-xl p-8 max-w-md w-full mx-4 text-center ${isGermanWin ? 'bg-red-900 border-4 border-red-500' : 'bg-blue-900 border-4 border-blue-500'}`}>
        <div className="text-6xl mb-4">
          {isGermanWin ? '🇩🇪' : '🇬🇧'}
        </div>
        <h1 className="text-3xl font-bold text-white mb-2">
          {isGermanWin ? '德军胜利!' : '英军胜利!'}
        </h1>
        <p className="text-lg text-slate-300 mb-4">
          {gameState.victoryReason}
        </p>

        <div className="bg-black/30 rounded-lg p-4 mb-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-red-400">德军 VP</div>
              <div className="text-3xl font-bold text-red-300">{gameState.vp.german}</div>
            </div>
            <div>
              <div className="text-xs text-blue-400">英军 VP</div>
              <div className="text-3xl font-bold text-blue-300">{gameState.vp.british}</div>
            </div>
          </div>
          <div className="text-sm text-slate-400 mt-3">
            回合数: {gameState.turn} / 18
          </div>
          <div className="text-sm text-slate-400">
            俾斯麦号: {
              (gameState.germanShips.find(s => s.def.id === 'bismarck')?.steps ?? 0) > 0
                ? '存活'
                : '已击沉!'
            }
          </div>
        </div>

        <div className="flex gap-3 justify-center">
          <button onClick={onShowLog}
            className="px-4 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold border border-white/30 transition">
            📋 查看日志
          </button>
          <button onClick={onNewGame}
            className="px-8 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-bold text-lg border border-white/30 transition">
            新游戏
          </button>
        </div>
      </div>
    </div>
  )
}
