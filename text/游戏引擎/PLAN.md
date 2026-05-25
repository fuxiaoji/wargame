# 击沉俾斯麦号 C++ 学习计划

## 当前进度

```
cppre/
├── types.hpp      ✅ 数据结构定义
├── units.hpp      ✅ 舰船常量 + 工厂函数
├── map.hpp        ✅ 六角格坐标系统 + BFS 距离
├── movement.hpp   ✅ 移动验证 + 可达格计算
├── main.cpp       ✅ 编译验证
└── PLAN.md        ← 你在这里
```

## 全局架构图

```
                    main.cpp (命令行交互 + 游戏循环)
                        │
                        ▼
              ┌──────────────────┐
              │   game.hpp       │  ← 主游戏类，把下面所有模块串成回合制流程
              │   BismarckGame   │
              └──────┬───────────┘
         ┌───────────┼───────────┬────────────┬──────────┐
         ▼           ▼           ▼            ▼          ▼
    movement    search      combat       transport   victory
    (移动)      (索敌)      (战斗)       (运输攻击)   (胜利判定)
         │           │           │            │          │
         └───────────┴───────────┴────────────┴──────────┘
                              │
                    都依赖 map.hpp (坐标/地图)
                              │
                    都依赖 types.hpp (数据结构)
                              │
                    都依赖 units.hpp (舰船属性)
```

**每一层的职责：**

| 模块 | 做什么 | 依赖 |
|---|---|---|
| `game.hpp` | 回合流转、阶段切换、调用下层函数 | 所有模块 |
| `search.hpp` | 同格索敌、航空索敌、伪装鉴定 | map |
| `combat.hpp` | 投骰结算、伤害计算 | map, units |
| `transport.hpp` | 运输舰队查表攻击 | map |
| `victory.hpp` | 检查三条胜利条件 | map |
| `random.hpp` | 骰子、洗牌（可注入种子） | 无 |
| `setup.hpp` | 初始化 GameState | map, units |

## 剩余模块（按编写顺序）

### 5. random.hpp — 随机数
- 定义接口 `Randomizer`（纯虚类）
- `DefaultRandom`：封装 `std::rand`
- `SeededRandom`：你熟悉的 mulberry32 算法，可直接抄 TS

### 6. search.hpp — 索敌
- 检查英军和德军是否同格
- Ark Royal 航空索敌相邻格
- 伪装算子鉴定（投骰）

### 7. combat.hpp — 战斗
- 按攻击力排序，依次投骰
- 航空攻击优先结算
- 伤害 → VP 转化

### 8. transport.hpp — 运输攻击
- 查表：D6 → VP + 是否信号泄露

### 9. victory.hpp — 胜利判定
- 德军 6VP 立即胜
- 俾斯麦沉没 → 英军胜
- 占 F7 且 VP 领先 → 德军胜
- 18 回合结束 → 英军胜

### 10. setup.hpp — 初始化
- 固定位置放置英军
- 德军选起始格
- 创建完整 GameState

### 11. game.hpp — 主游戏类（胶水层）
- 把上面所有模块串成完整回合
- 每个阶段对外暴露操作方法

### 12. main.cpp — 命令行交互
- 循环：打印状态 → 读用户输入 → 执行操作
- 支持双人对战

## 学习要点

### 你已掌握的
- `struct` / `enum class` / `std::optional`
- `unordered_map` / `unordered_set` 查表
- BFS 路径搜索
- 头文件组织 + `#pragma once`

### 接下来会学到
| 模块 | 新知识点 |
|---|---|
| `random.hpp` | 纯虚类（接口）、PRNG 算法 |
| `combat.hpp` | `std::sort` + lambda、返回值打包 |
| `game.hpp` | 类设计、状态机模式 |
| `main.cpp` | 命令行解析、游戏循环 |

### 不用学的（这个项目不需要）
- 智能指针（`unique_ptr`/`shared_ptr`）— 没有堆对象
- 模板 — 不需要泛型
- CMake — 单文件编译够了

## 当前文件数

```
已写:  types.hpp  units.hpp  map.hpp  movement.hpp  main.cpp
剩余:  random.hpp  search.hpp  combat.hpp  transport.hpp
       victory.hpp  setup.hpp  game.hpp
```
