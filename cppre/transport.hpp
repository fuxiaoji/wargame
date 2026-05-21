#pragma once

#include <string>
#include <vector>
#include "type.hpp"
#include "map.hpp"
#include "random.hpp"

struct TransportResult {
    bool positionRevealed;
    int vpGained;
    std::string description;
};

// 运输舰队查表 (索引 = D6-1)
struct TransportEntry { int vp; bool reveal; };

inline const TransportEntry TRANSPORT_TABLE[6] = {
    { .vp = 0, .reveal = true  },   // 1: 信号泄露
    { .vp = 0, .reveal = false },   // 2: 无效果
    { .vp = 1, .reveal = false },   // 3: 1 VP
    { .vp = 1, .reveal = true  },   // 4: 1 VP + 信号泄露
    { .vp = 2, .reveal = false },   // 5: 2 VP
    { .vp = 2, .reveal = true  },   // 6: 2 VP + 信号泄露
};

inline bool isOnSeaRoute(const ShipState& ship, const GameState& state) {
    auto posIt = state.germanPositions.find(ship.def.id);
    return posIt != state.germanPositions.end() && isSeaRoute(posIt->second);
}

inline std::vector<const ShipState*> getTransportAttackers(const GameState& state) {
    std::vector<const ShipState*> attackers;
    for (const auto& s : state.germanShips) {
        if (s.steps <= 0) continue;
        auto posIt = state.germanPositions.find(s.def.id);
        if (posIt != state.germanPositions.end() && isSeaRoute(posIt->second)) {
            attackers.push_back(&s);
        }
    }
    return attackers;
}

inline TransportResult attackTransport(
    GameState& state,
    const ShipState& ship,
    IRandomizer& rng
) {
    int roll = rng.d6();
    const auto& entry = TRANSPORT_TABLE[roll - 1];

    auto posIt = state.germanPositions.find(ship.def.id);
    std::string label = posIt != state.germanPositions.end()
        ? hexToLabel(posIt->second).value_or("?") : "?";

    std::string desc = ship.def.name + " 在 " + label
        + " 攻击运输舰队: 骰点 " + std::to_string(roll) + " → ";

    if (entry.vp == 0 && entry.reveal) desc += "信号泄露! 德军必须宣告当前位置。";
    else if (entry.vp == 0)           desc += "无效果。";
    else if (entry.vp > 0 && entry.reveal) desc += "获得 " + std::to_string(entry.vp) + " VP，但信号泄露!";
    else                             desc += "获得 " + std::to_string(entry.vp) + " VP。";

    state.vp.german += entry.vp;

    return { entry.reveal, entry.vp, desc };
}
