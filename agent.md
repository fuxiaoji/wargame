# 项目架构与工作流

## 项目概述

《击沉俾斯麦号》是一个双盲兵棋推演 AI 研究平台。工程目标不是只做一个可玩游戏，而是形成完整 AI 研究链路：

```text
状态机 AI baseline
→ 朴素 RL baseline
→ Transformer RL
→ Belief/Intent/Utility 论文新架构
```

当前实现阶段：**Stage 1 朴素 RL baseline**。

## 项目结构

```text
wargame/
├── bismarck/               TypeScript 引擎 + React GUI
│   ├── engine/             游戏规则、环境、张量导出
│   ├── cli/                状态机、评估、RL 数据生成
│   ├── src/                React 入口
│   └── ui/                 前端组件
├── cppre/                  C++ 高速训练/锦标赛引擎
├── deeplearn/              深度学习数据与训练管线
│   ├── agent.md            RL Tensor v3 说明
│   ├── read_log.py         张量日志读取
│   ├── global_log.py       双视角日志
│   └── data/
│       ├── archive_buggy/  旧 bug 数据归档，不进入训练
│       ├── training_v9..   状态机分析材料
│       └── rl_tensor_v3/   新 RL 数据
└── text/                   设计文档、报告、参考文献
```

## 双引擎架构

| | TS 引擎 | C++ 引擎 |
|---|---|---|
| 位置 | `bismarck/` | `cppre/` |
| 用途 | GUI、调试、RL v3 数据生成 | 高速锦标赛、状态机训练 |
| 要求 | 规则必须保持一致 | 规则必须保持一致 |

修改游戏规则时必须同步两边，否则训练数据和前端行为会分裂。

## 当前 AI 路线

### Stage 0: 状态机基线

状态机 AI 是当前最成熟 baseline：

- V11 状态机强者
- 严父 AI
- 默认状态机
- 乱打 AI

这些 AI 用于评估池和 RL 数据生成。

### Stage 1: 朴素 RL baseline

当前阶段只做：

```text
state[t] [128,8,6]
→ CNN
→ MLP
→ policy[128] + value
```

不做 Transformer，不做 EUA。目标是先得到可信 RL baseline。

### Stage 2-3: 后续论文架构

Stage 2 引入 Transformer 历史窗口。
Stage 3 引入 Belief、Intent、Utility/EUA 可解释模块。

## RL Tensor v3

最终标准数据格式：

```text
state.bin    [73,128,8,6]
mask.bin     [73,16,128]
action.bin   [73,16,8]
target.bin   [73,10]
result.json
```

73 是阶段级时间轴：初设 1 槽 + 18 回合 × 4 阶段。阶段内逐船动作写入 16 个 unit slot。

生成入口：

```bash
npx tsx bismarck/cli/generate-rl-tensor-v3.ts \
  --games 100000 \
  --out deeplearn/data/rl_tensor_v3/raw \
  --progress-every-sec 10
```

长时间生成或训练必须使用可见进度输出。`generate-rl-tensor-v3.ts` 会按固定间隔打印完成局数、速度、ETA、胜负与截断统计。

旧 bug 数据已归档到 `deeplearn/data/archive_buggy/`，不得用于训练。

## 工作流

开始任务前：

1. 阅读 `todo.md`
2. 阅读 `bug.md` 与 `deeplearn/bug.md`
3. 阅读相关 `text/` 设计文档

修改 AI 前：

1. 查论文和成熟方案
2. 更新 `text/参考文献.md`
3. 写计划文档
4. 保留 baseline 和对比验证

提交前：

1. 不提交 API 密钥
2. 不提交无说明的大型训练产物
3. 数据格式、奖励函数、动作空间变更必须同步文档

## 常用命令

```bash
# 前端
cd bismarck && npm run dev

# 状态机评估
npx tsx bismarck/cli/rank-state-machines.ts 6

# 生成 RL Tensor v3 小样本
npx tsx bismarck/cli/generate-rl-tensor-v3.ts --games 10 --out /tmp/rl_tensor_v3 --progress-every-sec 5

# Stage 1 朴素 RL 行为克隆
python3 deeplearn/train_rl_baseline.py --data deeplearn/data/rl_tensor_v3/raw --out deeplearn/checkpoints/rl_baseline_stage1.pt

# C++ 锦标赛
cd cppre && g++ -std=c++20 -O3 tournament.cpp -o tournament
./tournament 10 20 50 10 ../deeplearn/data/training_v11
```
