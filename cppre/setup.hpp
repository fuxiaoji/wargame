#pragma once

#include <set>
#include <string>
#include <vector>
#include <unordered_map>
#include "type.hpp"
#include "units.hpp"
#include "random.hpp"

inline const std::unordered_map<std::string, std::vector<std::string>> BRITISH_FIXED_POSITIONS = {
    { "C6", { "king-george-v", "repulse", "victorious" } },
    { "D6", { "rodney" } },
    { "F4", { "renown", "ark-royal" } },
    { "F1", { "ramillies" } },
};

inline std::set<std::string> getFixedBritishShipIds() {
    std::set<std::string> ids;
    for (const auto& [label, shipIds] : BRITISH_FIXED_POSITIONS) {
        ids.insert(shipIds.begin(), shipIds.end());
    }
    return ids;
}

// ---- 初始化函数 ----

inline std::vector<ShipState> createInitialGermanShips() {
    std::vector<ShipState> ships;
    for (const auto& def : ALL_GERMAN_SHIPS) {
        ships.push_back(createShipState(def));
    }
    return ships;
}

inline std::vector<ShipState> createInitialBritishTokens() {
    std::vector<ShipState> tokens;
    for (const auto& def : getAllBritishTokens()) {
        tokens.push_back(createShipState(def));
    }
    return tokens;
}

inline GameState createGameState() {
    GameState s{};
    s.germanShips = createInitialGermanShips();
    s.britishShips = createInitialBritishTokens();
    s.turn = 1;
    s.phase = Phase::setup_german;
    s.phaseStep = 0;
    s.vp = { 0, 0 };
    s.bismarckFound = false;
    s.combatPending = false;
    s.transportPending = false;
    s.germanPositionPublic = false;
    s.transportRevealedHex = std::nullopt;
    s.airSearchDone = false;
    s.gameOver = false;
    s.winner = std::nullopt;
    return s;
}

inline std::vector<std::string> getBritishSetupLabels() {
    return { "E7", "E6", "E5", "E3", "E2", "E1", "D7", "D5", "D1", "C7", "C1", "B6", "F6", "F5", "F3", "F2" };
}
