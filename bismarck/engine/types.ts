// ========== 坐标系统 ==========

/** 六角格轴向坐标 (q 列, r 行) */
export interface HexCoord {
  q: number
  r: number
}

// ========== 舰船 ==========

export type ShipSide = 'german' | 'british'

/** 舰船定义 (静态属性) */
export interface ShipDef {
  id: string
  name: string
  side: ShipSide
  attack: number       // 攻击力 = 投骰数
  defense: number      // 防御力 = 目标值
  maxSteps: number     // 最大 Step (1, 2, or 4 for Bismarck)
  speed: number        // 移动力 (格数)
  isCarrier: boolean   // 是否可航空索敌
  isDummy: boolean     // 是否伪装算子
}

/** 舰船运行时状态 */
export interface ShipState {
  def: ShipDef
  steps: number        // 当前剩余 Step (0 = 沉没)
  revealed: boolean    // 是否已翻开 (英军)
  moveTarget: HexCoord | null  // 本周已选择的移动目标
  _prevPos?: HexCoord  // 悔棋用: 移动前的位置
}

// ========== 地图 ==========

export interface HexCell {
  coord: HexCoord
  label: string        // 格号，如 "A5"
  isLand: boolean      // 陆地格 (不可进入)
  isPort: boolean      // 港口格
  isSeaRoute: boolean  // 运输航路格
}

// ========== 游戏状态 ==========

export type Phase =
  | 'setup-german'        // 德军选起始格
  | 'setup-british'       // 英军摆子
  | 'german-move'         // 德军隐藏移动
  | 'british-move'        // 英军移动
  | 'british-search'      // 英军索敌
  | 'combat'              // 战斗结算
  | 'transport-attack'    // 攻击运输舰队
  | 'game-over'

export interface GameState {
  // 舰船
  germanShips: ShipState[]
  britishShips: ShipState[]

  // 位置 (shipId → HexCoord)
  germanPositions: Map<string, HexCoord>
  britishPositions: Map<string, HexCoord>

  // 回合与阶段
  turn: number           // 1-18
  phase: Phase
  phaseStep: number      // 当前阶段内的子步骤

  // 分数
  vp: { german: number; british: number }

  // 状态标记
  bismarckFound: boolean
  combatPending: boolean
  transportPending: boolean

  // 本回合德军位置是否公开 (伪装鉴定失败后)
  germanPositionPublic: boolean

  // 伪装鉴定失败需要跟随德军的伪装算子 ID
  failedDummies: Set<string>

  // 本回合已移动过的舰船
  movedThisTurn: Set<string>

  // 本回合是否已执行航空索敌（每回合限一次）
  airSearchDone: boolean

  // 运输攻击信号泄露暴露的位置（英军移动阶段可见）
  transportRevealedHex: string | null

  // 终局
  gameOver: boolean
  winner: ShipSide | null
  victoryReason: string
}
