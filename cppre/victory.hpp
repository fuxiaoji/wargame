#pragma once

#include <algorithm>
#include <optional>
#include <string>
#include "type.hpp"
#include "map.hpp"

struct VictoryCheck {
    bool gameOver;
    std::optional<ShipSide> winner;
    std::string reason;
};

inline VictoryCheck checkVictory(const GameState& state) {
    // 德军 6 VP 立即胜利
    if (state.vp.german >= 6) {
        return { true, ShipSide::german, "德军获得 6 分，立即胜利!" };
    }

    // 俾斯麦被击沉 → 英军立即胜利
    auto it = std::find_if(state.germanShips.begin(), state.germanShips.end(),
        [](const ShipState& s) { return s.def.id == "bismarck"; });
    if (it != state.germanShips.end() && it->steps <= 0) {
        return { true, ShipSide::british, "俾斯麦号被击沉，英军胜利!" };
    }

    return { false, std::nullopt, "" };
}

inline VictoryCheck checkEndTurnVictory(const GameState& state) {
    auto immediate = checkVictory(state);
    if (immediate.gameOver) return immediate;

    // 18 回合结束 → 英军胜利
    if (state.turn > 18) {
        return { true, ShipSide::british, "18 回合结束，德军未达成胜利条件，英军胜利!" };
    }

    // 俾斯麦占据布雷斯特且 VP 领先 → 德军胜利
    auto posIt = state.germanPositions.find("bismarck");
    if (posIt != state.germanPositions.end() && isBrest(posIt->second)) {
        auto it = std::find_if(state.germanShips.begin(), state.germanShips.end(),
            [](const ShipState& s) { return s.def.id == "bismarck"; });
        if (it != state.germanShips.end() && it->steps > 0) {
            if (state.vp.german > state.vp.british) {
                return { true, ShipSide::german, "俾斯麦号抵达布雷斯特且德军 VP 领先，德军胜利!" };
            }
        }
    }

    return { false, std::nullopt, "" };
}
