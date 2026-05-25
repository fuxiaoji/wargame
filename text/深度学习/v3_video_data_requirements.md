# V3 视频数据需求

## 12段视频，每段需要的数据和可视化

### 段1: 标题 (0:00-0:25)
- **需要**: 棋盘静态图、标题文字叠加
- **数据**: 无需训练数据

### 段2: 游戏规则 (0:25-0:50)
- **需要**: 六角格地图标注 (F7/A5/A6/B7)、舰船位置图
- **数据**: 一局示例游戏的 state.bin (任意一局即可)

### 段3: 状态机大脑 (0:50-1:15)
- **需要**: 权重参数图表 (26个参数可视化)
- **数据**: DEFAULT_WEIGHTS + 某个体的权重值
- **tournament.cpp 保存**: ✅ 已有 (ger_population.json)

### 段4: 第0代 (1:15-1:40)
- **需要**: 第0代胜率、策略分布、随机游戏热力图
- **数据**: gen_000/stats.json, gen_000/ 中随机3-5局的 state.bin
- **tournament.cpp 保存**: ✅ 已有 (gen0 full dump + stats.json)

### 段5: 第1-5代初现策略 (1:40-2:10)
- **需要**: 胜率线图动画、策略堆叠图动画、热力图对比(gen0 vs gen5)
- **数据**: summary.json 的 gerWinHistory/britWinHistory/strategyHistory
- **tournament.cpp 保存**: ✅ 已有

### 段6: MAP-Elites多样性引擎 (2:10-2:40)
- **需要**: **5×5网格逐代填充动画**
  - 每代的网格状态: 哪些格被占据, 占据格的胜率/策略标签
  - 网格从稀疏到密集的过渡
- **数据**: **每代 MAP-Elites 网格快照** (哪些cell有代表, 每个cell的胜率)
- **tournament.cpp 保存**: ❌ **缺失!** 需要在 stats.json 中添加 grid_cells 字段

### 段7: 军备竞赛 (2:40-3:05)
- **需要**: 双线胜率图 + **权重轨迹图** (top3个体的 w1/s1/d1 随代数变化)
- **数据**: **每代 top-3 德军的权重** (要画 w1冲港/s1搜索/d1防守 三条轨迹)
- **tournament.cpp 保存**: ❌ **缺失!** 需要每代保存 top_weights.json

### 段8: 第19代巅峰 (3:05-3:30)
- **需要**: 最强个体对战回放 (标注策略标签)
- **数据**: elite/ 目录下的 state.bin (✅ 已有)

### 段9: 多样性vs质量 (3:30-3:50)
- **需要**: KL散度 vs 胜率 散点图
- **数据**: **每个个体的 KL散度 + 胜率** (每代)
- **tournament.cpp 保存**: ❌ **缺失!** 需要每代保存 individual_stats.json

### 段10: 意外发现 (3:50-4:15)
- **需要**: 特殊对局回放 (包围圈/诱饵等罕见行为)
- **数据**: close/ 和 random/ 中的 state.bin (✅ 已有)

### 段11: 总结 (4:15-4:45)
- **需要**: 统计数字叠加 (总局数/训练时间/胜率变化)
- **数据**: run_config.json + summary.json (✅ 已有)

### 段12: 致谢 (4:45-5:00)
- **需要**: 无额外数据

---

## 需要在 tournament.cpp 新增保存的数据

### 1. MAP-Elites 网格快照 (stats.json 扩展)
```json
"grid_cells": [
  {"r":0,"c":0,"occupied":true,"wr":0.52,"rush_pct":0.1,"farm_pct":0.1},
  ...
]
```
共 25 个 cell, 逐代保存到 stats.json

### 2. 每代个体统计 (新文件 individual_stats.json)
```json
[
  {"idx":0,"wr":0.52,"kl":3.5,"rush":120,"farm":200,"hunt":50,"hide":80},
  ...
]
```
20个德军个体, 用于 KL vs WR 散点图

### 3. 每代 Top-3 权重 (新文件 top_weights.json)
```json
{
  "top_ger": [
    {"idx":4,"wr":0.52,"weights":{w1:...,s1:...,d1:...}},
    ...
  ],
  "top_brit": [...]
}
```
用于权重轨迹动画

---

## 可视化脚本需要生成的帧/视频

| 输出文件 | 类型 | 数据来源 |
|---------|------|---------|
| winrate.mp4 | 动画 | summary.json |
| strategy_stack.mp4 | 动画 | summary.json |
| map_elites_grid.mp4 | 动画 | stats.json grid_cells |
| weights_trajectory.png | 静态 | top_weights.json |
| kl_vs_wr_scatter.png | 静态 | individual_stats.json |
| game_replay_frames/ | PNG序列 | elite/close state.bin |
| gen_dashboard_frames/ | PNG序列 | stats.json |
