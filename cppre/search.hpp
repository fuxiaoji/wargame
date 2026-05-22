#pragma once

#include <vector>
#include <string>
#include <optional>

#include "type.hpp"
#include "map.hpp"
#include "random.hpp" 

// 1. 使用枚举类替代 TS 的字符串字面量联合类型
enum class SearchType {
    None,
    CoLocate,
    AirSearch
};

// 2. 搜索结果结构体
struct SearchResult {
    SearchType type;
    std::optional<std::string> germanLabel;
    
    // ⚠️ 极其关键：必须存指针 (ShipState*)！
    // 这样才能保证我们拿到的是场上的实体战舰，而不是被拷贝出来的新战舰
    std::vector<ShipState*> foundShips;
    std::vector<ShipState*> revealedBritish;
    std::optional<std::string> searchedAdjacent;
};

/** 同格索敌 (6.0): 德军与英军同格时必须告知格号 */
// 注意入参：使用 GameState& (引用传递)，允许函数内部修改游戏状态
inline SearchResult checkCoLocationSearch(GameState& state) {
    std::vector<ShipState*> found;
    std::vector<ShipState*> revealed;

    // 使用 auto& 遍历，确保操作的是原对象
    for (auto& gShip : state.germanShips) {
        if (gShip.steps <= 0) continue;
        
        // C++ 字典安全取值法
        auto gPosIt = state.germanPositions.find(gShip.def.id);
        if (gPosIt == state.germanPositions.end()) continue;
        HexCoord gPos = gPosIt->second;

        for (auto& bShip : state.britishShips) {
            if (bShip.steps <= 0) continue;
            // 伪装算子也要参与同格索敌——规则 6.0："英军"包括伪装

            auto bPosIt = state.britishPositions.find(bShip.def.id);
            if (bPosIt == state.britishPositions.end()) continue;
            HexCoord bPos = bPosIt->second;

            if (hexEquals(gPos, bPos)) {
                if (!bShip.revealed) {
                    bShip.revealed = true;
                    revealed.push_back(&bShip); // 取地址存入指针
                }
                found.push_back(&gShip);
            }
        }
    }

    if (!found.empty()) {
        auto gPosIt = state.germanPositions.find(found[0]->def.id);
        std::optional<std::string> label = gPosIt != state.germanPositions.end()
            ? hexToLabel(gPosIt->second) : std::nullopt;
        return { SearchType::CoLocate, label, found, revealed, std::nullopt };
    }

    return { SearchType::None, std::nullopt, {}, {}, std::nullopt };
}

/** 航空索敌 (6.1): Ark Royal 对相邻格搜索 */
inline SearchResult performAirSearch(GameState& state, const std::string& adjacentLabel) {
    auto targetCoordOpt = labelToHex(adjacentLabel);
    if (!targetCoordOpt) {
        return { SearchType::None, std::nullopt, {}, {}, std::nullopt };
    }
    HexCoord targetCoord = *targetCoordOpt;

    std::vector<ShipState*> found;
    for (auto& gShip : state.germanShips) {
        if (gShip.steps <= 0) continue;
        
        auto gPosIt = state.germanPositions.find(gShip.def.id);
        if (gPosIt != state.germanPositions.end() && hexEquals(gPosIt->second, targetCoord)) {
            found.push_back(&gShip);
        }
    }

    return {
        SearchType::AirSearch,
        found.empty() ? std::nullopt : std::make_optional(adjacentLabel),
        found,
        {}, 
        adjacentLabel 
    };
}

/** 获取航空索敌可选邻格 (Ark Royal 周边有效格) */
inline std::vector<std::string> getAirSearchTargets(HexCoord arkRoyalPos) {
    std::vector<std::string> validLabels;
    std::vector<HexCoord> neighbors = hexNeighbors(arkRoyalPos);
    
    for (const auto& c : neighbors) {
        auto labelOpt = hexToLabel(c);
        if (labelOpt) {
            validLabels.push_back(*labelOpt);
        }
    }
    return validLabels;
}

/** 伪装算子鉴定 (6.2): 投骰决定伪装算子是否移除 */
// TS 原版返回 { removed: boolean }，在 C++ 里直接返回 bool 更清爽
inline bool checkDummyIdentification(const GameState& state, const ShipState& dummy, IRandomizer& rng) {
    if (!dummy.def.isDummy) return false;

    int speed = 2; // 默认满速
    
    // C++ 中查找特定元素的标准算法
    auto it = std::find_if(state.germanShips.begin(), state.germanShips.end(), [](const ShipState& s) {
        return s.def.id == "bismarck";
    });

    if (it != state.germanShips.end()) {
        const auto& bismarck = *it;
        speed = (bismarck.steps >= bismarck.def.maxSteps) ? 2 : 1;
    }

    int roll = rng.d6();
    int threshold = (speed == 2) ? 4 : 2;

    return roll <= threshold;
}

/** 获取指定格的德军舰船 */
inline std::vector<ShipState*> getGermanShipsAt(GameState& state, HexCoord coord) {
    std::vector<ShipState*> result;
    for (auto& ship : state.germanShips) {
        if (ship.steps <= 0) continue;
        auto posIt = state.germanPositions.find(ship.def.id);
        if (posIt != state.germanPositions.end() && hexEquals(posIt->second, coord)) {
            result.push_back(&ship);
        }
    }
    return result;
}

/** 获取指定格的英军舰船 */
inline std::vector<ShipState*> getBritishShipsAt(GameState& state, HexCoord coord) {
    std::vector<ShipState*> result;
    for (auto& ship : state.britishShips) {
        if (ship.steps <= 0) continue;
        auto posIt = state.britishPositions.find(ship.def.id);
        if (posIt != state.britishPositions.end() && hexEquals(posIt->second, coord)) {
            result.push_back(&ship);
        }
    }
    return result;
}
