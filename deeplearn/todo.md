# 训练实施计划

## 当前状态

```
已完成:
  bismarck/        TS 引擎 ✅  (GUI 可玩)
  cppre/           C++ 引擎 ✅  (每秒千局)
  游戏规则验证      ✅  (双引擎一致)

待完成:
  deeplearn/       训练框架      ← 当前阶段
```

## Phase 1: 环境张量化 (预计 1 周)

### 1.1 张量日志格式
- [ ] 定义二进制格式: `state.bin` = `[73, 128, 8, 6]` float32 LE
- [ ] 定义动作记录格式: `action.bin` = 每步记录 (step_index, action_type, action_data)
- [ ] 定义元数据: `result.json` = {winner, vp_german, vp_british, turns}

### 1.2 C++ 引擎输出张量
- [ ] 在 `cppre/` 写 `tensor_logger.hpp` —— 填充 128 通道 + 写二进制
- [ ] 修改 `main.cpp` 输出 `.bin` 文件而非文本日志

### 1.3 Python 环境适配
- [ ] `deeplearn/env.py` —— 封装 C++ 引擎（pybind11 或 subprocess）
- [ ] `deeplearn/tensor.py` —— 读取/写入/可视化张量
- [ ] 实现 `reset() → state_tensor`, `step(action) → (state_tensor, reward, done)`

## Phase 2: 预训练数据生成 (预计 1 周)

### 2.1 启发式 Bot
- [ ] 德军 Bot: 4 种策略 (冲港/抓落单/航路攒VP/深海躲避)，状态机切换
- [ ] 英军 Bot: 展开搜索 → 发现后围堵

### 2.2 数据生成
- [ ] 10 万局随机对弈 → `data/random/`
- [ ] 10 万局启发式对弈 → `data/heuristic/`
- [ ] 每局输出: `state.bin` + `action.bin` + `result.json`

## Phase 3: 模型搭建与监督预训练 (预计 2 周)

### 3.1 模型架构 (PyTorch)
```
state [B,73,128,8,6]
  → CNN (空间压缩, 128→256维)
  → Transformer Encoder (时序, 2-4层)
  → 预测头 B: [8,6] softmax (位置信念)
  → 预测头 Π: [8,6] softmax (敌方意图)
  → EUA 层 (博弈注意力)
  → Actor 头 (动作概率) + Critic 头 (胜率)
```

### 3.2 第一阶段监督训练
- [ ] 冻结 EUA + Actor + Critic (只训 CNN + Transformer + 预测头)
- [ ] Loss: `CE(B, true_pos) + CE(Π, true_action)`
- [ ] 用 Phase 2 的数据，训练到 B 预测准确率 > 80%

### 3.3 第二阶段 EUA 接入
- [ ] 解冻 EUA，冻结 CNN + Transformer (或极小学习率微调)
- [ ] 用预计算的 U 矩阵（战斗期望收益表）

## Phase 4: 强化学习微调 (预计 3 周)

### 4.1 PPO 训练
- [ ] 全模型解冻，Self-Play
- [ ] 复合 Loss: `L_actor + 0.5*L_critic + 1.0*L_belief - 0.01*H_entropy`
- [ ] RTX 4060 预估: 50 万局 Self-Play

### 4.2 Baselines
- [ ] RNN-PPO (LSTM 替代 Transformer)
- [ ] PPO 无 EUA (MLP 替代)
- [ ] PPO 无辅助监督 (去掉 L_belief)

## Phase 5: 实验与论文 (预计 3 周)

- [ ] 胜率对比表格
- [ ] 位置预测热力图可视化
- [ ] 消融实验 (ablation)
- [ ] LaTeX 论文初稿
