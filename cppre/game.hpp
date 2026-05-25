#pragma once

#include "type.hpp"
#include "setup.hpp"
#include "map.hpp"
#include "random.hpp"
#include "movement.hpp"
#include "search.hpp"
#include "combat.hpp"
#include "transport.hpp"
#include "victory.hpp"

struct ActionResult {
    bool ok;
    std::string error;
};

class BismarckGame {
public:
    GameState state;

    BismarckGame() : state(createGameState()), rng() {}
    explicit BismarckGame(int seed) : state(createGameState()), rng(static_cast<uint32_t>(seed)) {}

    IRandomizer& getRng() { return rng; }

    ShipSide getActivePlayer() const {
        switch (state.phase) {
            case Phase::setup_german:
            case Phase::german_move:
            case Phase::transport_attack:
                return ShipSide::german;
            default:
                return ShipSide::british;
        }
    }

    // ========== 初始化 ==========

    ActionResult setGermanStart(const std::string& label) {
        if (state.phase != Phase::setup_german)
            return {false, "当前不是德军初始布置阶段"};

        auto coord = labelToHex(label);
        if (!coord) return {false, "无效格号: " + label};
        if (isLand(*coord)) return {false, label + " 是陆地格"};

        for (auto& ship : state.germanShips)
            state.germanPositions[ship.def.id] = *coord;

        for (const auto& [hexLabel, shipIds] : BRITISH_FIXED_POSITIONS) {
            auto c = labelToHex(hexLabel);
            if (!c) continue;
            for (const auto& id : shipIds)
                state.britishPositions[id] = *c;
        }

        state.phase = Phase::setup_british;
        return {true, ""};
    }

    ActionResult placeBritishToken(const std::string& shipId, const std::string& label) {
        if (state.phase != Phase::setup_british)
            return {false, "当前不是英军布置阶段"};

        auto coord = labelToHex(label);
        if (!coord) return {false, "无效格号: " + label};
        if (isLand(*coord)) return {false, label + " 是陆地格"};
        // 德军初设格不可部署英军
        if (std::find(GERMAN_START_HEXES.begin(), GERMAN_START_HEXES.end(), label) != GERMAN_START_HEXES.end())
            return {false, label + " 是德军初始格"};

        auto it = std::find_if(state.britishShips.begin(), state.britishShips.end(),
            [&](const ShipState& s) { return s.def.id == shipId; });
        if (it == state.britishShips.end())
            return {false, "找不到算子: " + shipId};

        state.britishPositions[shipId] = *coord;
        it->revealed = false;
        return {true, ""};
    }

    ActionResult finishSetup() {
        if (state.phase != Phase::setup_british)
            return {false, "当前不是英军布置阶段"};

        for (const auto& s : state.britishShips) {
            if (!state.britishPositions.count(s.def.id))
                return {false, "以下算子未放置: " + s.def.name};
        }

        state.phase = Phase::german_move;
        return {true, ""};
    }

    // ========== 德军移动 ==========

    ActionResult germanMove(const std::string& shipId, const std::string& targetLabel) {
        if (state.phase != Phase::german_move)
            return {false, "当前不是德军移动阶段"};

        auto it = std::find_if(state.germanShips.begin(), state.germanShips.end(),
            [&](const ShipState& s) { return s.def.id == shipId; });
        if (it == state.germanShips.end()) return {false, "找不到德军舰船: " + shipId};
        if (it->steps <= 0) return {false, "舰船已沉没"};

        auto targetCoord = labelToHex(targetLabel);
        if (!targetCoord) return {false, "无效格号: " + targetLabel};

        auto fromIt = state.germanPositions.find(shipId);
        if (fromIt == state.germanPositions.end()) return {false, "舰船位置无效"};

        auto v = validateGermanMove(fromIt->second, *targetCoord, *it);
        if (!v.valid) return {false, v.reason};

        it->prevPos = fromIt->second;
        state.germanPositions[shipId] = *targetCoord;
        state.movedThisTurn.insert(shipId);
        return {true, ""};
    }

    ActionResult undoLastMove(const std::string& shipId) {
        auto findShip = [&](std::vector<ShipState>& ships) -> ShipState* {
            auto it = std::find_if(ships.begin(), ships.end(),
                [&](const ShipState& s) { return s.def.id == shipId; });
            return it != ships.end() ? &(*it) : nullptr;
        };

        ShipState* ship = findShip(state.germanShips);
        if (!ship) ship = findShip(state.britishShips);
        if (!ship) return {false, "找不到舰船"};
        if (!ship->prevPos) return {false, "没有可撤销的移动"};

        auto& posMap = ship->def.side == ShipSide::german
            ? state.germanPositions : state.britishPositions;
        posMap[shipId] = *ship->prevPos;
        state.movedThisTurn.erase(shipId);
        ship->prevPos = std::nullopt;
        return {true, ""};
    }

    ActionResult finishGermanMove() {
        if (state.phase != Phase::german_move)
            return {false, "当前不是德军移动阶段"};

        // 伪装鉴定失败 → 只有鉴定失败的那些伪装跟随俾斯麦 (规则 6.2)
        if (state.germanPositionPublic) {
            auto bismarckIt = state.germanPositions.find("bismarck");
            if (bismarckIt != state.germanPositions.end() && !state.failedDummies.empty()) {
                for (auto& bShip : state.britishShips) {
                    if (state.failedDummies.count(bShip.def.id) && bShip.steps > 0)
                        state.britishPositions[bShip.def.id] = bismarckIt->second;
                }
            }
            state.germanPositionPublic = false;
            state.failedDummies.clear();
        }

        for (auto& ship : state.britishShips) ship.revealed = false;
        state.movedThisTurn.clear();
        state.phase = Phase::british_move;
        return {true, ""};
    }

    // ========== 英军移动 ==========

    ActionResult britishMove(const std::string& shipId, const std::string& targetLabel) {
        if (state.phase != Phase::british_move)
            return {false, "当前不是英军移动阶段"};

        auto it = std::find_if(state.britishShips.begin(), state.britishShips.end(),
            [&](const ShipState& s) { return s.def.id == shipId; });
        if (it == state.britishShips.end()) return {false, "找不到英军舰船: " + shipId};
        if (it->steps <= 0) return {false, "舰船已沉没"};

        auto targetCoord = labelToHex(targetLabel);
        if (!targetCoord) return {false, "无效格号: " + targetLabel};

        auto fromIt = state.britishPositions.find(shipId);
        if (fromIt == state.britishPositions.end()) return {false, "舰船位置无效"};

        auto v = validateBritishMove(state, fromIt->second, *targetCoord, *it);
        if (!v.valid) return {false, v.reason};

        it->prevPos = fromIt->second;
        state.britishPositions[shipId] = *targetCoord;
        state.movedThisTurn.insert(shipId);
        return {true, ""};
    }

    ActionResult finishBritishMove() {
        if (state.phase != Phase::british_move)
            return {false, "当前不是英军移动阶段"};

        // bismarckFound 一旦为 true 就不再清除——规则 5.1，发现后所有英军永久解锁
        state.combatPending = false;
        state.transportRevealedHex = std::nullopt;  // 英军已看到标记，清除
        state.airSearchDone = false;
        state.phase = Phase::british_search;
        return {true, ""};
    }

    // ========== 索敌 ==========

    SearchResult doSearch() {
        auto result = checkCoLocationSearch(state);
        if (result.type == SearchType::CoLocate) {
            state.bismarckFound = true;

            // 6.2 伪装算子鉴定: 先处理所有被翻开的伪装算子
            for (const auto* bShip : result.revealedBritish) {
                if (bShip->def.isDummy) {
                    bool removed = checkDummyIdentification(state, *bShip, rng);
                    if (removed) {
                        const_cast<ShipState*>(bShip)->steps = 0;
                        state.britishPositions.erase(bShip->def.id);
                    } else {
                        state.germanPositionPublic = true;
                        state.failedDummies.insert(bShip->def.id);
                    }
                }
            }

            // 只有同格存在非伪装、未沉没的英军真船时才进入战斗
            bool hasRealCombat = false;
            for (const auto* s : result.revealedBritish) {
                if (!s->def.isDummy && s->steps > 0) { hasRealCombat = true; break; }
            }
            if (hasRealCombat) state.combatPending = true;
        }
        return result;
    }

    SearchResult doAirSearch(const std::string& adjacentLabel) {
        if (state.phase != Phase::british_search)
            return { SearchType::None, std::nullopt, {}, {}, std::nullopt };

        auto result = performAirSearch(state, adjacentLabel);
        if (!result.foundShips.empty()) {
            state.bismarckFound = true;
            state.combatPending = true;
        }
        return result;
    }

    ActionResult finishSearch() {
        if (state.phase != Phase::british_search)
            return {false, "当前不是索敌阶段"};

        if (state.combatPending) {
            state.phase = Phase::combat;
        } else {
            auto attackers = getTransportAttackers(state);
            if (!attackers.empty()) {
                state.transportPending = true;
                state.phase = Phase::transport_attack;
            } else {
                endTurn();
            }
        }
        return {true, ""};
    }

    // ========== 战斗 ==========

    CombatResult doCombat() {
        if (state.phase != Phase::combat) {
            return CombatResult{};
        }

        // 收集所有交火格
        std::unordered_set<std::string> combatCoords;
        for (const auto& bShip : state.britishShips) {
            if (bShip.steps <= 0 || bShip.def.isDummy) continue;
            auto bPosIt = state.britishPositions.find(bShip.def.id);
            if (bPosIt == state.britishPositions.end()) continue;
            for (const auto& gShip : state.germanShips) {
                if (gShip.steps <= 0) continue;
                auto gPosIt = state.germanPositions.find(gShip.def.id);
                if (gPosIt != state.germanPositions.end() && hexEquals(gPosIt->second, bPosIt->second))
                    combatCoords.insert(std::to_string(gPosIt->second.q) + "," + std::to_string(gPosIt->second.r));
            }
        }

        // Ark Royal 航空攻击相邻格
        ShipState* airTarget = nullptr;
        std::string airKey;
        auto arkIt = std::find_if(state.britishShips.begin(), state.britishShips.end(),
            [](const ShipState& s) { return s.def.id == "ark-royal" && s.steps > 0; });
        if (arkIt != state.britishShips.end()) {
            auto arPosIt = state.britishPositions.find("ark-royal");
            if (arPosIt != state.britishPositions.end()) {
                for (auto& gShip : state.germanShips) {
                    if (gShip.steps <= 0) continue;
                    auto gPosIt = state.germanPositions.find(gShip.def.id);
                    if (gPosIt != state.germanPositions.end() && hexDistance(arPosIt->second, gPosIt->second) == 1) {
                        airTarget = &gShip;
                        airKey = std::to_string(gPosIt->second.q) + "," + std::to_string(gPosIt->second.r);
                        break;
                    }
                }
            }
        }
        if (airTarget) combatCoords.insert(airKey);

        if (combatCoords.empty()) {
            return CombatResult{};
        }

        // 每个交火格依次结算
        CombatResult merged;
        for (const auto& key : combatCoords) {
            auto comma = key.find(',');
            int q = std::stoi(key.substr(0, comma));
            int r = std::stoi(key.substr(comma + 1));
            HexCoord coord{q, r};
            bool isAir = (key == airKey) && (airTarget != nullptr);
            auto r2 = resolveCombat(state, coord, rng, isAir, isAir ? airTarget : nullptr);
            merged.rounds.insert(merged.rounds.end(), r2.rounds.begin(), r2.rounds.end());
            merged.germanVpGained += r2.germanVpGained;
            merged.britishVpGained += r2.britishVpGained;
            merged.shipsSunk.insert(merged.shipsSunk.end(), r2.shipsSunk.begin(), r2.shipsSunk.end());
            merged.log.insert(merged.log.end(), r2.log.begin(), r2.log.end());
        }

        auto v = checkVictory(state);
        if (v.gameOver) { endGame(v); } else { endTurn(); }
        return merged;
    }

    // ========== 运输攻击 ==========

    TransportResult doTransportAttack(const std::string& shipId) {
        auto it = std::find_if(state.germanShips.begin(), state.germanShips.end(),
            [&](const ShipState& s) { return s.def.id == shipId; });
        if (it == state.germanShips.end())
            return {false, 0, "舰船不存在"};

        auto result = attackTransport(state, *it, rng);
        // 信号泄露：记录暴露位置 + 激活所有英军战舰
        if (result.positionRevealed) {
            auto posIt = state.germanPositions.find(shipId);
            if (posIt != state.germanPositions.end())
                state.transportRevealedHex = hexToLabel(posIt->second);
            state.bismarckFound = true;  // 英军获知德军位置，所有战舰解锁
        }

        state.transportPending = false;
        endTurn();
        return result;
    }

    void skipTransportAttack() {
        state.transportPending = false;
        endTurn();
    }

private:
    SeededRandom rng;

    void endGame(const VictoryCheck& v) {
        state.gameOver = true;
        state.winner = v.winner;
        state.victoryReason = v.reason;
        state.phase = Phase::game_over;
    }

    void endTurn() {
        state.phaseStep = 0;
        auto v = checkEndTurnVictory(state);
        if (v.gameOver) { endGame(v); return; }
        state.turn++;
        state.combatPending = false;
        state.transportPending = false;
        // transportRevealedHex 不清除——保留到英军移动阶段让玩家看到
        // germanPositionPublic 不清除——需保留到下一回合德军移动阶段
        state.movedThisTurn.clear();
        state.phase = Phase::german_move;
    }
};
