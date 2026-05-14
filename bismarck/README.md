# 击沉俾斯麦号 (Sink the Bismarck)

基于经典兵棋推演"击沉俾斯麦号"的双人/AI 对战游戏。1941 年北大西洋，德军俾斯麦号战列舰突破英军封锁，驶向布雷斯特港。

## 启动

```bash
npm install
npm run dev        # 开发模式
npm run build      # 生产构建
npm run preview    # 预览构建产物
```

## AI 对战

```bash
npm run battle     # 单局 AI 对战 (CLI)
npm run server     # WebSocket 对战服务器 (大批量AI对战)
```

## 技术栈

| 层 | 技术 |
|---|---|
| 语言 | TypeScript |
| 前端 | React 19 + Vite 8 + Tailwind CSS 4 |
| 服务端 | Node.js + WebSocket (ws) |
| AI 接口 | OpenAI 兼容 API (DeepSeek / vLLM / Ollama 等) |
| 运行时 | tsx (TypeScript 直接执行) |

## 代码结构

```
bismarck/
├── engine/                  # 游戏引擎核心 (纯逻辑，无 UI 依赖)
│   ├── types.ts             # 类型定义: 坐标系统、舰船、游戏状态、阶段
│   ├── units.ts             # 全部舰船属性定义 (德军2艘 + 英军11艘 + 伪装算子4个)
│   ├── game.ts              # 主游戏类 BismarckGame，所有阶段流转
│   ├── map.ts               # 六角格坐标系统，格号↔坐标转换，地图属性
│   ├── setup.ts             # 游戏初始化，德军/英军初始布置
│   ├── movement.ts          # 移动验证 (BFS 路径搜索，可达格计算)
│   ├── search.ts            # 索敌机制 (同格索敌、航空索敌、伪装鉴定)
│   ├── combat.ts            # 战斗结算 (航空攻击优先，按攻击力排序投骰)
│   ├── transport.ts         # 运输舰队攻击 (查表机制)
│   ├── victory.ts           # 胜利条件判定 (6VP/占港/击沉/18回合)
│   ├── random.ts            # 随机数生成 (默认 + 种子注入)
│   ├── log.ts               # 游戏日志与会话持久化 (localStorage + JSON导出)
│   └── env.ts               # AI 环境包装: 文本化观察 + 动作空间构建
├── src/                     # React 前端入口
│   ├── App.tsx              # 主应用: 双人对战 + AI 模式 + 地图校准 + 调试终端
│   └── main.tsx             # React 挂载入口
├── ui/                      # UI 组件
│   ├── components/
│   │   ├── HexMap.tsx       # 六角格地图渲染 (SVG 覆盖 + 贝塞尔曲线航线)
│   │   ├── SetupScreen.tsx  # 初始布置界面
│   │   ├── GermanMovePanel.tsx  # 德军移动控制面板
│   │   ├── BritishMovePanel.tsx # 英军移动控制面板
│   │   ├── SearchPanel.tsx  # 索敌操作面板
│   │   ├── CombatDialog.tsx # 战斗结算弹窗
│   │   ├── TransportDialog.tsx  # 运输攻击弹窗
│   │   ├── VictoryScreen.tsx    # 胜利画面
│   │   ├── ScoreBoard.tsx   # 比分面板
│   │   ├── GameLogPanel.tsx # 对战日志面板
│   │   ├── Dashboard.tsx    # AI 训练仪表盘 (WebSocket)
│   │   └── MapCalibration.tsx   # 地图校准工具
│   └── hooks/
│       └── useGame.ts       # 游戏状态 Hook，桥接 engine 与 UI
├── server/                  # 对战服务器
│   ├── battle-server.ts     # WebSocket 服务器: 并发对战管理 + 进度推送
│   └── state-manager.ts     # 状态管理: 断电续传 + 统计汇总
├── cli/                     # 命令行工具
│   ├── battle-runner.ts     # CLI AI 对战运行器
│   └── llm-client.ts        # LLM API 客户端 (OpenAI 兼容)
├── public/                  # 静态资源 (地图图片、图标)
└── battle-logs/             # 对战日志输出目录
```

## 游戏规则概要

- **德军 (2艘)**: 俾斯麦号、欧根亲王号。隐藏移动。目标: 6VP 或占据布雷斯特港(F7)且 VP 领先
- **英军 (11+4伪装)**: 胡德号、威尔士亲王号、皇家方舟号等。目标: 击沉俾斯麦号或撑过 18 回合
- **阶段顺序**: 德军移动 → 英军移动 → 索敌 → 战斗/攻击运输
- **战斗**: 按攻击力投 D6，骰点 ≥ 防御力即命中，每造成 1 Step 伤害 = 1 VP
- 完整规则见 [规则.md](../追击俾斯麦/规则.md)

## AI 模式

支持三种模式: 双人对战 / AI 德军 / AI 英军。AI 通过 OpenAI 兼容 API 调用大模型，支持流式输出和推理过程展示。详见 `engine/env.ts` 的文本化观察-动作空间设计。
