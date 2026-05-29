# 深度学习当前任务清单

## 当前阶段

```text
Stage 1: 朴素 RL baseline
```

目标：用最终标准 `RL Tensor v3` 重新生成高质量数据，先完成 CNN+MLP 的行为克隆与 PPO baseline。

## 已完成

- [x] 明确四阶段论文路线：状态机 → 朴素 RL → Transformer RL → 新架构
- [x] 旧 bug 数据归档到 `deeplearn/data/archive_buggy/`
- [x] 设计最终 128 通道 `RL Tensor v3`
- [x] 实现 v3 张量导出器：`bismarck/engine/tensor-v3.ts`
- [x] 实现数据生成 CLI：`bismarck/cli/generate-rl-tensor-v3.ts`
- [x] 小样本生成验证：`state/mask/action/target/result` 文件形状正确

## 接下来

### 数据生成

- [x] 运行 20 局 v3 试生产，检查格式、胜负比例、截断比例、胜利类型
- [x] 为长时间生成加入换行进度日志：局数、速度、ETA、胜负、截断
- [x] 修正 73 时间轴语义：阶段级时间槽 + 阶段内 16 个单位动作槽
- [x] 重新生成 5 局阶段级 raw 小样本并通过校验，`truncated=0`
- [x] 运行 1,000 局试生产，检查胜负比例、截断比例、奖励分布和来源覆盖
- [ ] 修正 policy mix，使任一方胜率不超过 75%
- [ ] 生成 10万-20万局正式 `rl_tensor_v3/raw`
- [ ] 按胜利类型分桶：F7、6VP、击沉、18回合

### 数据校验

- [x] 写 `deeplearn/check_rl_tensor_v3.py`
- [x] 检查 `state=[73,128,8,6]`
- [x] 检查 `mask=[73,16,128]`
- [x] 检查 `action_index` 一定在合法 mask 内
- [x] 检查英军观测不泄露隐藏德军位置
- [x] 检查德军观测不泄露未揭示英军身份
- [x] 修复德军视角 Ark Royal 航空覆盖泄露风险

### Stage 1 模型

- [x] 写 `deeplearn/train_rl_baseline.py`
- [x] 实现 CNN+MLP policy/value 网络
- [x] 行为克隆预训练入口
- [x] value head 预训练入口
- [ ] 安装/固定 PyTorch 依赖并跑完整训练
- [ ] PPO 在线微调

### 评估

- [ ] 对乱打 AI
- [ ] 对默认状态机
- [ ] 对 V11 状态机
- [ ] 对严父 AI
- [ ] 保存 Stage 1 报告到 `test_results/`

## 暂不做

- [ ] Transformer RL
- [ ] Belief/Intent/Utility 新架构
- [ ] EUA 层
- [ ] 百万局重训练
