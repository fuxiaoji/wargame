# Codex Agent 工作流

## 添加新功能/策略前的流程

### 1. 找论文 & 技术文献

在实现任何新的 AI 策略改进前，先做文献调研：

- 搜索相关论文（arXiv, Semantic Scholar）
- 找已有的成熟技术方案（如 Influence Map, Potential Field 等）
- 记录到 `text/参考文献.md`

### 2. 写入参考文献

在 `text/参考文献.md` 中按分类记录：
- 论文题目、作者、年份、链接
- 与本项目的关联（哪个模块用到了）
- 关键技术公式或伪代码

### 3. 制定计划

基于文献方案，在 plan mode 中设计实现方案：
- 改动范围（哪些文件）
- 新旧版本对比方案（保留开关）
- 验证方法（跑多少局对比胜率）

### 4. 实现 & 对比验证

- 保留旧版本逻辑（feature flag 切换）
- 新旧各跑 N 局对比效果
- 记录结果到报告

## 项目关键技术

| 技术 | 参考论文 | 代码位置 |
|------|---------|---------|
| MAP-Elites 多样性演化 | Mouret & Clune 2015 | `tournament.cpp` main() |
| 双种群共演化 | Legendre 2025 | `tournament.cpp` runJobRange |
| 影响图/势能场 | Adaixo 2014, Tozour 2001 | `state-machine.ts` Heatmap |
| 进化策略 (ES) | Schwefel 1995 | `tournament.cpp` mutateAll |
| Softmax 概率选择 | Sutton & Barto 2018 | `state-machine.ts` softmax |

## 项目结构

```
bismarck/          — TypeScript 前端 + CLI 工具
  src/App.tsx      — React 前端主组件
  cli/             — 命令行工具 (训练/评估/对战)
  engine/          — 游戏引擎 (规则/移动/战斗)
  ui/components/   — React UI 组件
cppre/             — C++ 高性能引擎 (训练用)
deeplearn/         — 训练数据 & 可视化
text/              — 文档 & 报告
  状态机ai/         — 状态机运行原理
  参考文献.md        — 论文 & 技术文献
  v4_cross_report.md — 分析报告
```

## 常用命令

```bash
# 前端
cd bismarck && npx vite build

# C++ 训练
cd cppre && g++ -std=c++20 -O3 tournament.cpp -o tournament
./tournament 10 20 50 10 ../deeplearn/data/training_v4

# 评估
npx tsx bismarck/cli/cross-eval.ts
npx tsx bismarck/cli/ablation-patrol.ts

# 可视化
python3 deeplearn/visualize_evo.py deeplearn/data/training_v4
```
