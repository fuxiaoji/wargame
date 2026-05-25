import type { AIDebugInfo } from '../../cli/state-machine'

const STRAT_COLORS: Record<string, string> = { rush: '#e74c3c', farm: '#2ecc71', hunt: '#f39c12', hide: '#3498db' }
const STRAT_NAMES: Record<string, string> = { rush: 'Rush冲港', farm: 'Farm打工', hunt: 'Hunt猎杀', hide: 'Hide躲藏' }

export function AIInternalsPanel({ data }: { data: AIDebugInfo | null }) {
  if (!data) return <div className="text-xs text-slate-500 p-2">等待 AI 决策...</div>

  const { strategyScores, moveScores, pickedStrategy, curShip } = data

  return (
    <div className="space-y-2 text-xs font-mono max-h-[60vh] overflow-y-auto">
      {/* 策略分数 */}
      <div>
        <div className="text-slate-400 mb-1">{curShip} — 策略选择</div>
        {strategyScores.map(s => {
          const picked = s.name === pickedStrategy
          return (
            <div key={s.name} className={`flex items-center gap-1 mb-0.5 ${picked ? 'bg-white/10 rounded px-1 -mx-1' : ''}`}>
              <div className="w-16 text-slate-300">{STRAT_NAMES[s.name] || s.name}</div>
              <div className="flex-1 h-3 bg-slate-700 rounded overflow-hidden">
                <div className="h-full rounded" style={{
                  width: `${(s.prob * 100).toFixed(0)}%`,
                  backgroundColor: STRAT_COLORS[s.name] || '#888',
                  opacity: picked ? 1 : 0.5,
                }} />
              </div>
              <div className="w-14 text-right">
                <span className={picked ? 'text-white font-bold' : 'text-slate-500'}>
                  {(s.prob * 100).toFixed(0)}%
                </span>
              </div>
              <div className="w-12 text-right text-slate-600">{s.raw.toFixed(1)}</div>
            </div>
          )
        })}
      </div>

      {/* 行动得分 */}
      <div>
        <div className="text-slate-400 mb-1">行动得分 (共{Math.min(moveScores.length, 15)}个)</div>
        <div className="grid grid-cols-3 gap-x-1 text-slate-500 mb-0.5">
          <div>目标格</div><div>热力</div><div>得分</div>
        </div>
        {moveScores.slice(0, 15).map((m, i) => (
          <div key={i} className="grid grid-cols-3 gap-x-1 text-slate-300">
            <div>{m.label}</div>
            <div className={m.heat < 0 ? 'text-blue-400' : m.heat > 0 ? 'text-red-400' : 'text-slate-500'}>
              {m.heat.toFixed(1)}
            </div>
            <div>{m.score.toFixed(2)}</div>
          </div>
        ))}
      </div>

      {/* 热力图图例 */}
      <div className="flex items-center gap-1 text-slate-500">
        <span className="text-blue-400">蓝=引力(-)</span>
        <div className="flex-1 h-2 rounded" style={{ background: 'linear-gradient(to right, #3498db, #fff, #e74c3c)' }} />
        <span className="text-red-400">红=斥力(+)</span>
      </div>
    </div>
  )
}
