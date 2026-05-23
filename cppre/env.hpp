#pragma once

#include <string>
#include <vector>
#include <sstream>
#include "game.hpp"
#include "map.hpp"
#include "movement.hpp"
#include "search.hpp"
#include "transport.hpp"
#include "setup.hpp"
#include "units.hpp"

// ========== 动作 ==========

enum class ActionType { Move, FinishPhase, AirSearch, Combat, Transport };

struct GameAction {
    int id;
    ActionType type;
    std::string label;
    std::string shipId;
    std::string targetLabel;
};

// ========== 观察 ==========

struct GameObservation {
    std::string text;
    ShipSide activePlayer;
    Phase phase;
    std::vector<GameAction> actions;
    bool gameOver;
    std::optional<ShipSide> winner;
    const GameState* raw;
};

// ========== 环境 ==========

class BismarckEnv {
public:
    BismarckGame game;

    BismarckEnv() : game() {}
    explicit BismarckEnv(int seed) : game(seed) {}

    void reset() { game = BismarckGame(); }
    void reset(int seed) { game = BismarckGame(seed); }

    // ---- 文本化观察 ----

    GameObservation getObservation() {
        const auto& s = game.state;
        ShipSide player = game.getActivePlayer();
        std::ostringstream oss;

        oss << "=== 第" << s.turn << "/18回合 | " << phaseName(s.phase) << " ===\n";
        oss << "德军VP:" << s.vp.german << "(需6) 英军VP:" << s.vp.british << "\n";
        if (s.germanPositionPublic) oss << "⚠ 德军位置本回合公开!（伪装鉴定失败）\n";
        if (s.transportRevealedHex) oss << "📡 信号泄露: 上回合德军曾在 " << *s.transportRevealedHex << "\n";
        oss << "\n";

        // 阶段提示
        auto hint = phaseHint(s.phase);
        if (!hint.empty()) oss << "📋 " << hint << "\n\n";

        // 地图态势
        std::map<std::string, std::vector<std::string>> occupied;
        for (const auto& ship : s.britishShips) {
            if (ship.steps <= 0) continue;
            auto it = s.britishPositions.find(ship.def.id);
            if (it != s.britishPositions.end())
                occupied[hexToLabel(it->second).value_or("?")].push_back(ship.def.name);
        }
        if (player == ShipSide::german || s.germanPositionPublic) {
            for (const auto& ship : s.germanShips) {
                if (ship.steps <= 0) continue;
                auto it = s.germanPositions.find(ship.def.id);
                if (it != s.germanPositions.end())
                    occupied[hexToLabel(it->second).value_or("?")].push_back(ship.def.name);
            }
        }
        if (!occupied.empty()) {
            oss << "当前态势:\n";
            for (const auto& [label, names] : occupied) {
                oss << "  " << label << ": ";
                for (size_t i = 0; i < names.size(); ++i) {
                    if (i) oss << ", ";
                    oss << names[i];
                }
                oss << "\n";
            }
            oss << "\n";
        }

        // 舰队详情
        if (player == ShipSide::german) {
            oss << "== 德军舰队 (你) ==\n";
            for (const auto& ship : s.germanShips) {
                if (ship.steps <= 0) continue;
                auto it = s.germanPositions.find(ship.def.id);
                oss << shipLine(ship, it != s.germanPositions.end() ? hexToLabel(it->second).value_or("?") : "?") << "\n";
            }
            oss << "\n== 英军舰队 (公开可见) ==\n";
            for (const auto& ship : s.britishShips) {
                if (ship.steps <= 0) continue;
                auto it = s.britishPositions.find(ship.def.id);
                std::string label = it != s.britishPositions.end() ? hexToLabel(it->second).value_or("?") : "?";
                if (ship.revealed) oss << shipLine(ship, label) << "\n";
                else oss << "  背面算子 [" << label << "]\n";  // 德军看不到身份
            }
        } else {
            oss << "== 英军舰队 (你) ==\n";
            for (const auto& ship : s.britishShips) {
                if (ship.steps <= 0) continue;
                auto it = s.britishPositions.find(ship.def.id);
                oss << shipLine(ship, it != s.britishPositions.end() ? hexToLabel(it->second).value_or("?") : "?") << "\n";
            }
            oss << "\n";
            // bismarckFound 只解锁英军移动，不暴露当前位置
            if (s.germanPositionPublic) {
                oss << "== 德军舰队 (公开) ==\n";
                for (const auto& ship : s.germanShips) {
                    if (ship.steps <= 0) continue;
                    auto it = s.germanPositions.find(ship.def.id);
                    oss << shipLine(ship, it != s.germanPositions.end() ? hexToLabel(it->second).value_or("?") : "?") << "\n";
                }
            } else {
                oss << "== 德军舰队 ==\n";
                oss << "  位置未知。需通过索敌发现。\n";
                if (s.bismarckFound) oss << "  注意: 英军已发现过俾斯麦，所有战舰解锁可移动。\n";
                oss << "  德军起始格: A5/A6/B7 之一\n";
            }
        }
        oss << "\n";

        // setup-british: 显坐标格式，不显示编号列表
        if (s.phase == Phase::setup_british) {
            bool any = false;
            for (const auto& sh : s.britishShips)
                if (!s.britishPositions.count(sh.def.id)) { any = true; break; }
            if (any) {
                oss << "📝 需放置算子。请直接回复坐标格式 (不要编号):\n";
                oss << "   格式: (舰名,格号)(舰名,格号)...\n";
                oss << "   例如: (胡德号,E7)(诺福克号,D1)\n";
                auto acts = getActions(); // 只用于返回结构，LLM不依赖编号
                return { oss.str(), player, s.phase, acts, s.gameOver, s.winner, &s };
            }
        }

        auto actions = getActions();
        oss << "--- 请选择操作 (回复数字编号) ---\n";
        for (const auto& a : actions)
            oss << "[" << a.id << "] " << a.label << "\n";

        return { oss.str(), player, s.phase, actions, s.gameOver, s.winner, &s };
    }

    // ---- 快速观察 (跳过文本生成，仅动作列表) ----
    GameObservation getFastObservation() {
        const auto& s = game.state;
        ShipSide player = game.getActivePlayer();
        auto actions = getActions();
        return { "", player, s.phase, actions, s.gameOver, s.winner, &s };
    }

    // ---- 动作列表 ----

    std::vector<GameAction> getActions() {
        const auto& s = game.state;
        std::vector<GameAction> actions;
        int nextId = 1;

        if (s.phase == Phase::setup_german) {
            for (const auto& label : GERMAN_START_HEXES)
                actions.push_back({nextId++, ActionType::Move, "选择起始格: " + label, "", label});
        }

        if (s.phase == Phase::setup_british) {
            bool anyUnplaced = false;
            for (const auto& sh : s.britishShips)
                if (!s.britishPositions.count(sh.def.id)) { anyUnplaced = true; break; }
            if (anyUnplaced)
                actions.push_back({nextId++, ActionType::Move, "发送初设并开始游戏", "", ""});
            else
                actions.push_back({nextId++, ActionType::FinishPhase, "布阵完成，开始游戏", "", ""});
        }

        if (s.phase == Phase::german_move) {
            // 逐艘轮询：找出下一艘未动的德军船
            bool allMoved = true;
            for (const auto& ship : s.germanShips) {
                if (ship.steps <= 0) continue;
                if (s.movedThisTurn.count(ship.def.id)) continue;
                allMoved = false;
                auto it = s.germanPositions.find(ship.def.id);
                if (it == s.germanPositions.end()) continue;
                auto curLabel = hexToLabel(it->second).value_or("");
                // 不动选项
                actions.push_back({nextId++, ActionType::Move,
                    ship.def.name + " → 不动(" + curLabel + ")", ship.def.id, curLabel});
                auto reachable = getGermanReachableLabels(it->second, ship);
                for (const auto& target : reachable) {
                    if (target == curLabel) continue; // 和不动重复
                    actions.push_back({nextId++, ActionType::Move,
                        ship.def.name + " → " + target, ship.def.id, target});
                }
                break; // 只显示当前这艘船
            }
            if (allMoved)
                actions.push_back({nextId++, ActionType::FinishPhase, "德军移动完成", "", ""});
        }

        if (s.phase == Phase::british_move) {
            // 逐艘轮询：找出下一艘可动且未动的英军船
            bool allMoved = true;
            for (const auto& ship : s.britishShips) {
                if (ship.steps <= 0) continue;
                if (s.movedThisTurn.count(ship.def.id)) continue;
                // 发现前只有特定船可动
                if (!s.bismarckFound && !canMoveBeforeDetection(ship.def)) continue;
                allMoved = false;
                auto it = s.britishPositions.find(ship.def.id);
                if (it == s.britishPositions.end()) continue;
                auto curLabel = hexToLabel(it->second).value_or("");
                actions.push_back({nextId++, ActionType::Move,
                    ship.def.name + " → 不动(" + curLabel + ")", ship.def.id, curLabel});
                auto reachable = getBritishReachableLabels(s, it->second, ship);
                for (const auto& target : reachable) {
                    if (target == curLabel) continue;
                    actions.push_back({nextId++, ActionType::Move,
                        ship.def.name + " → " + target, ship.def.id, target});
                }
                break;
            }
            if (allMoved)
                actions.push_back({nextId++, ActionType::FinishPhase, "英军移动完成", "", ""});
        }

        if (s.phase == Phase::british_search) {
            // 航空索敌优先执行（在同格索敌之前）
            auto arkIt = std::find_if(s.britishShips.begin(), s.britishShips.end(),
                [](const ShipState& sh) { return sh.def.id == "ark-royal" && sh.steps > 0; });
            if (arkIt != s.britishShips.end()) {
                auto posIt = s.britishPositions.find("ark-royal");
                if (posIt != s.britishPositions.end()) {
                    for (const auto& label : getAirSearchTargets(posIt->second))
                        actions.push_back({nextId++, ActionType::AirSearch, "航空索敌: " + label, "", label});
                }
            }
            actions.push_back({nextId++, ActionType::FinishPhase, "执行同格索敌", "", ""});
            if (!s.combatPending)
                actions.push_back({nextId++, ActionType::FinishPhase, "索敌完成", "", ""});
        }

        if (s.phase == Phase::combat && !s.gameOver)
            actions.push_back({nextId++, ActionType::Combat, "结算战斗", "", ""});

        if (s.phase == Phase::transport_attack) {
            auto attackers = getTransportAttackers(s);
            for (const auto* ship : attackers)
                actions.push_back({nextId++, ActionType::Transport,
                    ship->def.name + " 攻击运输舰队", ship->def.id, ""});
            actions.push_back({nextId++, ActionType::FinishPhase, "跳过运输攻击", "", ""});
        }

        return actions;
    }

    // ---- 执行动作 ----

    ActionResult step(const GameAction& action) {
        switch (action.type) {
        case ActionType::Move:
            if (game.state.phase == Phase::setup_german && !action.targetLabel.empty())
                return toResult(game.setGermanStart(action.targetLabel));
            else if (game.state.phase == Phase::setup_british && !action.shipId.empty() && !action.targetLabel.empty())
                return toResult(game.placeBritishToken(action.shipId, action.targetLabel));
            else if (game.state.phase == Phase::german_move && !action.shipId.empty() && !action.targetLabel.empty())
                return toResult(game.germanMove(action.shipId, action.targetLabel));
            else if (game.state.phase == Phase::british_move && !action.shipId.empty() && !action.targetLabel.empty())
                return toResult(game.britishMove(action.shipId, action.targetLabel));
            break;
        case ActionType::FinishPhase:
            if (game.state.phase == Phase::german_move) game.finishGermanMove();
            else if (game.state.phase == Phase::british_move) game.finishBritishMove();
            else if (game.state.phase == Phase::british_search) {
                game.doSearch();  // 始终执行同格索敌（处理伪装鉴定）
                game.finishSearch();
            } else if (game.state.phase == Phase::setup_british) game.finishSetup();
            else if (game.state.phase == Phase::transport_attack) game.skipTransportAttack();
            break;
        case ActionType::AirSearch:
            if (!action.targetLabel.empty()) game.doAirSearch(action.targetLabel);
            break;
        case ActionType::Combat:
            game.doCombat();
            break;
        case ActionType::Transport:
            if (!action.shipId.empty()) game.doTransportAttack(action.shipId);
            break;
        }
        return {true, ""};
    }

    void autoPlaceBritish() {
        auto labels = getBritishSetupLabels();
        for (auto& sh : game.state.britishShips) {
            if (!game.state.britishPositions.count(sh.def.id))
                game.placeBritishToken(sh.def.id, labels[rand() % labels.size()]);
        }
    }

private:
    static ActionResult toResult(const ActionResult& r) { return r; }

    static std::string phaseName(Phase p) {
        switch (p) {
            case Phase::setup_german:    return "德军布置";
            case Phase::setup_british:   return "英军布置";
            case Phase::german_move:    return "德军移动";
            case Phase::british_move:   return "英军移动";
            case Phase::british_search: return "英军索敌";
            case Phase::combat:         return "战斗";
            case Phase::transport_attack: return "攻击运输";
            case Phase::game_over:      return "结束";
        }
        return "?";
    }

    static std::string phaseHint(Phase p) {
        switch (p) {
            case Phase::setup_german:  return "选择德军起始格(A5/A6/B7)。所有德军舰船从同一格出发。";
            case Phase::setup_british: return "放置未布置的英军算子到可选格。";
            case Phase::german_move:   return "选择德军舰船移动。你的位置对英军隐藏。";
            case Phase::british_move:  return "选择英军舰船移动。发现俾斯麦前仅胡德/威尔士亲王/伪装可移动。";
            case Phase::british_search: return "执行同格索敌。皇家方舟号可航空索敌相邻格。";
            case Phase::combat:        return "结算战斗。航空攻击优先，然后按攻击力降序。";
            case Phase::transport_attack: return "德军舰船在航路上可攻击商船获取VP。";
            default: return "";
        }
    }

    static std::string shipLine(const ShipState& ship, const std::string& label) {
        if (ship.def.isDummy) return "  伪装算子 [" + label + "]";
        int spd = getShipSpeed(ship);
        return "  " + ship.def.name + " [Step:" + std::to_string(ship.steps)
            + "/" + std::to_string(ship.def.maxSteps)
            + " 攻:" + std::to_string(ship.def.attack)
            + " 防:" + std::to_string(ship.def.defense)
            + " 速:" + std::to_string(spd) + "] " + label;
    }
};
