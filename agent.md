# 项目架构与工作流

## 项目概述

击沉俾斯麦号 (Sink the Bismarck) — 双盲兵棋推演 AI 研究平台。

1941 年北大西洋，德军俾斯麦号突破英军封锁驶向布雷斯特港。一方扮演德军（隐藏移动），一方扮演英军（索敌围堵）。

## 项目结构

```
wargame/
├── bismarck/               TS 引擎 + React GUI (主战场)
│   ├── engine/            游戏核心引擎
│   │   ├── game.ts        游戏主逻辑 (状态机、移动、索敌、战斗)
│   │   ├── env.ts         环境包装器 (getActions/step/getObservation)
│   │   ├── types.ts       类型定义 (GameState, ShipState, Phase...)
│   │   ├── setup.ts       初始化 (createGameState, 英军固定位置)
│   │   ├── map.ts         六角格坐标系统
│   │   ├── movement.ts    移动规则 + BFS 可达格
│   │   ├── search.ts      索敌逻辑 (同格索敌、航空索敌、伪装鉴定)
│   │   ├── combat.ts      战斗结算
│   │   ├── transport.ts   运输攻击
│   │   ├── victory.ts     胜利条件判定
│   │   └── units.ts       舰船定义 (ShipDef, 属性常量)
│   ├── cli/               CLI 工具 + AI
│   │   ├── state-machine.ts  状态机 AI (BritishBrain / GermanBrain)
│   │   ├── tune-weights.ts   权重调优
│   │   ├── cross-eval.ts     交叉评估
│   │   ├── eval-v3.ts        V3 评估
│   │   └── presets.ts        预设权重
│   ├── ui/                React 前端 (GUI)
│   └── src/               Vite 入口
├── cppre/                  C++ 引擎 (高速训练用, ~1000局/秒)
│   ├── game.hpp           游戏主逻辑 (与 TS 引擎功能对等)
│   ├── env.hpp            环境包装器
│   ├── state_machine.hpp  状态机 AI (C++ 实现)
│   ├── tournament.cpp     多线程锦标赛
│   ├── bridge.cpp         TS↔C++ 桥接
│   └── (其他 .hpp 与 TS engine/ 一一对应)
├── deeplearn/              深度学习训练管线
│   ├── agent.md           张量规范 + 架构文档 (73×128×8×6)
│   ├── visualize_evo.py   演化可视化
│   ├── global_log.py      全局日志 (德军 vs 英军双视角)
│   └── data/              训练数据 (已 gitignore, ~7GB)
├── text/                   文档 (按主题分类)
│   ├── 游戏引擎/          规则.md, PLAN.md, api.md
│   ├── llmai/             lowai.md
│   ├── 状态机ai/          状态机训练.md, 状态机个体README.md
│   └── 深度学习/          ideal.md, tensor.md, training.md, todo.md, v3_*
├── agent.md               本文件 — 项目架构与工作流
├── todo.md                当前任务清单
├── bug.md                 已修复 Bug 记录
└── .gitignore             忽略规则 (node_modules, 训练数据, API密钥, 编译产物)
```

## 双引擎架构

| | TS 引擎 (bismarck/) | C++ 引擎 (cppre/) |
|---|---|---|
| 用途 | GUI + 开发验证 | 批量训练 (1000局/秒) |
| 语言 | TypeScript | C++17/20 |
| 规则 | 完整实现 | 与 TS 功能对等 |
| 启动 | `npm run dev` | `g++ -O3 -std=c++20 tournament.cpp -o tournament` |

**重要**: 修改游戏规则时必须同步更新两个引擎，保持行为一致。

## 工作流

### 开始任何任务前
1. 读取 `todo.md` 了解当前任务
2. 读取 `bug.md` 了解已修复的 Bug，避免重蹈覆辙
3. 阅读 `text/` 下相关文档理解背景

### 修改游戏规则时
1. 先改 TS 引擎验证逻辑正确性 (`bismarck/engine/`)
2. 同步改 C++ 引擎 (`cppre/`)
3. 运行测试确认双引擎行为一致

### 修改 AI 时
- 状态机 AI: `bismarck/cli/state-machine.ts` + `cppre/state_machine.hpp`
- LLM AI: `bismarck/battle-llm.ts`
- 深度学习: `deeplearn/agent.md` (张量规范)

### 提交前
- 确认 `.gitignore` 已排除 API 密钥、训练数据、编译产物
- 不要提交 `text/游戏引擎/api.md` (含 API 密钥)

## 快速命令

```bash
npm run dev          # 启动 GUI
npm run battle       # 单局 AI 对战
npx tsx bismarck/cli/state-machine.ts  # 状态机对战
```
