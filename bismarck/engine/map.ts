import { HexCoord, HexCell } from './types'

// ========== 轴向六角格坐标工具 ==========

// 偶数列(A/C/E)和奇数列(B/D/F)邻接方向不同,因为奇数列左偏
const EVEN_Q_DIRS: HexCoord[] = [
  { q: 1, r: 0 }, { q: 1, r: 1 },   // 下一列(奇数列左偏:同r=左下, r+1=正下)
  { q: 0, r: -1 },                    // 同列左
  { q: 0, r: 1 },                     // 同列右
  { q: -1, r: 0 }, { q: -1, r: 1 },  // 上一列(同r=左上, r+1=正上)
]
const ODD_Q_DIRS: HexCoord[] = [
  { q: 1, r: -1 }, { q: 1, r: 0 },    // 下一列: 左下/右下
  { q: 0, r: -1 },                     // 同列左
  { q: 0, r: 1 },                      // 同列右
  { q: -1, r: -1 }, { q: -1, r: 0 },  // 上一列: 左上/右上
]

export function hexEquals(a: HexCoord, b: HexCoord): boolean { return a.q === b.q && a.r === b.r }
export function hexAdd(a: HexCoord, b: HexCoord): HexCoord { return { q: a.q + b.q, r: a.r + b.r } }

export function hexDistance(a: HexCoord, b: HexCoord): number {
  // 用 BFS 计算奇偶列感知的实际距离
  if (a.q === b.q && a.r === b.r) return 0
  const visited = new Set<string>()
  const queue: { coord: HexCoord; dist: number }[] = [{ coord: a, dist: 0 }]
  visited.add(`${a.q},${a.r}`)
  while (queue.length > 0) {
    const { coord, dist } = queue.shift()!
    for (const nb of hexNeighbors(coord)) {
      if (nb.q === b.q && nb.r === b.r) return dist + 1
      const k = `${nb.q},${nb.r}`
      if (visited.has(k)) continue
      visited.add(k)
      if (dist + 1 >= 8) continue  // 最大搜索8步(远超游戏需求)
      queue.push({ coord: nb, dist: dist + 1 })
    }
  }
  return Infinity  // 不可达
}

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  const dirs = coord.q % 2 === 0 ? EVEN_Q_DIRS : ODD_Q_DIRS
  return dirs.map(d => hexAdd(coord, d))
}

// ========== 格号 ↔ 轴向坐标 ==========
// q=列字母索引(A=0..F=5), r=行数字(1-indexed, 与地图标注一致)

function buildLabelToCoord(): Map<string, HexCoord> {
  const map = new Map<string, HexCoord>()
  const cells: [string, number, number][] = [
    ['A3', 0, 3], ['A4', 0, 4], ['A5', 0, 5], ['A6', 0, 6],
    ['B2', 1, 2], ['B3', 1, 3], ['B4', 1, 4], ['B5', 1, 5], ['B6', 1, 6], ['B7', 1, 7],
    ['C1', 2, 1], ['C2', 2, 2], ['C3', 2, 3], ['C4', 2, 4], ['C5', 2, 5], ['C6', 2, 6], ['C7', 2, 7],
    ['D1', 3, 1], ['D2', 3, 2], ['D3', 3, 3], ['D4', 3, 4], ['D5', 3, 5], ['D6', 3, 6], ['D7', 3, 7], ['D8', 3, 8],
    ['E1', 4, 1], ['E2', 4, 2], ['E3', 4, 3], ['E4', 4, 4], ['E5', 4, 5], ['E6', 4, 6], ['E7', 4, 7],
    ['F1', 5, 1], ['F2', 5, 2], ['F3', 5, 3], ['F4', 5, 4], ['F5', 5, 5], ['F6', 5, 6], ['F7', 5, 7],
  ]
  for (const [label, q, r] of cells) map.set(label, { q, r })
  return map
}

const labelToCoord = buildLabelToCoord()

const coordToLabel = (() => {
  const map = new Map<string, string>()
  for (const [label, c] of labelToCoord) map.set(`${c.q},${c.r}`, label)
  return map
})()

export function labelToHex(label: string): HexCoord | null {
  return labelToCoord.get(label.toUpperCase()) ?? null
}
export function hexToLabel(coord: HexCoord): string | null {
  return coordToLabel.get(`${coord.q},${coord.r}`) ?? null
}
export function isValidCoord(coord: HexCoord): boolean {
  return coordToLabel.has(`${coord.q},${coord.r}`)
}

// ========== 地图属性 (来自实际游戏规则/地图) ==========


/** 布雷斯特港 */
export const BREST_HEX = 'F7'
export const GERMAN_START_HEXES = ['A5', 'A6', 'B7']

/** 运输航路格 */
const SEA_ROUTE_HEXES = new Set<string>([
  'D2', 'D3', 'C4', 'C5',  // 大西洋航路
  'E4', 'E5',               // 非洲航路
])

/** 港口格 */
const PORT_HEXES = new Set<string>([
  'F7', 'D8', 'G6',
])

// ========== 公开接口 ==========

/** 陆地格 (完全不可进入) */
const LAND_HEXES = new Set<string>([])

/** 被阻断的边 (两个相邻格之间不可通行, 英国本土隔断) */
const BLOCKED_EDGES = new Set([
  'D6-D7', 'D7-D6',
  'E5-E6', 'E6-E5',
  'E6-D7', 'D7-E6',
  'E6-F7', 'F7-E6',
  'E6-E7', 'E7-E6',
])

export function isLand(coord: HexCoord): boolean {
  const label = hexToLabel(coord)
  if (!label) return true
  return LAND_HEXES.has(label)
}

/** 两个邻格之间是否被阻断 */
export function isBlocked(a: HexCoord, b: HexCoord): boolean {
  const la = hexToLabel(a); const lb = hexToLabel(b)
  if (!la || !lb) return true
  return BLOCKED_EDGES.has(`${la}-${lb}`)
}

export function isPort(coord: HexCoord): boolean {
  const label = hexToLabel(coord)
  return label ? PORT_HEXES.has(label) : false
}

export function isSeaRoute(coord: HexCoord): boolean {
  const label = hexToLabel(coord)
  return label ? SEA_ROUTE_HEXES.has(label) : false
}

export function isBrest(coord: HexCoord): boolean {
  return hexToLabel(coord) === BREST_HEX
}

export function getHexCell(coord: HexCoord): HexCell | null {
  const label = hexToLabel(coord)
  if (!label) return null
  return { coord, label, isLand: isLand(coord), isPort: isPort(coord), isSeaRoute: isSeaRoute(coord) }
}

export function getAllHexCells(): HexCell[] {
  const cells: HexCell[] = []
  for (const [label, coord] of labelToCoord) {
    cells.push({ coord, label, isLand: isLand(coord), isPort: isPort(coord), isSeaRoute: isSeaRoute(coord) })
  }
  return cells
}

export function getAllLabels(): string[] {
  return Array.from(labelToCoord.keys())
}

export function getMapBounds(): { minQ: number; maxQ: number; minR: number; maxR: number } {
  let minQ = Infinity, maxQ = -Infinity, minR = Infinity, maxR = -Infinity
  for (const c of labelToCoord.values()) {
    if (c.q < minQ) minQ = c.q; if (c.q > maxQ) maxQ = c.q
    if (c.r < minR) minR = c.r; if (c.r > maxR) maxR = c.r
  }
  return { minQ, maxQ, minR, maxR }
}
