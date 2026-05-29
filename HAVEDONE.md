# 击沉俾斯麦号 — 开发全纪录

## 时间线

### 2026-05 上旬：游戏引擎 & 基础 AI

- [x] 六角格地图引擎（A1-F8, 42格, 奇偶列偏移）
- [x] 德军（俾斯麦+欧根亲王）vs 英军（11真船+4伪装）双人棋盘
- [x] 移动/索敌/战斗/运输攻击/胜利判定完整规则
- [x] React 前端：HexMap canvas 渲染, 算子/Q版小人双模式
- [x] LLM AI 对接（DeepSeek API, 低/高级模式）
- [x] **状态机 AI 第一版**：热力图 + 策略概率 + 加权随机
  - 德军 4 策略：Rush(冲港) / Farm(打工) / Hunt(猎杀) / Hide(躲藏)
  - 英军 3 策略：Search(搜索) / Hunt(追猎) / Defend(防守)
  - 26 个可训权重参数

### 2026-05 中旬：训练框架

- [x] C++ 高速锦标赛引擎（多线程, ~500局/秒）
- [x] 双种群共演化：德军种群 × 英军种群 循环赛
- [x] MAP-Elites 5×5 网格多样性保持（Mouret & Clune 2015）
- [x] 进化策略变异（高斯噪声, annealing）
- [x] 时空张量格式 [73,128,8,6] 设计（AlphaStar/AlphaZero 参考）
- [x] V1 训练（KL only, 10×10×100, 20代）
- [x] V2 训练（MAP-Elites, 同上参数）
- [x] 个体评估 + presets + 前端集成

### Bug 修复历程（按发现顺序）

1. **英军初设 BFS 坐标 off-by-one**：`parseInt(label.slice(1))-1` 与 `HexCoord.r`（实际行号）不一致。修复：全部替换为 `getGermanReachableLabels()`

2. **C++ hunt 得分 w9 从未生效**：硬编码 `w.w9*0`。修复：加回 `isolatedTargets` 计算

3. **英军固定位置舰船被忽略**：BRITISH_FIXED_POSITIONS（C6/D6/F4/F1 共7艘）未在初设中归位。修复：先放固定船，再放自由船

4. **德军热力图透视**：`addBritishShips` 区分真船(+2)和伪装(+0.5)，德军"知道"哪个是假的。修复：统一权重，德军所见均为 `?`

5. **blockHexes 全策略共享 → 所有船跑向 F7**：`D8,E7,F6,D7,C7,C6,D6` 对所有策略加 -2。修复：移除共享，每种策略独立热力

6. **航空索敌无限循环**：`doAirSearch` 未检查 `airSearchDone`。修复：引擎层加保护 + AI 层 stuck 检测

7. **Defend 过早触发**：turn≥5 就开始加分，F7=-10 太强。修复：阈值提高（turn≥8, VP≥5），F7=-6

8. **地图位置不刷新**：`useGame` 返回 `game.state` 可变引用。修复：返回 `useState` spread 副本

9. **C++ 防御得分 d2 阈值不一致**：C++ `vp>=4` vs TS `vp>=5`。修复：统一为 vp>=5

10. **德军初设格（A5/A6/B7）被英军部署**：BFS 邻居访问导致起始格进入 reachable。修复：`used` Set 预填 GERMAN_START_HEXES

### 2026-05 下旬：V3 训练 & 英军改进

- [x] V3 训练（20×20×50, 20代, bug 环境）
  - 结果：训练内 50-50 死锁，对外德军 0% 胜率
  - 根因：共演化在 bug 环境下产生极端特化
- [x] **英军 Patrol 策略**：第4策略，p1-p3 权重，蹲航路+德军路径
- [x] 搜索扩散半径修正：`turnsSinceSeen*2`（德军实际速度）
- [x] Search 船间排斥(+2)分散 / Hunt 船间吸引(-2)抱团
- [x] 删除德军出生点吸引（无信息量）

### V4 训练 & 交叉评估

- [x] V4 训练（10×20×50, 10代, 修复版引擎, 变异 50%/scale 6.0）
  - 德军 51%→30%, 英军最终 69%
  - 7.0GB 张量数据（5 级采样）
- [x] **消融实验：Patrol 有效性**
  - 有 Patrol vs 无 Patrol: 英军 +18% 胜率 ✅
- [x] **四代交叉评估**（V1-V4, 8 组 × 10 局, 120MB 张量）
  - V4 英军 vs V2/V3 英军: 德军胜率从 90%→50%（巨大进步）
  - V4 德对 V4 英: 50% 均势

### 调试模式

- [x] SM 调试：热力图叠加（蓝=引力, 红=斥力）
- [x] 策略得分面板：柱状图 + 概率
- [x] 舰船列表点击切换热力图
- [x] 阶段前快照：先展示决策再执行
- [x] 德军推演热力图（人玩英军时）
- [x] 基础热力图（人玩德军时, 三圈扩散）

### 热力图传播研究

- [x] 文献调研（MAP-Elites, Influence Map, Potential Field, Co-evolution）
- [x] 距离衰减传播实现：`propagated = Σ v/(1+dist)²`
- [x] 4 模式 × 16 组合交叉验证（4000 局）
  - 仅负值×仅负值：42%（最优, +3% vs 基准 39%）
  - 全传播害德军（35%, -4%）
  - 仅正值无效（37-39%）
- [x] 结论：bolt-on 效果有限，需要 V5 训练时原生支持

### 2026-05-29：RL Tensor v3 & Stage 1 朴素 RL

- [x] 明确论文递进路线：普通状态机 baseline → 朴素 RL baseline → Transformer RL → Belief/Intent/Utility 新架构
- [x] 固定阶段级张量格式：`state.bin [73,128,8,6]`、`mask.bin [73,16,128]`、`action.bin [73,16,8]`、`target.bin [73,10]`、`result.json`
- [x] 固定 128 动作空间：0-47 移动、48-95 航空索敌、96 finish-phase、97 combat、98 transport、99-127 保留
- [x] 旧 bug 数据归档到 `deeplearn/data/archive_buggy/`，退出 RL 训练链路
- [x] 新增 `bismarck/engine/tensor-v3.ts`，实现 RL Tensor v3 导出
- [x] 新增 `bismarck/cli/generate-rl-tensor-v3.ts`，用修复后的 TS 环境生成新数据
- [x] 长时间数据生成加入可见进度：完成局数、百分比、速度、ETA、胜负、截断
- [x] 新增 `deeplearn/check_rl_tensor_v3.py`，校验 shape、mask、合法动作、隐藏信息泄露
- [x] 修复德军视角 Ark Royal 航空覆盖泄露风险
- [x] 新增 `deeplearn/analyze_rl_tensor_v3.py`，输出胜负比例、胜利类型、来源覆盖、reward/return 分布
- [x] 新增 `deeplearn/train_rl_baseline.py`，实现 Stage 1 CNN+MLP policy/value 行为克隆入口
- [x] 修正 exporter 时间语义：73 个阶段槽，阶段内 16 个单位动作槽；TS 引擎原子动作不再挤占时间轴
- [x] 完成阶段级多 slot smoke test：3 局生成、校验、质量分析通过，`truncated=0`
- [x] 重新生成仓库内 `deeplearn/data/rl_tensor_v3/raw` 5 局阶段级小样本：德军 2 胜、英军 3 胜、`truncated=0`，F7/6VP/击沉/18 回合胜利类型均出现
- [x] 创建项目虚拟环境 `.venv`，安装 Stage 1 训练依赖：numpy、torch、tqdm
- [x] 新增 `deeplearn/requirements.txt` 固定 Python 依赖
- [x] 完成 Stage 1 行为克隆 smoke 训练：1005 个 `[t,slot]` 样本，MPS 设备，1 epoch，保存 `deeplearn/checkpoints/rl_baseline_stage1_smoke.pt`
- [x] 启动 Terminal 实时进度窗口，生成 1,000 局 `deeplearn/data/rl_tensor_v3/trial_1000`
- [x] 发现并修复 exporter 快照引用 bug：tensor step 现在保存当时 GameState 深拷贝，不再引用最终可变状态
- [x] 发现并修复 Ark Royal 被击沉后仍写航空覆盖的通道泄露风险；清洗本批数据中 37 个错误 ch47 阶段
- [x] 1,000 局试生产通过校验：德军 422 胜、英军 578 胜、`truncated=0`、`warnings=[]`
- [x] 1,000 局胜利类型覆盖：6VP 148、18 回合 527、F7 274、击沉 51
- [x] 完成 `trial_1000` 行为克隆训练：238,502 个 `[t,slot]` 样本，8 epochs，保存 `deeplearn/checkpoints/rl_baseline_stage1_trial1000.pt`
- [x] `trial_1000` 行为克隆结果：epoch 8 train_acc 0.402，val_acc 0.386，train_loss 1.790，val_loss 1.837

## 技术栈

| 技术 | 参考 | 用途 |
|------|------|------|
| MAP-Elites | Mouret & Clune 2015 | 训练多样性 |
| Influence Map / Potential Field | Adaixo 2014, Tozour 2001 | 热力图决策 |
| Evolutionary Strategies | Schwefel 1995, Beyer 2002 | 权重变异 |
| Softmax 探索 | Sutton & Barto 2018 | 策略选择 |
| Distance-weighted propagation | Xu & Verbrugge 2025 | 热力图改进 |

## 关键数据

| 训练 | 代数 | 种群 | 局数 | 德军 | 英军 | 备注 |
|------|------|------|------|------|------|------|
| V1 | 20 | 10×10 | 20万 | ~55% | ~45% | KL only, 趋同 |
| V2 | 20 | 10×10 | 20万 | ~49% | ~51% | MAP-Elites |
| V3 | 20 | 20×20 | 40万 | ~50% | ~50% | bug 环境, 死锁 |
| V4 | 10 | 20×20 | 20万 | 30% | 69% | 修复版, patrol |

## 文件索引

```
bismarck/          — TypeScript 前端 + CLI
  src/App.tsx      — 主组件（SM/LLM AI, 调试, 热力图）
  cli/state-machine.ts — 状态机 AI（4德+4英策略, 29参数）
  cli/tune-weights.ts  — TS 训练器
  cli/cross-eval.ts    — 交叉评估
  cli/ablation-*.ts    — 消融实验
  engine/           — 游戏引擎
cppre/             — C++ 高性能引擎
  tournament.cpp    — 训练主程序（MAP-Elites, 张量记录）
  state_machine.hpp — C++ 状态机
deeplearn/         — 数据 & 可视化
  data/training_v1..v4/ — 训练产出
text/              — 文档
  参考文献.md        — 论文 & 技术文献
  v4_cross_report.md  — V4 交叉评估报告
  heatmap_propagation_report.md — 热力图传播报告
  bug.md            — Bug 记录
CLAUDE.md          — Agent 工作流
```
