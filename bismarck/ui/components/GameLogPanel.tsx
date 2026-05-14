import { useRef, useEffect, useState } from 'react'
import { GameLog } from '../../engine/log'

interface GameLogPanelProps {
  log: GameLog
  visible: boolean
  onToggle: () => void
}

const TYPE_LABELS: Record<string, string> = {
  setup: '布阵', move: '移动', search: '索敌',
  combat: '战斗', transport: '破交', turn: '回合', victory: '终局',
}
const TYPE_COLORS: Record<string, string> = {
  setup: 'text-blue-400', move: 'text-slate-300', search: 'text-yellow-400',
  combat: 'text-red-400', transport: 'text-orange-400', turn: 'text-slate-500', victory: 'text-green-400',
}

export function GameLogPanel({ log, visible, onToggle }: GameLogPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState<'current' | 'history'>('current')

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log.entries.length])

  if (!visible) {
    return (
      <button onClick={onToggle}
        className="fixed bottom-2 right-2 z-50 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded border border-slate-500">
        日志 ({log.entries.length})
      </button>
    )
  }

  const sessions = GameLog.loadAllSessions()
  const currentId = log.sessionId

  const exportCurrent = () => {
    const blob = new Blob([log.exportSession()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bismarck-${currentId}.json`
    a.click()
  }

  const exportCsv = () => {
    const blob = new Blob([log.exportCsv()], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `bismarck-${currentId}.csv`
    a.click()
  }

  const deleteSession = (id: string) => {
    if (!confirm('删除这局日志?')) return
    GameLog.deleteSession(id)
    // 强制刷新
    setTab(t => t === 'history' ? 'current' : 'history')
    setTimeout(() => setTab('history'), 0)
  }

  return (
    <div className="fixed bottom-2 right-2 z-[60] w-96 max-h-[70vh] bg-slate-900 border border-slate-600 rounded-lg flex flex-col shadow-2xl">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-700">
        <div className="flex gap-2">
          <button onClick={() => setTab('current')}
            className={`text-xs font-bold px-2 py-0.5 rounded ${tab === 'current' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>
            当前局
          </button>
          <button onClick={() => setTab('history')}
            className={`text-xs font-bold px-2 py-0.5 rounded ${tab === 'history' ? 'bg-slate-700 text-white' : 'text-slate-500'}`}>
            历史 ({sessions.length})
          </button>
        </div>
        <button onClick={onToggle} className="text-slate-400 hover:text-white text-sm">×</button>
      </div>

      {/* 内容 */}
      {tab === 'current' ? (
        <>
          <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-800">
            <button onClick={exportCurrent} className="text-xs text-blue-400 hover:text-blue-300">导出JSON</button>
            <button onClick={exportCsv} className="text-xs text-green-400 hover:text-green-300 ml-2">导出CSV</button>
            <span className="flex-1" />
            <span className="text-xs text-slate-500">ID: {currentId.slice(-8)}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 text-xs space-y-0.5">
            {log.entries.length === 0 && (
              <div className="text-slate-500 italic py-4 text-center">暂无记录</div>
            )}
            {log.entries.map((e, i) => (
              <div key={i} className="flex gap-1.5 leading-relaxed hover:bg-slate-800/50 rounded px-1">
                <span className="text-slate-600 shrink-0 w-7">T{e.turn}</span>
                <span className={`shrink-0 w-8 ${TYPE_COLORS[e.type] ?? 'text-slate-400'}`}>
                  [{TYPE_LABELS[e.type] ?? e.type}]
                </span>
                <span className={
                  e.message.includes('击沉') ? 'text-red-400 font-bold' :
                  e.message.includes('发现') ? 'text-yellow-300' :
                  e.message.includes('VP') || e.message.includes('vp') ? 'text-green-300' :
                  'text-slate-300'
                }>{e.message}</span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 text-xs space-y-1">
          {sessions.length === 0 && (
            <div className="text-slate-500 italic py-4 text-center">无历史记录</div>
          )}
          {sessions.map(s => (
            <div key={s.id} className={`p-2 rounded ${s.id === currentId ? 'bg-slate-700 border border-slate-500' : 'bg-slate-800 hover:bg-slate-750'}`}>
              <div className="flex items-center justify-between">
                <span className="text-white font-bold text-xs">
                  {new Date(s.startTime).toLocaleString('zh-CN')}
                </span>
                <span className={`text-xs font-bold ${s.winner === 'german' ? 'text-red-400' : s.winner === 'british' ? 'text-blue-400' : 'text-slate-500'}`}>
                  {s.winner === 'german' ? '德军胜' : s.winner === 'british' ? '英军胜' : '未结束'}
                </span>
              </div>
              <div className="text-slate-400 mt-0.5">
                回合: {s.entries.length > 0 ? Math.max(...s.entries.map(e => e.turn)) : '-'}
                {' · '}日志: {s.entries.length}条
                {s.germanStart && <span className="ml-2">起始: {s.germanStart}</span>}
              </div>
              <div className="text-slate-400">
                {s.victoryReason && <span>{s.victoryReason}</span>}
                {s.finalVp && <span className="ml-2">VP 德{s.finalVp.german}/英{s.finalVp.british}</span>}
              </div>
              <button onClick={() => deleteSession(s.id)}
                className="mt-1 text-xs text-red-400 hover:text-red-300">删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
