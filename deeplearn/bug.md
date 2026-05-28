# 训练 Bug 记录

## Bug 0: 英军信息泄漏 (V1-V6 全程存在, 2026-05-25 修复)

**严重程度**: 🔴 致命

`BritishBrain.handleMove` 用 `state.germanPositions.get('bismarck')` 获取德军实时坐标，条件 `(germanPositionPublic || bismarckFound)` —— 只要被发现过就永远知道精确位置。德军移动后位置仍泄漏。

另有 `germanNearF7` 和 hunt swarm 两处同样泄漏。

**修复**: 全部改为 `germanPositionPublic` 单独判断。仅伪装算子跟随导致位置公开时才使用实时坐标。

**影响**: V1-V6 所有训练结果都不可用。德军在完全暴露的情况下仍能拿到 ~50% 胜率，说明德国 AI 基础能力不弱。

## Bug 1: 共演化死锁 — 训练内 50-50，对外德军 0% 胜率

### 现象

V3 训练 20 代全程德军 49% vs 英军 50%，胜率几乎不动。训练完后交叉评估：所有德军个体（V1/V2/V3）对所有英军个体，德军 **0% 胜率**——一局没赢。

### 根因（三个叠加）

**1. 初设 BFS 坐标 off-by-one**

所有手写 BFS 用了 `parseInt(label.slice(1)) - 1` 计算行号，但 `HexCoord.r` 是实际行号（1-indexed）。导致 BFS 算出的可达格错位一行，英军被部署到德军根本走不到的格子上。训练时两边都用同样的错误初设，所以内部看起来均衡。

修复：全部替换为引擎自带的 `getGermanReachableLabels()`。

**2. blockHexes 全策略共享，全部指向 F7**

`blockHexes = ['D8','E7','F6','D7','C7','C6','D6']` 对所有英军策略加 -2 吸引。这些格全在 F7 附近，导致不管选 search/hunt/patrol/defend，所有船都被拉向同一片区域。德军冲港路上全是英军，一出门就被抓。

修复：blockHexes 移除，每种策略独立热力引导。

**3. 德军热力图透视**

`addBritishShips` 和 `addThreatRange` 没有迷雾检查，德军 AI 能看到所有英军算子位置（包括隐藏的）。英军集中在出生点附近时，德军热力图显示所有邻格都有排斥力，AI 选择原地不动。

修复：英军算子德军一视同仁（都是 `?`），不做区分。

### 教训

闭合种群共演化的红皇后效应：双方在彼此面前完美适应（50-50），但对外界完全特化。需要外部基准校验，不能只看内部胜率。

---

## Bug 2: 英军全部挤在 F7

### 现象

英军 AI 所有船聚集在 F7 一格，不搜索也不巡逻。

### 根因

Defend 策略过早触发（turn≥5 就开始加分）且 F7 吸引力过强（-10）。加上 blockHexes 全策略共享的 F7 附近吸引，所有船都被拉向 F7。

修复：提高 Defend 触发阈值（turn≥8，VP≥3），F7 吸引从 -10 降到 -6，blockHexes 移到策略分支内。

---

## Bug 3: C++ hunt 得分 w9 从未生效

### 现象

C++ 版德军 hunt 得分硬编码 `w.w9 * 0`，w9 权重训练完全白费。

### 根因

C++ 翻译时漏掉了 `isolatedTargets` 的计算。

修复：加回孤立目标统计，`w.w9 * isolatedTargets`。

---

## Bug 4: 航空索敌无限循环

### 现象

英军 `british-search` 阶段无限航空索敌，phase 永远不推进。

### 根因

`doAirSearch` 没有检查/设置 `airSearchDone` 标志，引擎层缺少保护。

修复：引擎层加 `airSearchDone` 检查。AI 层加 stuck 检测强制推进。

---

## Bug 5: 地图位置不刷新

### 现象

回合阶段切换后舰船位置不更新，只有点选舰船后才刷新。

### 根因

`useGame.ts` 返回 `gameState: game.state`（可变对象引用），React 检测不到变化。

修复：改为返回 `useState` 的 spread 副本。

---

## Bug 6: 扩散圈线性梯度而非均匀 (V1-V8, 2026-05-26 修复)

**严重程度**: 🔴 致命

英军基图扩散公式为 `-(radius - dist) * britDiffuseStr`，产生从中心到边缘的**线性衰减梯度**。中心格吸引力最强（如 -2.0），边缘格趋零。

但德军战舰速 2，在扩散半径内所有格等概率可达。正确的逻辑应该是**半径内均匀**引力。

**修复**: `hm.add(r, c, -this.w.britDiffuseStr)` — 所有半径内格统一引力值。

**影响**: V1-V8 训练时英军密度分布始终偏向中心（出生点/目击点），未曾正确搜索德军移动后的整个可能区域。

---

## Bug 7: turnsSinceSeen 按船移动计数而非回合 (V1-V8, 2026-05-26 修复)

**严重程度**: 🔴 致命

`turnsSinceSeen++` 在 `BritishBrain.handleMove` 中每艘英军船移动时执行一次（15 艘船 = 每回合 +15）。扩散半径 `turnsSinceSeen * 2` 在第一回合就飞到 30+（clamp 到 8），全图扩散，梯度几乎平坦。

**修复**: 改为 `lastSeenTurn` 记录目击回合号，`turnsSinceSeen = state.turn - lastSeenTurn`（回合级，非船级）。检测 `lastSightingHex` 变化时更新 `lastSeenTurn = state.turn - 1`（目击发生在上一回合索敌阶段）。

**影响**: V1-V8 训练时英军从第一回合起就全图搜索，无聚焦能力。德军冲港路线几乎无阻碍。

---

## Bug 8: lastKnownGermanPos 不回退 lastSightingHex (V1-V8, 2026-05-26 修复)

**严重程度**: 🔴 致命

`lastKnownGermanPos` 仅在 `germanPositionPublic=true`（伪装鉴定失败）时赋值。正常同格索敌/航空索敌设置 `lastSightingHex` 后，该字段不更新。

导致三个策略组件永久失效：
- `germanNearF7` 永远返回 false → defend 策略不触发
- `inGermanRange` 永远返回 false → patrol 策略的 `p2` 加成失效
- hunt 中心强引力 (`britHuntCenter=-6`) 永远不激活

**修复**: `lastSightingHex` 变化时自动更新 `lastKnownGermanPos`，以上三个判断全部随之生效。

**影响**: V1-V8 英军 defend/patrol/hunt 的核心引力机制全部瘫痪，仅靠弱扩散基图索敌。

---

## Bug 9: C++ 英军 5 个热力系数硬编码未接入 (V8, 2026-05-26 修复)

**严重程度**: 🟡 中等

C++ `state_machine.hpp` 中 `britDiffuseStr/britPatrolPull/britDefendPull/britHuntCenter/britSearchRepel` 在 Weights 结构体中定义、变异、进化，但代码中用的是硬编码字面量（0.25, 3, 6, 6, 2）。训练出的值是随机噪声。

**修复**: 5 处硬编码替换为 `w.britXxx`。

**影响**: V8 这 5 个权重形同虚设，进化无意义。V8_BRITISH_BEST 也缺失这些字段（前端未加载时回退默认值）。

---

## Bug 10: App.tsx 英军 AI 使用德军权重 (所有版本, 2026-05-26 修复)

**严重程度**: 🟡 中等（仅前端）

`britW` 赋值后被丢弃，`createStateMachineAI(gerW)` 将德军权重同时赋予德英双方 AI。前端人机对战时英军行为完全错误。

**修复**: `createStateMachineAI` 新增 `britWeights` 参数，`britW` 正确传入。

**影响**: 用户在浏览器打的每一局，英军都在用德军冲港权重扮演防御方。

---

## Bug 11: F4 缺失于 patrol/farm 航路列表 (V1-V8, 2026-05-26 修复)

**严重程度**: 🟢 轻微

`isSeaRoute` 包含 F4（非洲航路），但 patrol/farm 硬编码航路引力列表遗漏了 F4。

**修复**: TS + C++ 航路列表加入 `'F4'`。

---

## Bug 12: 扩散半径未考虑俾斯麦受伤减速 (V1-V8, 2026-05-26 修复)

**严重程度**: 🟡 中等

扩散半径硬编码 `turnsSinceSeen * 2`，始终假设俾斯麦满速 2。俾斯麦受伤后航速降为 1，扩散圈应缩小一半。

**修复**: TS + C++ 扩散半径改用俾斯麦当前航速 `germanSpeed`（满血=def.speed, 受伤=speed-1, min 1）。

---

## Bug 13: hunt 梯度线性衰减 (V1-V8, 2026-05-26 修复)

**严重程度**: 🟡 中等

hunt 策略仍使用三层梯度 `dist<=1 → -britHuntCenter / dist<=huntRadius → -(4-dist*0.6) / 外围 +1`。与基图扩散同样问题：中心强边缘弱。

**修复**: 改为半径内均匀: `dist <= huntRadius → -britHuntCenter`。

---

## 改进方向 (待实现)

### I1: 策略选择应基于扩散圈置信度

当扩散圈小（近期目击、置信度高）→ 倾向铺开搜索(search/hunt)。当扩散圈大（久未目击、置信度低）→ 倾向守护固定目标(defend/patrol)。

避免 "船在啥也没有的地方搜寻" 的问题。
