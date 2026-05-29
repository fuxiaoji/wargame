# RL Tensor v3 与分阶段论文路线

## 核心原则

当前只实现朴素 RL，但数据格式一次性对齐最终论文架构：

```text
状态机 baseline
→ 朴素 RL baseline
→ Transformer RL
→ Belief/Intent/Utility 新架构
```

旧 bug 环境数据退出训练链路，统一归档到 `deeplearn/data/archive_buggy/`。

## 最终标准文件

```text
state.bin    [73,128,8,6] float32
mask.bin     [73,16,128] uint8
action.bin   [73,16,8] uint8
target.bin   [73,10] float32
result.json  metadata
```

73 个时间步是阶段槽，不是 TS 引擎微步：`0=初设`，每回合 4 槽，18 回合共 `1+18*4=73`。阶段内逐船/逐动作标签写入 16 个 action slot。

## 阶段使用方式

| 阶段 | 使用数据 | 模型 |
|---|---|---|
| Stage 1 | 单步 `state[t]` + mask/action/reward | CNN+MLP |
| Stage 2 | 历史窗口 `state[t-k:t]` | CNN+Transformer |
| Stage 3 | 历史窗口 + target 中的 belief/intent 标签 | Transformer+EUA |

## 新数据生成

```bash
npx tsx bismarck/cli/generate-rl-tensor-v3.ts \
  --games 100000 \
  --out deeplearn/data/rl_tensor_v3/raw \
  --progress-every-sec 10
```

首批目标 10万-20万局。先跑 1,000 局试生产，检查数据质量后再大批生成。

生成器必须输出可见进度。当前日志包含完成局数、百分比、速度、ETA、胜负计数和截断计数；长任务不要只使用原地刷新进度条。

2026-05-29 试生产状态：

- 20 局 `deeplearn/data/rl_tensor_v3/raw` 已生成并通过校验。
- 胜负比例：德军 10，英军 10。
- 阶段级多 slot exporter 已修正早期“微动作占用时间步”的问题，smoke test 中 `truncated=0`。
- 5 局阶段级 raw 小样本已重新生成并通过校验：德军 2 胜、英军 3 胜，`truncated=0`。
- 胜利类型：18 回合英军胜、F7 德军胜、6VP 德军胜、击沉胜利均已在小样本出现。
- 校验已覆盖：shape、合法 mask、英军视角德军隐藏信息、德军视角未揭示英军身份。
- 已修复：德军视角不得从 Ark Royal 航空覆盖通道反推未揭示航母位置。

## 验收

- `state.bin` shape 正确
- `mask.bin` shape 正确
- 所有动作都在合法 mask 内
- 英军观测不泄露隐藏德军位置
- 德军观测不泄露未揭示英军身份
- 数据胜负比例不过度偏斜
- 至少出现 F7、6VP、击沉、18回合胜利类型

## 当前实现文件

- `bismarck/engine/tensor-v3.ts`
- `bismarck/cli/generate-rl-tensor-v3.ts`
- `text/深度学习/tensor.md`
- `text/深度学习/training.md`
- `text/深度学习/todo.md`
