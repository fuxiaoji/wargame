#pragma once

#include "game.hpp"
#include "map.hpp"
#include "movement.hpp"
#include <fstream>
#include <cstring>
#include <sys/stat.h>
#ifdef _WIN32
#include <direct.h>
inline int make_dir(const char* path) { return _mkdir(path); }
#else
inline int make_dir(const char* path) { return mkdir(path, 0755); }
#endif
#include <deque>

// ========== 常量 ==========
constexpr int T = 73, C = 128, H = 8, W = 6;
constexpr size_t SLICE_SIZE = C * H * W;
constexpr size_t TENSOR_SIZE = T * SLICE_SIZE;
constexpr uint32_t MAGIC = 0x42534D42;

// ========== 网格坐标工具 ==========
inline std::pair<int,int> labelToRowCol(const std::string& label) {
    if (label.empty() || label == "?") return {-1, -1};
    int col = label[0] - 'A';
    int row = std::stoi(label.substr(1)) - 1;
    return {row, col};
}

inline void setChannel(float* slice, int ch, int row, int col, float val) {
    if (row >= 0 && row < H && col >= 0 && col < W)
        slice[ch * H * W + row * W + col] = val;
}

inline void fillChannel(float* slice, int ch, float val) {
    for (int i = 0; i < H * W; ++i) slice[ch * H * W + i] = val;
}

// ========== 跨步状态追踪（轨迹衰减用） ==========
struct TensorLoggerState {
    std::deque<HexCoord> bismarckTrail; // 俾斯麦历史位置，新→旧
    std::deque<HexCoord> eugenTrail;
    int prevDummyCount = 0;            // 上一步伪装算子存活数

    void reset() {
        bismarckTrail.clear(); eugenTrail.clear(); prevDummyCount = 0;
    }
};

// ========== 填充单步切片 ==========
inline void fillStateSlice(float* slice, const GameState& s, ShipSide viewer, TensorLoggerState* tracker = nullptr) {
    std::memset(slice, 0, SLICE_SIZE * sizeof(float));

    // ==============================
    // Block 1: 静态地理与全局 (Ch 0-15) —— 双方可见
    // ==============================
    for (const auto& [label, coord] : labelToCoord) {
        auto [r, c] = labelToRowCol(label);
        setChannel(slice, 0, r, c, 1.0f);
    }
    for (const auto& label : {"D2","D3","C4","C3","D5","E1","E4","E5"})
        { auto [r,c] = labelToRowCol(label); setChannel(slice,1,r,c,1.0f); }
    { auto [r,c] = labelToRowCol("F7"); setChannel(slice,2,r,c,1.0f); }
    for (const auto& label : {"A5","A6","B7"})
        { auto [r,c] = labelToRowCol(label); setChannel(slice,3,r,c,1.0f); }
    fillChannel(slice, 4, s.phase == Phase::german_move ? 1.0f : 0.0f);
    fillChannel(slice, 5, s.phase == Phase::british_move ? 1.0f : 0.0f);
    fillChannel(slice, 6, s.phase == Phase::british_search ? 1.0f : 0.0f);
    fillChannel(slice, 7, (s.phase == Phase::combat || s.phase == Phase::transport_attack) ? 1.0f : 0.0f);
    fillChannel(slice, 8, s.turn / 18.0f);
    fillChannel(slice, 9, s.vp.british / 6.0f);
    fillChannel(slice, 10, s.vp.german / 6.0f);
    // Ch 11-15: 预留给寻路距离场 (BFS到布雷斯特距离等)，暂清零

    // ==============================
    // Block 2: 英军实体 (Ch 16-47)
    // ==============================
    auto fillBritShip = [&](int baseCh, const std::string& id) {
        auto it = s.britishPositions.find(id);
        if (it == s.britishPositions.end()) return;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        auto shIt = std::find_if(s.britishShips.begin(), s.britishShips.end(),
            [&](const ShipState& sh){ return sh.def.id == id; });
        if (shIt == s.britishShips.end() || shIt->steps <= 0) return;
        setChannel(slice, baseCh,   r, c, 1.0f);
        setChannel(slice, baseCh+1, r, c, shIt->steps / (float)shIt->def.maxSteps);
        setChannel(slice, baseCh+2, r, c, shIt->def.attack / 4.0f);
        setChannel(slice, baseCh+3, r, c, (!s.bismarckFound && !shIt->def.isDummy
            && shIt->def.id != "hood" && shIt->def.id != "prince-of-wales") ? 1.0f : 0.0f);
    };
    fillBritShip(16, "hood");
    fillBritShip(20, "prince-of-wales");
    fillBritShip(24, "ark-royal");

    // Ch 28-31: 其他2Step舰聚合 (乔治五世/罗德尼/声望/反击/胜利)
    for (const auto& sh : s.britishShips) {
        if (sh.steps <= 0 || sh.def.isDummy) continue;
        if (sh.def.id == "hood" || sh.def.id == "prince-of-wales" || sh.def.id == "ark-royal") continue;
        if (sh.def.maxSteps != 2) continue;
        auto it = s.britishPositions.find(sh.def.id);
        if (it == s.britishPositions.end()) continue;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        setChannel(slice, 28, r, c, 1.0f);
        setChannel(slice, 29, r, c, sh.steps / 2.0f);
        setChannel(slice, 30, r, c, sh.def.attack / 4.0f);
    }

    // Ch 32-35: 1Step舰聚合 (诺福克/萨福克)
    for (const auto& sh : s.britishShips) {
        if (sh.steps <= 0 || sh.def.isDummy) continue;
        if (sh.def.maxSteps != 1) continue;
        auto it = s.britishPositions.find(sh.def.id);
        if (it == s.britishPositions.end()) continue;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        setChannel(slice, 32, r, c, 1.0f);
        setChannel(slice, 33, r, c, 1.0f); // 1Step 满血为 1
        setChannel(slice, 34, r, c, sh.def.attack / 4.0f);
    }

    // Ch 36-39: 伪装算子
    for (const auto& sh : s.britishShips) {
        if (sh.steps <= 0 || !sh.def.isDummy) continue;
        auto it = s.britishPositions.find(sh.def.id);
        if (it == s.britishPositions.end()) continue;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        setChannel(slice, 36, r, c, 1.0f);
        setChannel(slice, 37, r, c, 1.0f);
        setChannel(slice, 38, r, c, 0.0f);
        setChannel(slice, 39, r, c, 3.0f);
    }

    // Ch 40: 英军匿名位置 (所有背面朝上的算子叠加，专供德军)
    for (const auto& sh : s.britishShips) {
        if (sh.steps <= 0) continue;
        auto it = s.britishPositions.find(sh.def.id);
        if (it == s.britishPositions.end()) continue;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        setChannel(slice, 40, r, c, 1.0f);
    }

    // Ch 41-47: 预留扩展，清零

    // ==============================
    // Block 3: 德军实体 (Ch 48-63)
    // ==============================
    auto fillGerShip = [&](int baseCh, const std::string& id) {
        auto it = s.germanPositions.find(id);
        if (it == s.germanPositions.end()) return;
        auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
        auto shIt = std::find_if(s.germanShips.begin(), s.germanShips.end(),
            [&](const ShipState& sh){ return sh.def.id == id; });
        if (shIt == s.germanShips.end() || shIt->steps <= 0) return;
        float spd = getShipSpeed(*shIt);
        setChannel(slice, baseCh,   r, c, 1.0f);
        setChannel(slice, baseCh+1, r, c, shIt->steps / (float)shIt->def.maxSteps);
        setChannel(slice, baseCh+2, r, c, shIt->def.attack / 4.0f);
        setChannel(slice, baseCh+3, r, c, spd / 3.0f);
    };
    fillGerShip(48, "bismarck");
    fillGerShip(52, "prinz-eugen");
    // Ch 56-63: 预留扩展

    // ==============================
    // Block 4: 战场事件与遗迹 (Ch 64-95)
    // ==============================
    // Ch 64: 同格索敌暴露的德军坐标
    if (s.bismarckFound && s.combatPending) {
        for (const auto& gShip : s.germanShips) {
            if (gShip.steps <= 0) continue;
            auto it = s.germanPositions.find(gShip.def.id);
            if (it == s.germanPositions.end()) continue;
            auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
            setChannel(slice, 64, r, c, 1.0f);
        }
    }
    // Ch 65: 航空侦察暴露的坐标 (Ark Royal 索敌成功)
    // 引擎层面和 Ch64 同样触发，均标记
    if (s.bismarckFound && s.combatPending) {
        // 航空索敌检测: Ark Royal 邻格命中德军
        auto arkIt = std::find_if(s.britishShips.begin(), s.britishShips.end(),
            [](const ShipState& sh){ return sh.def.id == "ark-royal" && sh.steps > 0; });
        if (arkIt != s.britishShips.end()) {
            auto arPos = s.britishPositions.find("ark-royal");
            if (arPos != s.britishPositions.end()) {
                for (const auto& gShip : s.germanShips) {
                    if (gShip.steps <= 0) continue;
                    auto gPos = s.germanPositions.find(gShip.def.id);
                    if (gPos == s.germanPositions.end()) continue;
                    if (hexDistance(arPos->second, gPos->second) == 1) {
                        auto [r,c] = labelToRowCol(hexToLabel(gPos->second).value_or(""));
                        setChannel(slice, 65, r, c, 1.0f);
                    }
                }
            }
        }
    }
    // Ch 66: 运输信号泄露坐标
    if (s.transportRevealedHex) {
        auto [r,c] = labelToRowCol(*s.transportRevealedHex);
        setChannel(slice, 66, r, c, 1.0f);
    }
    // Ch 67: 伪装算子被移除的位置
    if (tracker) {
        int curDummyCount = 0;
        for (const auto& sh : s.britishShips)
            if (sh.def.isDummy && sh.steps > 0) curDummyCount++;
        if (curDummyCount < tracker->prevDummyCount) {
            // 有伪装被移除，在其最后已知位置标 1
            for (const auto& sh : s.britishShips) {
                if (!sh.def.isDummy || sh.steps > 0) continue;
                auto it = s.britishPositions.find(sh.def.id);
                if (it == s.britishPositions.end()) { // 已被 erase 的伪装
                    // 无法追踪最后位置，需在 game.hpp 记录
                }
            }
        }
        tracker->prevDummyCount = curDummyCount;
    }
    // Ch 68: 索敌未发现格 (Fog Cleared)
    // 需要在 search 过程中记录，暂通过 bismarckFound 推断
    if (s.phase == Phase::british_search && !s.bismarckFound && !s.combatPending) {
        // 当前回合排查过且未发现——标记英军周围海域
        for (const auto& sh : s.britishShips) {
            if (sh.steps <= 0) continue;
            auto it = s.britishPositions.find(sh.def.id);
            if (it == s.britishPositions.end()) continue;
            auto [r,c] = labelToRowCol(hexToLabel(it->second).value_or(""));
            setChannel(slice, 68, r, c, 1.0f);
        }
    }
    // Ch 69-79: 德军历史轨迹衰减 (Pheromone)
    if (tracker) {
        // 记录当前位置
        for (const auto& gShip : s.germanShips) {
            if (gShip.steps <= 0) continue;
            auto it = s.germanPositions.find(gShip.def.id);
            if (it == s.germanPositions.end()) continue;
            if (gShip.def.id == "bismarck") {
                tracker->bismarckTrail.push_front(it->second);
                if (tracker->bismarckTrail.size() > 10) tracker->bismarckTrail.pop_back();
            } else if (gShip.def.id == "prinz-eugen") {
                tracker->eugenTrail.push_front(it->second);
                if (tracker->eugenTrail.size() > 10) tracker->eugenTrail.pop_back();
            }
        }
        // 衰减写入: Ch69 = t-0(1.0), Ch70 = t-1(0.9), Ch71 = t-2(0.8), ...
        for (size_t i = 0; i < tracker->bismarckTrail.size() && i < 10; i++) {
            auto [r,c] = labelToRowCol(hexToLabel(tracker->bismarckTrail[i]).value_or(""));
            float decay = 1.0f - i * 0.1f;
            setChannel(slice, 69 + i, r, c, decay);
        }
        for (size_t i = 0; i < tracker->eugenTrail.size() && i < 10; i++) {
            auto [r,c] = labelToRowCol(hexToLabel(tracker->eugenTrail[i]).value_or(""));
            float decay = 1.0f - i * 0.1f;
            float cur = (i < 10 && 69 + i < 80) ? slice[(69+i)*H*W + r*W + c] : 0.0f;
            setChannel(slice, 69 + i, r, c, std::max(cur, decay));
        }
    }
    // Ch 80-95: 预留观测变化

    // ==============================
    // Block 5: 认知草稿区 (Ch 96-127) —— 引擎清零，网络填写
    // ==============================
    // 96-127 已由 memset 清零
}

// ========== 动作记录 (8字节/步，与 TS 二进制兼容) ==========
struct ActionRecord {
    uint8_t step_index;
    uint8_t phase;
    uint8_t side;
    uint8_t action_type; // 0=move, 1=finish, 2=air_search, 3=combat, 4=transport
    int8_t ship_id;
    int8_t target_q;     // -1=无
    int8_t target_r;
    int8_t padding;
};

// ========== 结果元数据 ==========
struct GameLogResult {
    std::string winner;
    int vp_german, vp_british, turns;
    int total_steps, seed;
    bool bismarck_sunk, brest_reached;
};

inline std::string writeJson(const GameLogResult& r, const std::string& gameId) {
    std::ostringstream j;
    j << "{\"game_id\":\"" << gameId << "\"";
    j << ",\"winner\":\"" << r.winner << "\"";
    j << ",\"vp_german\":" << r.vp_german;
    j << ",\"vp_british\":" << r.vp_british;
    j << ",\"turns\":" << r.turns;
    j << ",\"total_steps\":" << r.total_steps;
    j << ",\"seed\":" << r.seed;
    j << ",\"bismarck_sunk\":" << (r.bismarck_sunk ? "true" : "false");
    j << ",\"brest_reached\":" << (r.brest_reached ? "true" : "false") << "}";
    return j.str();
}

// ========== 写入 API ==========
inline void writeGameLog(const std::string& dir, const std::string& gameId,
    const std::vector<float>& stateBuf,
    const std::vector<ActionRecord>& actions,
    const GameLogResult& result) {

    std::string fullDir = dir + "/" + gameId;
    make_dir(fullDir.c_str());

    {
        std::ofstream f(fullDir + "/state.bin", std::ios::binary);
        uint32_t magic = MAGIC;
        int32_t dims[4] = {T, C, H, W};
        f.write((char*)&magic, 4);
        f.write((char*)dims, 16);
        f.write((char*)stateBuf.data(), stateBuf.size() * sizeof(float));
    }
    {
        std::ofstream f(fullDir + "/action.bin", std::ios::binary);
        for (const auto& act : actions)
            f.write((char*)&act, sizeof(ActionRecord));
    }
    {
        std::ofstream f(fullDir + "/result.json");
        f << writeJson(result, gameId);
    }
}

// ========== 便捷包装 ==========
inline void logGame(BismarckEnv& env, const std::string& dir, const std::string& gameId, int seed) {
    std::vector<float> stateBuf;
    std::vector<ActionRecord> actions;
    stateBuf.reserve(TENSOR_SIZE);

    TensorLoggerState tracker;
    tracker.reset();

    int stepIdx = 0;
    while (!env.game.state.gameOver && stepIdx < T) {
        float slice[SLICE_SIZE];
        fillStateSlice(slice, env.game.state, ShipSide::german, &tracker);
        stateBuf.insert(stateBuf.end(), slice, slice + SLICE_SIZE);

        auto obs = env.getObservation();
        auto& acts = obs.actions;
        if (acts.empty()) break;

        ActionRecord rec{};
        rec.step_index = (uint8_t)stepIdx;
        rec.phase = (uint8_t)env.game.state.phase;
        rec.side = (uint8_t)(obs.activePlayer == ShipSide::german ? 0 : 1);
        rec.target_q = -1; rec.target_r = -1;

        int pick = std::rand() % acts.size();
        if (obs.phase == Phase::setup_british && acts.size() == 1 && acts[0].type == ActionType::Move) {
            env.autoPlaceBritish();
            rec.action_type = 0;
        } else {
            auto& a = acts[pick];
            rec.action_type = (uint8_t)a.type;
            if (!a.targetLabel.empty()) {
                auto [r, c] = labelToRowCol(a.targetLabel);
                rec.target_q = c; rec.target_r = r;
            }
            env.step(a);
        }
        actions.push_back(rec);
        stepIdx++;
    }

    float zeroSlice[SLICE_SIZE]{};
    while (stepIdx < T) {
        stateBuf.insert(stateBuf.end(), zeroSlice, zeroSlice + SLICE_SIZE);
        ActionRecord empty{};
        empty.step_index = (uint8_t)stepIdx;
        empty.phase = 7; empty.target_q = -1; empty.target_r = -1;
        actions.push_back(empty);
        stepIdx++;
    }

    const auto& s = env.game.state;
    GameLogResult res;
    res.winner = s.winner && *s.winner == ShipSide::german ? "german" : "british";
    res.vp_german = s.vp.german; res.vp_british = s.vp.british;
    res.turns = s.turn; res.total_steps = stepIdx; res.seed = seed;
    res.bismarck_sunk = [&](){
        auto it = std::find_if(s.germanShips.begin(), s.germanShips.end(),
            [](const ShipState& sh){ return sh.def.id == "bismarck"; });
        return it != s.germanShips.end() && it->steps <= 0;
    }();
    res.brest_reached = s.victoryReason.find("布雷斯特") != std::string::npos;

    writeGameLog(dir, gameId, stateBuf, actions, res);
}
