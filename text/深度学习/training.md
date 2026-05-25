# 击沉俾斯麦号 — 演化训练流水线

## 快速开始

```bash
# 50 代训练 (10×10 种群, 每对 100 局, 共 10,000 局/代)
npx tsx cli/tune-weights.ts 50 10 100

# Ctrl+C 中断 → 自动保存 checkpoint
# 再次运行 → 从断点恢复
npx tsx cli/tune-weights.ts
```

## 架构

```
双种群共演化:

德军种群 (10个体)          英军种群 (10个体)
w1..w15 各不同            s1-s3, h1-h3, d1-d3 各不同
     │                          │
     └── 循环赛: 100对 × 100局 ──┘
     │                          │
  排名 (胜率 - 多样性惩罚)   排名 (胜率)
  保留 Top3 + 多样性下限     保留 Top3
  变异产生 7 个新个体         变异产生 7 个新个体
     │                          │
     └────── 下一代 ────────────┘
```

## 参数说明

| 参数 | 默认 | 说明 |
|---|---|---|
| `GENERATIONS` | 50 | 演化代数 |
| `POP_SIZE` | 10 | 每个种群的个体数 |
| `GAMES_PER_PAIR` | 100 | 每对打多少局 (50德+50英) |
| `TOUR_DIR` | `tournament/` | 输出目录 |

## 德军决策得分函数

每步重新计算，softmax 转概率，加权随机采样。

```
RushBrest = w1×(1/(distToF7+1)) + w2×(steps/4) + w3×(1-britNearF7/5) - w4×(found?2:0)
FarmRoutes = w5×(onRoute?1:0) + w6×(1-vp/6) + w7×(found?0:1) + w8×(nearRoutes/total)
HuntShips = w9×isolatedTargets + w10×(atk-targetDef) - w11×nearbyBritish
HideDeep = w12×(found?1:0) + w13×(steps<2?1:0) + w14×proximity + w15×(1-vp/6)
```

**船特定修正**:

| 权重 | 俾斯麦 | 欧根 |
|---|---|---|
| RushBrest | +2 | -2 |
| FarmRoutes | 0 | +1 |
| HuntShips | -3 | +3 |
| HideDeep | +1 | 0 |

## 英军决策得分函数 (每船独立)

```
Search = s1×(!found) - s2×unseenTurns - s3×germanVp/2
Hunt = h1×(found?1:0) + h2×(5/(distToLast+1)) + h3×fleetAdvantage
Defend = d1×(gerNearF7?1:0) + d2×(vp>=4?1:0) + d3×(4-shipsNearF7)/4
```

## 多样性保持

```
个体最终得分 = avgWinRate - 0.1 × Σⱼ KL(strategy_i || strategy_j)
淘汰时确保每种策略至少保留 1 个代表
```

## 断点续训

每代结束后保存 `tournament/checkpoint.json`。Ctrl+C 中断后再次运行自动恢复。

## 输出目录

```
tournament/
├── checkpoint.json
├── summary.json
├── gen_000/   {ger_population, brit_population, stats}.json
├── gen_001/   ...
└── viz/       (运行 visualize_evo.py 后生成)
    ├── winrate.png
    ├── diversity.png
    ├── strategy.png
    ├── weights.png
    └── heatmap_sample.png
```

## 可视化

```bash
python3 deeplearn/visualize_evo.py tournament/
```

## 生成训练数据

演化结束后，用最优权重批量生成训练数据：

```bash
# 用 C++ 引擎生成 10 万局 (高速)
cd cppre && g++ -std=c++20 -O2 tournament.cpp -o tournament
./tournament --ger-weights tournament/summary.json:bestGer \
             --brit-weights tournament/summary.json:bestBrit \
             --games 100000 --output ../deeplearn/data/training/

# 或用 TS 引擎生成
npx tsx cli/generate-data.ts --games 10000
```
