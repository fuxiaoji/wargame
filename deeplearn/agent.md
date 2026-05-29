# DeepLearn Agent: RL Tensor v3

## 项目定位

`deeplearn/` 是《击沉俾斯麦号》AI 研究管线。当前论文路线采用递进消融：

```text
状态机 AI baseline
→ 朴素 RL baseline
→ Transformer RL
→ Belief/Intent/Utility 论文新架构
```

当前只实现 Stage 1：朴素 RL baseline。数据格式必须一次性对齐最终标准，后续 Transformer 与论文新架构复用同一批高质量数据。

## 数据政策

旧 bug 环境数据不再进入训练链路，已归档到：

```text
deeplearn/data/archive_buggy/
```

`training_v9`、`training_v10`、`training_v11` 只作为状态机分析材料，不作为 RL 训练数据。新数据统一写入：

```text
deeplearn/data/rl_tensor_v3/
```

## RL Tensor v3 文件

每局一个目录：

```text
game_000001/
  state.bin    [73,128,8,6] float32 LE, 20-byte BSMB header
  mask.bin     [73,16,128] uint8
  action.bin   [73,16,8] uint8 fixed records
  target.bin   [73,10] float32 LE, RLT3 header
  result.json  metadata
```

v3 时间轴是阶段级：`0=初设`，18 回合每回合 4 槽。阶段内逐船动作写入 16 个 unit slot，所以状态机逐船决策不会挤占 73 个阶段槽。

## 128 通道分配

| 范围 | 内容 |
|---|---|
| 0-15 | 地图、阶段、回合、VP、当前行动方、公开状态 |
| 16-47 | 英军状态；德军视角隐藏未揭示身份 |
| 48-63 | 德军状态；英军视角隐藏未公开位置 |
| 64-79 | 索敌、航空、运输泄露、伪装、历史线索 |
| 80-95 | 当前行动单位与合法动作上下文 |
| 96-111 | F7、航路、危险、覆盖、收益等规则先验 |
| 112-127 | Belief/Intent/Utility 与论文新架构预留 |

训练输入只能读取 `state.bin` 与 `mask.bin`。`target.bin` 中允许保存上帝视角真相，只用于监督标签和评估。

## 动作空间

逐单位 128 动作：

```text
0-47   移动目标格
48-95  航空索敌目标格
96     finish-phase
97     combat
98     transport-attack
99-127 保留
```

所有训练都必须用 `mask.bin[t,slot]` 屏蔽非法动作，mask 全零的 slot 不参与 loss。

## 当前生成入口

```bash
npx tsx bismarck/cli/generate-rl-tensor-v3.ts \
  --games 100000 \
  --out deeplearn/data/rl_tensor_v3/raw \
  --progress-every-sec 10
```

长时间数据生成必须保留命令行进度：生成器会输出完成局数、百分比、速度、ETA、胜负计数和截断计数。正式 10万-20万局生成前先跑小样本和 1,000 局试生产。

默认 policy mix:

| 来源 | 比例 |
|---|---:|
| V11 状态机强者互打 | 35% |
| 状态机 vs 严父 | 25% |
| 状态机 vs 乱打 | 15% |
| 默认/弱状态机混合 | 10% |
| 随机扰动状态机权重 | 10% |
| 高质量局 fallback | 5% |

## 训练阶段

### Stage 1: 朴素 RL baseline

```text
state[t] [128,8,6]
→ CNN
→ MLP
→ policy[128] + value
```

先行为克隆新数据，再 PPO 微调。验收标准是超过乱打，接近普通状态机，并暴露无长期记忆的缺陷。

当前训练入口：

```bash
python3 deeplearn/train_rl_baseline.py \
  --data deeplearn/data/rl_tensor_v3/raw \
  --out deeplearn/checkpoints/rl_baseline_stage1.pt
```

脚本会显示 batch/epoch 进度。当前仓库环境未内置 PyTorch，运行训练前需安装 `torch`。

### Stage 2: Transformer RL

复用 v3 数据，引入历史窗口：

```text
state[t-k:t] → CNN encoder → Transformer → policy/value
```

目标是证明历史序列对双盲追踪有效。

### Stage 3: 论文新架构

加入 Belief、Intent、Utility/EUA 模块与可解释热力图输出。目标是超过 Transformer RL，并给出可解释的中间预测证据。
