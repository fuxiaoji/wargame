#ifndef TYPES_HPP
#define TYPES_HPP

#include <string>
#include <optional>
#include <vector>
#include <map>
#include <unordered_set>

// ========== 坐标系统 ==========

/** 六角格轴向坐标 (q 列, r 行) */
struct HexCoord {
    int q;
    int r;

    bool operator==(const HexCoord& other) const {
        return q == other.q && r == other.r;
    }
    bool operator<(const HexCoord& other) const {
        return q < other.q || (q == other.q && r < other.r);
    }
};

// ========== 舰船 ==========

enum class ShipSide {
    german,
    british
};

/** 舰船定义 (静态属性) */
struct ShipDef {
    std::string id;
    std::string name;
    ShipSide side;
    int attack;         // 攻击力 = 投骰数
    int defense;        // 防御力 = 目标值
    int maxSteps;       // 最大 Step (1, 2, or 4 for Bismarck)
    int speed;          // 移动力 (格数)
    bool isCarrier;     // 是否可航空索敌
    bool isDummy;       // 是否伪装算子
};

/** 舰船运行时状态 */
struct ShipState {
    ShipDef def;
    int steps;                      // 当前剩余 Step (0 = 沉没)
    bool revealed;                  // 是否已翻开
    std::optional<HexCoord> moveTarget; // std::optional 对应 TS 的 "| null"
    std::optional<HexCoord> prevPos;    // 对应 TS 的 "_prevPos?"
};

// ========== 地图 ==========

struct HexCell {
    HexCoord coord;
    std::string label;      // 格号，如 "A5"
    bool isLand;            // 陆地格 (不可进入)
    bool isPort;            // 港口格
    bool isSeaRoute;        // 运输航路格
};

// ========== 游戏状态 ==========

enum class Phase {
    setup_german,       // 德军选起始格
    setup_british,      // 英军摆子
    german_move,        // 德军隐藏移动
    british_move,       // 英军移动
    british_search,     // 英军索敌
    combat,             // 战斗结算
    transport_attack,   // 攻击运输舰队
    game_over
};

struct GameState {
    // 舰船
    std::vector<ShipState> germanShips;
    std::vector<ShipState> britishShips;

    // 位置 (shipId → HexCoord)
    std::map<std::string, HexCoord> germanPositions;
    std::map<std::string, HexCoord> britishPositions;

    // 回合与阶段
    int turn;               // 1-18
    Phase phase;
    int phaseStep;          // 当前阶段内的子步骤

    // 分数
    struct { int german; int british; } vp;

    // 状态标记
    bool bismarckFound;
    bool combatPending;
    bool transportPending;

    // 本回合德军位置是否公开 (伪装鉴定失败后)
    bool germanPositionPublic;

    // 伪装鉴定失败需要跟随德军的伪装算子 ID
    std::unordered_set<std::string> failedDummies;

    // 本回合已移动过的舰船
    std::unordered_set<std::string> movedThisTurn;

    // 本回合是否已执行航空索敌（每回合限一次）
    bool airSearchDone;

    // 运输攻击信号泄露暴露的位置（英军移动阶段可见）
    std::optional<std::string> transportRevealedHex;

    // 终局
    bool gameOver;
    std::optional<ShipSide> winner;  // 开局为 nullopt

    std::string victoryReason;
};

#endif // TYPES_HPP
