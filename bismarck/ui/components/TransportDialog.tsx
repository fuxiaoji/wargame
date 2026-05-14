import { ShipState } from '../../engine/types'

interface TransportDialogProps {
  attackers: ShipState[]
  onAttack: (shipId: string) => void
  onSkip: () => void
}

export function TransportDialog({
  attackers,
  onAttack,
  onSkip,
}: TransportDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-slate-800 border-2 border-yellow-500 rounded-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-bold text-yellow-400 mb-4">攻击运输舰队</h2>

        <p className="text-slate-300 text-sm mb-4">
          以下德军舰船位于运输航路上，可选择攻击运输舰队 (投骰查表)。
        </p>

        <div className="space-y-2 mb-4">
          {attackers.map(ship => (
            <div key={ship.def.id} className="bg-slate-700 rounded p-3 flex justify-between items-center">
              <div>
                <div className="text-white font-bold">{ship.def.name}</div>
                <div className="text-xs text-slate-400">
                  Step: {ship.steps}/{ship.def.maxSteps} |
                  攻: {ship.def.attack}
                </div>
              </div>
              <button
                onClick={() => onAttack(ship.def.id)}
                className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded font-bold text-sm transition"
              >
                攻击
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={onSkip}
          className="w-full py-2 bg-slate-600 hover:bg-slate-500 text-white rounded font-bold transition"
        >
          跳过，进入下一回合
        </button>
      </div>
    </div>
  )
}
