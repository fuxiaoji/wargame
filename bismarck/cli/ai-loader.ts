/** 训练个体加载器 —— 从JSON加载权重，创建状态机AI */

import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_WEIGHTS, Weights } from './state-machine'

export interface IndividualInfo {
  index: number
  version: string
  generation: number
  side: 'german' | 'british'
  weights: Weights
  style: string       // 策略风格标签
  winRate?: number    // 该代胜率
}

const DATA_DIR = path.join(import.meta.dirname, '..', '..', 'deeplearn', 'data')

/** 列出某训练版本下某代的所有个体 */
export function listIndividuals(version: string, generation: number): {
  german: IndividualInfo[]
  british: IndividualInfo[]
  genStats: any
} {
  const genDir = path.join(DATA_DIR, version, `gen_${String(generation).padStart(3, '0')}`)
  const gerFile = path.join(genDir, 'ger_population.json')
  const britFile = path.join(genDir, 'brit_population.json')
  const statsFile = path.join(genDir, 'stats.json')

  const german: IndividualInfo[] = []
  const british: IndividualInfo[] = []
  let genStats: any = {}

  try { genStats = JSON.parse(fs.readFileSync(statsFile, 'utf-8')) } catch {}
  try {
    const gerData: any[] = JSON.parse(fs.readFileSync(gerFile, 'utf-8'))
    gerData.forEach((w, i) => german.push({
      index: i, version, generation, side: 'german',
      weights: { ...DEFAULT_WEIGHTS, ...w },
      style: gerStyleLabel(w),
    }))
  } catch {}
  try {
    const britData: any[] = JSON.parse(fs.readFileSync(britFile, 'utf-8'))
    britData.forEach((w, i) => british.push({
      index: i, version, generation, side: 'british',
      weights: { ...DEFAULT_WEIGHTS, ...w },
      style: britStyleLabel(w),
    }))
  } catch {}

  return { german, british, genStats }
}

/** 列出某训练版本下可用的代数 */
export function listGenerations(version: string): number[] {
  const dir = path.join(DATA_DIR, version)
  const gens: number[] = []
  try {
    for (const entry of fs.readdirSync(dir)) {
      const m = entry.match(/^gen_(\d+)$/)
      if (m) gens.push(parseInt(m[1]))
    }
  } catch {}
  return gens.sort((a, b) => a - b)
}

/** 列出可用的训练版本 */
export function listVersions(): string[] {
  try {
    return fs.readdirSync(DATA_DIR).filter(d => {
      const p = path.join(DATA_DIR, d)
      return fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'gen_000'))
    })
  } catch { return [] }
}

// ===== 风格标签 =====
function gerStyleLabel(w: any): string {
  const w1 = w.w1 ?? 3, w5 = w.w5 ?? 2, w9 = w.w9 ?? 4, w12 = w.w12 ?? 2
  if (w12 < 0.5) {
    if (w1 > 3.5) return '不躲·冲港狂'
    if (w5 > 3) return '不躲·打工仔'
    if (w9 > 5) return '不躲·猎手'
    return '不躲·激进'
  }
  if (w1 > 4) return '冲港狂'
  if (w5 > 3 && w1 > 3) return '双修派'
  if (w5 > 3) return '打工仔'
  if (w9 > 5) return '猎手'
  if (w12 > 3) return '怂包躲藏'
  return '均衡派'
}

function britStyleLabel(w: any): string {
  const s1 = w.s1 ?? 10, h1 = w.h1 ?? 10, d1 = w.d1 ?? 5
  if (s1 > 12) return '雷达兵'
  if (h1 > 12) return '猎犬'
  if (d1 > 6) return '守门员'
  if (d1 < 3) return '不守家'
  return '均衡派'
}

/** 为前端创建 ActionSelector */
export { createStateMachineAI } from './state-machine'
