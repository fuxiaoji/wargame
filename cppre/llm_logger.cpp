/** LLM 对战日志 —— 记录每个阶段发给 LLM 的完整提示词 */
#include "env.hpp"
#include <iostream>
#include <fstream>
#include <cstdlib>
#include <ctime>
#include <sstream>

const char* RULES = R"(
# 击沉俾斯麦号（Sink the Bismarck）游戏规则

## 1.0 简介
这是一以"莱茵演习"为主题的双人游戏。
玩家角色：一位玩家扮演德军，另一位扮演英军。
胜利条件：
  德军胜利：
    1. 获得 6 分（VP）立即胜利。
    2. 在回合结束时占据布雷斯特港（F7）且 VP 领先于英军。
  英军胜利：
    1. 击沉俾斯麦号。
    2. 18 回合结束时德军未能达成胜利条件。

## 2.0 游戏准备
英军布置：将印有舰名的算子背面朝上放在相应位置；其他算子随机背面朝上放置。同一格可放置任意数量算子。
德军布置：德军算子可设在 A5、A6 或 B7 任一格，初始摆放在地图外，位置记录在纸上。

## 3.0 游戏顺序
每个回合按以下顺序进行：
  1. 德军移动记录
  2. 英军移动
  3. 英军索敌
  4. 战斗或攻击运输舰队

## 4.0 德军移动记录
德军舰船不在地图上显示，通过纸笔记录位置。
移动力：取决于算子右下角数值。初始为 2 格，受损后减为 1 格。
限制：不可进入无编号格子，不可越过陆地。

## 5.0 英军移动
英军舰船可移动 1 至 3 格，且算子在地图上始终保持背面朝上。
每个回合开始时，即使之前已翻开也需重新翻回背面。
伪装算子（Dummy）的移动力为 3 格。
5.1 移动限制：除胡德号（Hood）、威尔士亲王号（P.O. Wales）及伪装算子外，英军舰船在发现德军前不能移动。一旦发现德军，指定格内的所有英军变为可移动状态。

## 6.0 英军索敌
同格索敌：移动完成后，若德军与英军处于同格，德军必须告知格号，该格英军全部翻开。若不在同格则宣告"未发现"。
6.1 航空索敌：若未发现俾斯麦号，英军航母（Ark Royal）可翻开并选择一个相邻格。若德军在该格必须告知，并结算航空攻击。
6.2 伪装算子鉴定：
  若翻开的是伪装算子，德军投掷一枚骰子。
  俾斯麦移动力为 2 时：骰点 ≤4 则移除伪装算子。
  俾斯麦移动力为 1 时：骰点 ≤2 则移除伪装算子。
  鉴定失败：视为遭遇非主力舰，下回合德军移动需公开，且伪装算子随之移动。

## 7.0 战斗
发生条件：双方处于同一格，或英军航母对相邻格发动航空攻击。
结算顺序：(1) 航空攻击；(2) 按攻击力由高到低依次进行。
7.1 结算方式：按攻击力数值投掷对应数量的骰子。若骰点 ≥ 目标防御力，目标损失 1 Step。
7.2 伤害与得分：
  俾斯麦号共有 4 Step。
  英军 2 Step 舰船受损后攻击力减 2。
  每造成敌方 1 Step 损失，己方获得 1 VP。

## 8.0 攻击运输舰队
未发生战斗的德军舰船若位于航路上，可攻击运输舰队。
投骰查表。若结果为"信号泄露"或"2VP"，德军必须宣告当前位置。

## 附录：地图数据
6列(A-F) × 8行(1-8)，奇数列(B/D/F)左偏半格。
有效格: A3 A4 A5 A6 | B2 B3 B4 B5 B6 B7 | C1 C2 C3 C4 C5 C6 C7 | D1 D2 D3 D4 D5 D6 D7 D8 | E1 E2 E3 E4 E5 E6 E7 | F1 F2 F3 F4 F5 F6 F7
港口: 布雷斯特=F7, 斯卡帕湾=D8
运输航路: D2, D3, C3, C4, D5, E1, E4, E5
阻断边(英国本土): D6-D7, E5-E6, E6-D7, E6-F7, E6-E7
德军起始可选: A5, A6, B7

## 附录：舰船数据
德军:
  俾斯麦号 [攻4/防6/4Step/速2] 受损后速度降为1
  欧根亲王号 [攻2/防5/2Step/速2]
英军:
  胡德号[攻4/防6/2Step] 威尔士亲王号[攻3/防6/2Step]
  皇家方舟号[攻1/防5/2Step, 可航空索敌]
  乔治五世号[攻3/防6/2Step] 罗德尼号[攻3/防6/2Step]
  声望号[攻2/防5/2Step] 反击号[攻2/防5/2Step]
  胜利号[攻1/防5/2Step] 拉米伊号[攻3/防6/2Step]
  诺福克号[攻2/防5/1Step] 萨福克号[攻2/防5/1Step]
  伪装算子×4[攻0/防0/1Step/速3]
英军固定初始: C6(乔治五世/反击/胜利), D6(罗德尼), F4(声望/皇家方舟), F1(拉米伊)
运输攻击查表(D6): 1=信号泄露, 2=无效果, 3=1VP, 4=1VP+泄露, 5=2VP, 6=2VP+泄露

## 回复格式
只回复动作编号数字，如 "3" 或 "[3]"
)";

std::string buildSystemPrompt(ShipSide side) {
    std::ostringstream oss;
    oss << RULES;
    oss << "\n你是" << (side == ShipSide::german ? "德军指挥官。" : "英军指挥官。");
    return oss.str();
}

int main() {
    std::srand(static_cast<unsigned>(std::time(nullptr)));

    BismarckEnv env;
    int steps = 0, turns = 0;
    const int MAX_TURNS = 5;

    std::ostringstream log;
    log << "===== LLM 对战日志 (前" << MAX_TURNS << "回合) =====\n\n";

    // 系统提示词（双方相同，已在规则末尾说明角色）
    log << "========== 系统提示词 (德军) ==========\n";
    log << buildSystemPrompt(ShipSide::german) << "\n\n";
    log << "========== 系统提示词 (英军) ==========\n";
    log << buildSystemPrompt(ShipSide::british) << "\n\n";
    log << "========================================\n\n";

    int lastTurn = 0;
    while (!env.game.state.gameOver && steps < 500 && turns < MAX_TURNS) {
        auto obs = env.getObservation();
        auto& actions = obs.actions;
        if (actions.empty()) break;

        // 回合切换标记
        if (env.game.state.turn != lastTurn) {
            lastTurn = env.game.state.turn;
            turns++;
            if (turns > MAX_TURNS) break;
        }

        // 记录每次 LLM 交互
        log << "--- 步" << steps << " | T" << env.game.state.turn
            << " | " << (obs.activePlayer == ShipSide::german ? "德军" : "英军")
            << " | 动作数:" << actions.size() << " ---\n";
        log << "=== 发送给 LLM 的内容 ===\n";
        log << obs.text << "\n";
        log << "=== LLM 应回复格式: 仅数字 ===\n\n";

        // 随机选动作
        int pick = std::rand() % actions.size();
        if (obs.phase == Phase::setup_british && actions.size() == 1
            && actions[0].type == ActionType::Move
            && actions[0].label == "发送初设并开始游戏") {
            env.autoPlaceBritish();
            log << "  [自动] autoPlaceBritish\n\n";
        } else {
            log << "  >>> 选中 #" << actions[pick].id
                << ": " << actions[pick].label << "\n\n";
            env.step(actions[pick]);
        }
        steps++;
    }

    // 终局
    const auto& s = env.game.state;
    log << "===== 游戏结束 =====\n";
    log << "胜者: " << (s.winner && *s.winner == ShipSide::german ? "德军" : "英军") << "\n";
    log << "回合: " << s.turn << "/18 | 德VP:" << s.vp.german
        << " 英VP:" << s.vp.british << "\n";
    log << "原因: " << s.victoryReason << "\n";
    log << "总步数: " << steps << "\n";

    // 写入文件
    std::ofstream f("llm_prompts.log");
    f << log.str();
    std::cout << "日志已写入: cppre/llm_prompts.log (" << steps << " 步)" << std::endl;
    return 0;
}
