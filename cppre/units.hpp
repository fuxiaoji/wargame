#ifndef UNITS_HPP
#define UNITS_HPP

#include <string>
#include <vector>
#include <set>
#include <optional>
#include "type.hpp"

// ========== 德军舰船 ==========

inline const ShipDef BISMARCK = {
    .id = "bismarck",
    .name = "俾斯麦号",
    .side = ShipSide::german,
    .attack = 4,
    .defense = 6,
    .maxSteps = 4,
    .speed = 2,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef PRINZ_EUGEN = {
    .id = "prinz-eugen",
    .name = "欧根亲王号",
    .side = ShipSide::german,
    .attack = 2,
    .defense = 5,
    .maxSteps = 2,
    .speed = 2,
    .isCarrier = false,
    .isDummy = false
};

// ========== 英军舰船 ==========

inline const ShipDef HOOD = {
    .id = "hood",
    .name = "胡德号",
    .side = ShipSide::british,
    .attack = 4,
    .defense = 6,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef PRINCE_OF_WALES = {
    .id = "prince-of-wales",
    .name = "威尔士亲王号",
    .side = ShipSide::british,
    .attack = 3,
    .defense = 6,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef ARK_ROYAL = {
    .id = "ark-royal",
    .name = "皇家方舟号",
    .side = ShipSide::british,
    .attack = 1,
    .defense = 5,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = true,
    .isDummy = false
};

inline const ShipDef KING_GEORGE_V = {
    .id = "king-george-v",
    .name = "乔治五世号",
    .side = ShipSide::british,
    .attack = 3,
    .defense = 6,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef RODNEY = {
    .id = "rodney",
    .name = "罗德尼号",
    .side = ShipSide::british,
    .attack = 3,
    .defense = 6,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef RENOWN = {
    .id = "renown",
    .name = "声望号",
    .side = ShipSide::british,
    .attack = 2,
    .defense = 5,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef REPULSE = {
    .id = "repulse",
    .name = "反击号",
    .side = ShipSide::british,
    .attack = 2,
    .defense = 5,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef VICTORIOUS = {
    .id = "victorious",
    .name = "胜利号",
    .side = ShipSide::british,
    .attack = 1,
    .defense = 5,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = true,
    .isDummy = false
};

inline const ShipDef RAMILLIES = {
    .id = "ramillies",
    .name = "拉米伊号",
    .side = ShipSide::british,
    .attack = 3,
    .defense = 6,
    .maxSteps = 2,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef NORFOLK = {
    .id = "norfolk",
    .name = "诺福克号",
    .side = ShipSide::british,
    .attack = 2,
    .defense = 5,
    .maxSteps = 1,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

inline const ShipDef SUFFOLK = {
    .id = "suffolk",
    .name = "萨福克号",
    .side = ShipSide::british,
    .attack = 2,
    .defense = 5,
    .maxSteps = 1,
    .speed = 3,
    .isCarrier = false,
    .isDummy = false
};

// ========== 伪装算子 ==========

inline ShipDef makeDummy(int index) {
    return {
        .id = "dummy-" + std::to_string(index),
        .name = "伪装算子 " + std::to_string(index),
        .side = ShipSide::british,
        .attack = 0,
        .defense = 0,
        .maxSteps = 1,
        .speed = 3,
        .isCarrier = false,
        .isDummy = true
    };
}

// ========== 舰船列表 ==========

inline const std::vector<ShipDef> ALL_GERMAN_SHIPS = { BISMARCK, PRINZ_EUGEN };

inline const std::vector<ShipDef> ALL_BRITISH_SHIPS = {
    HOOD, PRINCE_OF_WALES, ARK_ROYAL, KING_GEORGE_V,
    RODNEY, RENOWN, REPULSE, VICTORIOUS, RAMILLIES,
    NORFOLK, SUFFOLK
};

inline constexpr int DUMMY_COUNT = 4;

// 模拟 TS 的 Array.from + 扩展运算符
inline std::vector<ShipDef> getAllBritishDummies() {
    std::vector<ShipDef> dummies;
    for (int i = 1; i <= DUMMY_COUNT; ++i) {
        dummies.push_back(makeDummy(i));
    }
    return dummies;
}

// 模拟 [...ALL_BRITISH_SHIPS, ...ALL_BRITISH_DUMMIES]
inline std::vector<ShipDef> getAllBritishTokens() {
    std::vector<ShipDef> tokens = ALL_BRITISH_SHIPS;
    auto dummies = getAllBritishDummies();
    tokens.insert(tokens.end(), dummies.begin(), dummies.end());
    return tokens;
}

// ========== ShipState 工厂 ==========

inline ShipState createShipState(const ShipDef& def) {
    return {
        .def = def,
        .steps = def.maxSteps,
        .revealed = false,
        .moveTarget = std::nullopt // 对应 TS 的 null
    };
}

/** 英军舰船中可提前移动的 (5.1) */
inline const std::set<std::string> CAN_MOVE_BEFORE_DETECTION = { "hood", "prince-of-wales" };

inline bool canMoveBeforeDetection(const ShipDef& ship) {
    return ship.isDummy || CAN_MOVE_BEFORE_DETECTION.count(ship.id);
}

#endif // UNITS_HPP