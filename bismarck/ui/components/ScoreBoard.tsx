import { GameState } from '../../engine/types'

interface ScoreBoardProps {
  gameState: GameState
}

const phaseLabels: Record<string, string> = {
  'setup-german': '德军初始布置',
  'setup-british': '英军初始布置',
  'german-move': '德军移动',
  'british-move': '英军移动',
  'british-search': '英军索敌',
  'combat': '战斗结算',
  'transport-attack': '攻击运输舰队',
  'game-over': '游戏结束',
}

export function ScoreBoard({ gameState }: ScoreBoardProps) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-slate-800 rounded-lg border border-slate-600">
      {/* 回合 */}
      <div className="flex flex-col items-center">
        <span className="text-xs text-slate-400">回合</span>
        <span className="text-2xl font-bold text-white">{gameState.turn}</span>
        <span className="text-xs text-slate-400">/ 18</span>
      </div>

      <div className="w-px h-10 bg-slate-600" />

      {/* 阶段 */}
      <div className="flex flex-col">
        <span className="text-xs text-slate-400">当前阶段</span>
        <span className="text-sm font-semibold text-yellow-400">
          {phaseLabels[gameState.phase] ?? gameState.phase}
        </span>
      </div>

      <div className="w-px h-10 bg-slate-600" />

      {/* VP */}
      <div className="flex gap-4">
        <div className="flex flex-col items-center">
          <span className="text-xs text-red-400">德军 VP</span>
          <span className="text-xl font-bold text-red-400">{gameState.vp.german}</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-xs text-blue-400">英军 VP</span>
          <span className="text-xl font-bold text-blue-400">{gameState.vp.british}</span>
        </div>
      </div>

      <div className="w-px h-10 bg-slate-600" />

      {/* 状态 */}
      <div className="flex flex-col gap-1 text-xs">
        <StatusBadge active={gameState.bismarckFound} label="俾斯麦定位" />
        <StatusBadge active={gameState.germanPositionPublic} label="德军位置公开" />
        <StatusBadge active={gameState.combatPending} label="战斗待结算" color="red" />
      </div>
    </div>
  )
}

function StatusBadge({ active, label, color = 'green' }: { active: boolean; label: string; color?: string }) {
  return (
    <span className={`px-2 py-0.5 rounded ${active ? `bg-${color}-600 text-white` : 'bg-slate-700 text-slate-500'}`}>
      {label}
    </span>
  )
}
