#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <unordered_set>
#include <queue>
#include <array>
#include <optional>
#include <algorithm>
#include <cctype>
#include "type.hpp" // 确保 HexCoord 和 HexCell 定义在此

// ========== 轴向六角格坐标工具 ==========

// 偶数列(A/C/E)和奇数列(B/D/F)邻接方向不同,因为奇数列左偏
inline constexpr std::array<HexCoord, 6> EVEN_Q_DIRS = {{
    { 1,  0}, { 1,  1},   // 下一列(奇数列左偏:同r=左下, r+1=正下)
    { 0, -1},             // 同列左
    { 0,  1},             // 同列右
    {-1,  0}, {-1,  1}    // 上一列(同r=左上, r+1=正上)
}};

inline constexpr std::array<HexCoord, 6> ODD_Q_DIRS = {{
    { 1, -1}, { 1,  0},   // 下一列: 左下/右下
    { 0, -1},             // 同列左
    { 0,  1},             // 同列右
    {-1, -1}, {-1,  0}    // 上一列: 左上/右上
}};

inline bool hexEquals(HexCoord a, HexCoord b) {
    return a.q == b.q && a.r == b.r;
}

inline HexCoord hexAdd(HexCoord a, HexCoord b) {
    return { a.q + b.q, a.r + b.r };
}

// 提前声明
inline std::vector<HexCoord> hexNeighbors(HexCoord coord);

inline int hexDistance(HexCoord a, HexCoord b) {
    // 用 BFS 计算奇偶列感知的实际距离
    if (a.q == b.q && a.r == b.r) return 0;
    
    std::unordered_set<std::string> visited;
    
    struct Node {
        HexCoord coord;
        int dist;
    };
    std::queue<Node> queue;
    
    queue.push({a, 0});
    visited.insert(std::to_string(a.q) + "," + std::to_string(a.r));
    
    while (!queue.empty()) {
        Node current = queue.front();
        queue.pop();
        
        for (const auto& nb : hexNeighbors(current.coord)) {
            if (nb.q == b.q && nb.r == b.r) return current.dist + 1;
            
            std::string k = std::to_string(nb.q) + "," + std::to_string(nb.r);
            if (visited.count(k)) continue;
            
            visited.insert(k);
            if (current.dist + 1 >= 8) continue;  // 最大搜索8步(远超游戏需求)
            
            queue.push({nb, current.dist + 1});
        }
    }
    return 999;  // 对应 TS 的 Infinity，表示不可达
}

inline std::vector<HexCoord> hexNeighbors(HexCoord coord) {
    const auto& dirs = (coord.q % 2 == 0) ? EVEN_Q_DIRS : ODD_Q_DIRS;
    std::vector<HexCoord> neighbors;
    neighbors.reserve(6);
    for (const auto& d : dirs) {
        neighbors.push_back(hexAdd(coord, d));
    }
    return neighbors;
}

// ========== 格号 ↔ 轴向坐标 ==========
// q=列字母索引(A=0..F=5), r=行数字(1-indexed, 与地图标注一致)

// C++ 中可以直接使用初始化列表来构建 Map，比 TS 的 for 循环更加简洁
inline const std::unordered_map<std::string, HexCoord> labelToCoord = {
    {"A3", {0, 3}}, {"A4", {0, 4}}, {"A5", {0, 5}}, {"A6", {0, 6}},
    {"B2", {1, 2}}, {"B3", {1, 3}}, {"B4", {1, 4}}, {"B5", {1, 5}}, {"B6", {1, 6}}, {"B7", {1, 7}},
    {"C1", {2, 1}}, {"C2", {2, 2}}, {"C3", {2, 3}}, {"C4", {2, 4}}, {"C5", {2, 5}}, {"C6", {2, 6}}, {"C7", {2, 7}},
    {"D1", {3, 1}}, {"D2", {3, 2}}, {"D3", {3, 3}}, {"D4", {3, 4}}, {"D5", {3, 5}}, {"D6", {3, 6}}, {"D7", {3, 7}}, {"D8", {3, 8}},
    {"E1", {4, 1}}, {"E2", {4, 2}}, {"E3", {4, 3}}, {"E4", {4, 4}}, {"E5", {4, 5}}, {"E6", {4, 6}}, {"E7", {4, 7}},
    {"F1", {5, 1}}, {"F2", {5, 2}}, {"F3", {5, 3}}, {"F4", {5, 4}}, {"F5", {5, 5}}, {"F6", {5, 6}}, {"F7", {5, 7}}
};

// 使用一个立即执行的 Lambda 表达式来初始化反向查找表
inline const std::unordered_map<std::string, std::string> coordToLabel = []() {
    std::unordered_map<std::string, std::string> map;
    for (const auto& [label, c] : labelToCoord) {
        map[std::to_string(c.q) + "," + std::to_string(c.r)] = label;
    }
    return map;
}();
// 各号格坐标转换函数，返回 std::optional 来表示可能的无效输入
// std::optional 是 C++17 完美替代 TypeScript 联合类型 "HexCoord | null" 的方案
inline std::optional<HexCoord> labelToHex(std::string label) {
    // 将输入转换为大写
    std::transform(label.begin(), label.end(), label.begin(), ::toupper);
    auto it = labelToCoord.find(label);
    if (it != labelToCoord.end()) return it->second;
    return std::nullopt;
}
// 反向查找：坐标 → 格号
inline std::optional<std::string> hexToLabel(HexCoord coord) {
    std::string key = std::to_string(coord.q) + "," + std::to_string(coord.r);
    auto it = coordToLabel.find(key);
    if (it != coordToLabel.end()) return it->second;
    return std::nullopt;
}

inline bool isValidCoord(HexCoord coord) {
    std::string key = std::to_string(coord.q) + "," + std::to_string(coord.r);
    return coordToLabel.count(key) > 0;
}

// ========== 地图属性 (来自实际游戏规则/地图) ==========

inline const std::string BREST_HEX = "F7";
inline const std::vector<std::string> GERMAN_START_HEXES = {"A5", "A6", "B7"};

/** 运输航路格 */
inline const std::unordered_set<std::string> SEA_ROUTE_HEXES = {
    "D2", "D3", "C4", "C5",  // 大西洋航路
    "E4", "E5"               // 非洲航路
};

/** 港口格 */
inline const std::unordered_set<std::string> PORT_HEXES = {
    "F7", "D8", "G6"
};

/** 陆地格 (完全不可进入) */
inline const std::unordered_set<std::string> LAND_HEXES = {};

/** 被阻断的边 (两个相邻格之间不可通行, 英国本土隔断) */
inline const std::unordered_set<std::string> BLOCKED_EDGES = {
    "D6-D7", "D7-D6",
    "E5-E6", "E6-E5",
    "E6-D7", "D7-E6",
    "E6-F7", "F7-E6",
    "E6-E7", "E7-E6"
};

// ========== 公开接口 ==========

inline bool isLand(HexCoord coord) {
    auto label = hexToLabel(coord);
    if (!label) return true; // 如果地图外，默认不可进入 (视为陆地)
    return LAND_HEXES.count(*label) > 0;
}

/** 两个邻格之间是否被阻断 */
inline bool isBlocked(HexCoord a, HexCoord b) {
    auto la = hexToLabel(a);
    auto lb = hexToLabel(b);
    if (!la || !lb) return true;
    return BLOCKED_EDGES.count(*la + "-" + *lb) > 0;
}

inline bool isPort(HexCoord coord) {
    auto label = hexToLabel(coord);
    return label ? (PORT_HEXES.count(*label) > 0) : false;
}

inline bool isSeaRoute(HexCoord coord) {
    auto label = hexToLabel(coord);
    return label ? (SEA_ROUTE_HEXES.count(*label) > 0) : false;
}

inline bool isBrest(HexCoord coord) {
    auto label = hexToLabel(coord);
    return label ? (*label == BREST_HEX) : false;
}

inline std::optional<HexCell> getHexCell(HexCoord coord) {
    auto label = hexToLabel(coord);
    if (!label) return std::nullopt;
    
    // 注意：确保 types.h 中定义了 HexCell 结构体
    return HexCell{ 
        coord, 
        *label, 
        isLand(coord), 
        isPort(coord), 
        isSeaRoute(coord) 
    };
}

inline std::vector<HexCell> getAllHexCells() {
    std::vector<HexCell> cells;
    cells.reserve(labelToCoord.size()); // 提前分配内存，提高性能
    for (const auto& [label, coord] : labelToCoord) {
        cells.push_back({
            coord, 
            label, 
            isLand(coord), 
            isPort(coord), 
            isSeaRoute(coord)
        });
    }
    return cells;
}

inline std::vector<std::string> getAllLabels() {
    std::vector<std::string> labels;
    labels.reserve(labelToCoord.size());
    for (const auto& [label, coord] : labelToCoord) {
        labels.push_back(label);
    }
    return labels;
}

// 对应 TS 返回的对象，我们在 C++ 中定义一个辅助结构体
struct MapBounds {
    int minQ; int maxQ; int minR; int maxR;
};

inline MapBounds getMapBounds() {
    int minQ = 9999, maxQ = -9999, minR = 9999, maxR = -9999; // C++ 常用的大数边界
    for (const auto& [label, c] : labelToCoord) {
        if (c.q < minQ) minQ = c.q;
        if (c.q > maxQ) maxQ = c.q;
        if (c.r < minR) minR = c.r;
        if (c.r > maxR) maxR = c.r;
    }
    return { minQ, maxQ, minR, maxR };
}