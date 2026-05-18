#pragma once

#include "type.hpp"
#include "map.hpp"
#include "units.hpp"
#include <vector>
#include <string>
#include <unordered_set>
#include <queue>
#include <algorithm>


struct MoveValidation
{
    bool valid;
    std::string reason; // 如果无效，说明原因
};

/** bfs */
std::vector<std::string> getReachableLabels(HexCoord from, int maxSteps) {
    std::unordered_set<std::string> visited;
    std::vector<std::string> result;
    auto queue = std::queue<std::pair<HexCoord, int>>( ); // pair<当前坐标, 已经走的步数>
    queue.push({from, 0});
    
    visited.insert(std::to_string(from.q) + "," + std::to_string(from.r));

    while (!queue.empty()) {
        auto [current, steps] = queue.front();
        queue.pop();
        if (steps >= maxSteps) continue; // 到边界，不再扩展
        
        auto labelOpt = hexToLabel(current);
        if (steps > 0 && labelOpt) { // 起始点不算在内
            result.push_back(*labelOpt);
        }
        for (const auto& nb : hexNeighbors(current)) {
            auto nbLabelOpt = hexToLabel(nb);
            if (!nbLabelOpt) continue; // 无效坐标
            const std::string& nbLabel = *nbLabelOpt;
            if (visited.count(nbLabel) > 0) continue; // 已访问
            if (isLand(nb)) continue; // 陆地不可通行
            if (isBlocked(current, nb)) continue; // 被阻断
            
            visited.insert(nbLabel);
            queue.push({nb, steps + 1});
        }
    }
    return result;
}
bool canReachBySea(HexCoord from, HexCoord to, int maxSteps) {
    if (hexEquals(from, to)) return true;
    // BFS 直接搜索 to，找到即返回
    std::unordered_set<std::string> visited;
    std::queue<std::pair<HexCoord, int>> q;
    q.push({from, 0});
    visited.insert(std::to_string(from.q) + "," + std::to_string(from.r));

    while (!q.empty()) {
        auto [cur, steps] = q.front(); q.pop();
        if (steps >= maxSteps) continue;
        for (const auto& nb : hexNeighbors(cur)) {
            if (hexEquals(nb, to)) return true;
            if (!isValidCoord(nb) || isLand(nb)) continue;
            if (isBlocked(cur, nb)) continue;
            std::string key = std::to_string(nb.q) + "," + std::to_string(nb.r);
            if (visited.count(key)) continue;
            visited.insert(key);
            q.push({nb, steps + 1});
        }
    }
    return false;
}
int getShipSpeed(const ShipState& ship) {
    if (ship.steps <= 0) return 0; // 沉没的船无法移动
    if (ship.def.id == "bismarck") return ship.steps >= ship.def.maxSteps ? 2 : 1; // 俾斯麦特殊规则：无论剩余 Step，始终以满速移动
    return ship.def.speed;
}
MoveValidation validateGermanMove(HexCoord from, HexCoord to, const ShipState& ship) {
    if (ship.def.side != ShipSide::german) {
        return { false, "不是德军舰船" };
    }
    if (ship.steps <= 0) {
        return { false, "舰船已沉没" };
    }
    if (hexEquals(from, to)) return { true, "" };
    int speed = getShipSpeed(ship);
    if (!canReachBySea(from, to, speed)) {
        return { false, "无法在 " + std::to_string(speed) + " 格内到达目标格" };
    }
    return { true, "" };
}

MoveValidation validateBritishMove(const GameState& state, HexCoord from, HexCoord to, const ShipState& ship) {
    if (ship.def.side != ShipSide::british) {
        return { false, "不是英军舰船" };
    }
    if (ship.steps <= 0) {
        return { false, "舰船已沉没" };
    }
    if (hexEquals(from, to)) return { true, "" };
    if (state.movedThisTurn.count(ship.def.id)) {
        return { false, "本回合已移动过此舰船" };
    }
    if (!state.bismarckFound && !canMoveBeforeDetection(ship.def)) {
        return { false, "发现德军前此舰船不能移动" };
    }
    if (!canReachBySea(from, to, 3)) {
        return { false, "无法在 3 格内到达目标格" };
    }
    return { true, "" };
}
std::vector<std::string> getGermanReachableLabels(HexCoord from, const ShipState& ship) {
    if (ship.def.side != ShipSide::german) {
        return {}; // 只能验证德军舰船的移动范围
    }
    if (ship.steps <= 0) {
        return {}; // 沉没的船无法移动
    }
    int speed = getShipSpeed(ship);
    return getReachableLabels(from, speed);
}
std::vector<std::string> getBritishReachableLabels(const GameState& state, HexCoord from, const ShipState& ship) {
    if (!state.bismarckFound && !canMoveBeforeDetection(ship.def)) return {};
    if (state.movedThisTurn.count(ship.def.id)) return {};
    return getReachableLabels(from, 3);
}