# 分阶段 RL 训练路线

## 论文递进消融

训练路线按论文实验叙事拆成四阶段：

```text
Stage 0: 状态机 AI baseline
Stage 1: 朴素 RL baseline
Stage 2: Transformer RL
Stage 3: Belief/Intent/Utility 论文新架构
```

当前只实现 Stage 1，但数据格式已经按最终 `RL Tensor v3` 标准生成，后续阶段复用同一批高质量数据。

## Stage 0: 状态机基线

固定评估池：

- V11 状态机强者
- 严父 AI
- 默认状态机
- 乱打 AI

用途：

- 给 RL 训练提供行为克隆数据
- 作为后续所有阶段的评估基线
- 防止封闭自对弈过拟合

## Stage 1: 朴素 RL baseline

### 模型

```text
state[t] [128,8,6]
→ CNN encoder
→ MLP
→ policy[128] + value
```

不使用 RNN，不使用 Transformer，不使用 EUA。

### 数据生成

```bash
npx tsx bismarck/cli/generate-rl-tensor-v3.ts \
  --games 100000 \
  --out deeplearn/data/rl_tensor_v3/raw \
  --progress-every-sec 10
```

首批数据规模：10万-20万局。

长时间生成必须显示命令行进度，至少包含完成局数、速度、ETA、胜负计数和截断计数。当前生成器已支持 `--progress-every-sec`。

数据来源比例：

| 来源 | 比例 |
|---|---:|
| V11 状态机强者互打 | 35% |
| 状态机 vs 严父 | 25% |
| 状态机 vs 乱打 | 15% |
| 默认/弱状态机混合 | 10% |
| 随机扰动状态机权重 | 10% |
| 高质量局 fallback | 5% |

### 训练步骤

1. 行为克隆：用 `action.bin[t,slot] + mask.bin[t,slot]` 学合法动作分布。
2. 价值预训练：用 `target.bin` 的 return 字段训练 value head。
3. PPO 微调：对手池混入 RL checkpoint、状态机、严父、乱打。

当前 Stage 1 离线训练入口：

```bash
python3 deeplearn/train_rl_baseline.py \
  --data deeplearn/data/rl_tensor_v3/raw \
  --out deeplearn/checkpoints/rl_baseline_stage1.pt \
  --epochs 5 \
  --batch-size 256
```

该脚本实现 CNN+MLP policy/value、合法动作 mask、行为克隆损失和 value 损失，并输出 batch/epoch 进度。PPO 在线微调尚未接入，需要下一步实现 Python/TypeScript 环境桥接或独立 Python 环境。

### PPO 对手池

| 对手 | 比例 |
|---|---:|
| 当前 RL checkpoint | 40% |
| 历史 RL checkpoint | 20% |
| V11 状态机 | 20% |
| 严父 | 15% |
| 乱打 | 5% |

### 验收标准

- 能完整跑完 100 局，无非法动作死锁。
- 对乱打胜率显著高于随机。
- 对默认状态机接近 50%。
- 对 V11/严父仍有短板，作为 Stage 2 动机。

## Stage 2: Transformer RL

复用 `RL Tensor v3` 数据，引入历史窗口：

```text
state[t-k:t]
→ CNN encoder
→ Transformer
→ policy/value
```

目标：

- 证明历史序列能改善双盲追踪。
- 对比 Stage 1，显示长期记忆带来的增益。

验收：

- Transformer RL > 朴素 RL。
- belief top-k 预测优于单步模型。

## Stage 3: 论文新架构

在 Stage 2 基础上加入：

- Belief head：预测俾斯麦/欧根位置
- Intent head：预测敌方下一目标
- Utility/EUA：基于收益矩阵的可解释决策模块

目标：

- 新架构 > Transformer RL
- 输出可解释 belief/intent/utility 热力图
- 形成论文核心创新

## 奖励标准

奖励在数据生成阶段写入 `target.bin`。

### 德军

```text
+1.0 德军胜利
-1.0 德军失败
+0.10 德军新增 VP
-0.10 英军新增 VP
+0.05 靠近 F7
+0.05 靠近运输航路
-0.08 俾斯麦受伤
-0.05 位置公开/信号泄露
```

### 英军

```text
+1.0 英军胜利
-1.0 英军失败
+0.10 英军新增 VP
-0.10 德军新增 VP
+0.12 俾斯麦损失 step
+0.08 新发现俾斯麦
+0.04 靠近真实俾斯麦
-0.04 舰队过度拥挤
```

## 旧数据政策

旧 bug 数据归档到：

```text
deeplearn/data/archive_buggy/
```

它们不进入训练，只用于复盘。
