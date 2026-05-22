# Agent 架构与张量规范 (双 C++/TS 兼容)

## 1. 输入张量: `[73, 128, 8, 6]`

### 1.1 维度

| 轴 | 大小 | 含义 |
|---|---|---|
| Time | 73 | 18回合×4阶段 + 1部署 = 73 步 |
| Channel | 128 | 见下方 5 个 Block |
| Height | 8 | 行 1-8 (A-F 列从上到下) |
| Width | 6 | 列 A-F (q=0..5) |

### 1.2 128 通道分配

#### Block 1: 静态地理与全局态势 (Ch 0-15, 双方可见)
```
Ch 0: Navigable_Mask    可通行海域=1, 陆地=0
Ch 1: Convoy_Routes     运输航路格=1 (D2,D3,C4,C3,D5,E1,E4,E5)
Ch 2: Brest_Target      F7=1, 其余=0
Ch 3: German_Spawns     起始格 A5,A6,B7=1
Ch 4: Phase_GerMove     德军移动阶段=1
Ch 5: Phase_BritMove    英军移动阶段=1
Ch 6: Phase_BritSearch  索敌阶段=1
Ch 7: Phase_Combat      战斗/运输阶段=1
Ch 8: Turn_Progress     当前回合/18.0 (铺满全图)
Ch 9: VP_British        英军VP/6.0 (铺满)
Ch10: VP_German         德军VP/6.0 (铺满)
Ch11-15: Reserved       预留: 距离场等
```

#### Block 2: 英军实体 (Ch 16-47, 德军视角清零)
```
每船 4 通道 [位置(0/1), HP_norm, Atk_norm, Locked(1=禁步)]
Ch16-19: Hood          胡德号
Ch20-23: PrinceOfWales 威尔士亲王号
Ch24-27: ArkRoyal      皇家方舟号
Ch28-31: Generic_2Step 其他 2-Step 舰聚合
Ch32-35: Generic_1Step 其他 1-Step 舰聚合
Ch36-39: Dummy         伪装算子 (位置=1, HP=1, 攻=0, 移=3)
Ch40:    Brit_Anon_Pos 专供德军: 叠加所有背面算子位置
Ch41-47: Reserved
```

#### Block 3: 德军实体 (Ch 48-63, 英军视角清零)
```
每船 4 通道 [位置, HP, 攻, 移动力]
Ch48-51: Bismarck
Ch52-55: PrinzEugen
Ch56-63: Reserved
```

#### Block 4: 战场事件与遗迹 (Ch 64-95)
```
Ch64: Event_CombatReveal  同格索敌暴露坐标=1
Ch65: Event_RadarReveal   航空侦察发现坐标=1
Ch66: Event_ConvoyReveal  运输信号泄露坐标=1
Ch67: Event_DummyKill     伪装鉴定移除坐标=1
Ch68: Fog_Cleared         索敌未发现格=1
Ch69-79: Ger_Pheromone    德军历史轨迹衰减 (t-1=1.0, t-2=0.8, ...)
Ch80-95: Reserved
```

#### Block 5: 认知草稿区 (Ch 96-127, 网络内部使用)
```
Ch96:  Belief_State_B  预测俾斯麦位置概率 (仅英军)
Ch97:  Intent_State_Pi 预测敌方行动概率
Ch98-127: Hidden_Context Transformer隐状态映射预留
```

---

## 2. 不对称掩码逻辑

### 2.1 英军视角 O_brit
```
O_brit = S_global.copy()
O_brit[:, 48:64] = 0.0   # 掩盖德军实体 (Block 3)
O_brit[:, 69:80] = 0.0   # 掩盖德军历史轨迹 (除非暴露)
```

### 2.2 德军视角 O_ger
```
O_ger = S_global.copy()
O_ger[:, 16:40] = 0.0    # 掩盖英军身份 (Block 2 中 16-39)
                         # Ch40 Brit_Anon_Pos 保留 (匿名位置)
O_ger[:, 96:98] = 0.0    # 掩盖英军认知预测
```

---

## 3. 中间预测张量 (B 和 Π)

### 3.1 B — 位置信念矩阵
```
Shape: [8, 6], float32, 每个格 ∈ [0,1]
含义: 英军预测俾斯麦在当前格的概率
Label: 上帝视角真实位置 (one-hot)
Loss: CrossEntropy(B, true_pos)
```

### 3.2 Π — 敌方意图矩阵
```
Shape: [8, 6], float32, 每个格 ∈ [0,1]
含义: 预测敌方下一步移动到各格的概率
Label: 敌方下一步真实移动落点
Loss: CrossEntropy(Π, true_action_grid)
```

---

## 4. 输出动作张量

### 4.1 德军动作 50 维
```
[0:48]  Move_Target_Logits  移动目标格 (6×8 展平)
        Softmax + Mobility_Mask(BFS可达格置0,其余-1e9)
[48:50] Transport_Decision   [不攻击, 攻击]

仅在 transport_attack 阶段激活 [48:50]
```

### 4.2 英军动作 528 维
```
10 个编队 × 48 维移动落点 = 480 维
  [0:48]    胡德号
  [48:96]   威尔士亲王号
  [96:144]  皇家方舟号
  [144:336] 其他战舰×4组
  [336:480] 伪装算子×4组

[480:528]  航空索敌目标 (48维)
  仅在搜索阶段激活。Radar_Mask(邻格=0,其余-1e9)
```

### 4.3 非法动作掩码生成 (Engine)
```
Mobility_Mask(ship, from):
  可达 = BFS(from, speed) ∪ {from(不动)}
  掩码: 可达格→0, 其余→-1e9

Lock_Mask(ship):
  发现俾斯麦前被锁定的船: 仅当前格=0, 其余=-1e9
```

---

## 5. 二进制张量日志格式

### 5.1 文件结构
```
game_000001/
  state.bin    [73, 128, 8, 6] float32 LE  (约 1.8 MB)
  action.bin   变长记录
  result.json  {"winner":"british","vp_german":2,"vp_british":0,"turns":18}
```

### 5.2 state.bin 格式
```
Offset  Size    Content
0       4       magic: 0x42534D42 ("BSMB")
4       4       time_steps (73)
8       4       channels (128)
12      4       height (8)
16      4       width (6)
20      N       数据: time × chan × row × col, float32 LE, C-order
```
总大小 = 20 + 73 × 128 × 8 × 6 × 4 = 1,794,068 字节

### 5.3 action.bin 格式 (每步记录)
```
step_index:   uint8   (0-72)
phase:        uint8   (0-7)
side:         uint8   (0=german, 1=british)
action_count: uint8   本步动作数量
action_type:  uint8   (0=move, 1=finish, 2=air_search, 3=combat, 4=transport)
ship_id:      uint8   (船舶编号, 无则为0)
target_q:     int8    (目标列 0-5, 无则为-1)
target_r:     int8    (目标行 1-8, 无则为-1)
每步 8 字节定长
```

### 5.4 result.json
```json
{
  "game_id": "game_000001",
  "winner": "british",
  "vp_german": 2,
  "vp_british": 0,
  "turns": 18,
  "bismarck_sunk": false,
  "brest_reached": false,
  "total_steps": 312,
  "seed": 42
}
```

---

## 6. 引擎侧实现接口

### 6.1 C++ (cppre/tensor_logger.hpp)
```cpp
// 在每个时间步填充当前切片
void fillStateSlice(float* slice_128x8x6, const GameState& state, ShipSide viewer);

// 写入整局日志
void writeGameLog(const std::string& dir,
    const std::vector<float>& state_tensor,    // [73*128*8*6]
    const std::vector<uint8_t>& action_records, // 73*8 bytes
    const GameResult& result);
```

### 6.2 TS (bismarck/engine/tensor.ts)
```typescript
// 同接口，TypeScript 实现
function fillStateSlice(state: GameState, viewer: ShipSide): Float32Array  // [128*8*6]
function writeGameLog(dir: string, stateTensor: Float32Array, actions: Uint8Array, result: any): void
```

### 6.3 Python (deeplearn/tensor.py)
```python
def read_state_tensor(path: str) -> np.ndarray   # [73, 128, 8, 6]
def read_action_log(path: str) -> list[dict]      # 步骤列表
def apply_mask(state: np.ndarray, side: str) -> np.ndarray  # 不对称掩码
```

---

## 7. 训练数据生成流水线

```
C++ 引擎 (高速) / TS 引擎 (可复现)
    │
    ▼ 每局输出 state.bin + action.bin + result.json
    │
data/random/     (10万局随机)
data/heuristic/  (10万局启发式)
data/selfplay/   (RL训练中自对弈)
    │
    ▼ PyTorch DataLoader
    │
预训练 (Phase 2) → RL微调 (Phase 4)
```
