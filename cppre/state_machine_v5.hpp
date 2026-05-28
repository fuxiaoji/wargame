#pragma once
/** 状态机 AI (C++版) — 与 TS state-machine.ts 逻辑一致 */
#include "game.hpp"
#include "env.hpp"
#include "map.hpp"
#include "movement.hpp"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>
#include <unordered_map>

struct Weights {
    float w1=8,w2=3,w3=2,w4=4, w5=3,w6=2,w7=2,w8=1, w9=4,w10=2,w11=2, w12=1,w13=2,w14=1,w15=2;
    float rushF7Pull=-10, rushPathPull=1.0f, farmBasePull=2, farmVPScale=0.5f;
    float huntPull=3, hidePush=8, rushVPPenalty=4.0f, rushVPReward=3.0f;
    float s1=10,s2=0.5f,s3=1, h1=10,h2=5,h3=3, p1=3,p2=2,p3=2, d1=5,d2=3,d3=4;
    float temperature = 1.0f;
};

// ========== 概率工具 ==========
inline std::vector<float> softmax(const std::vector<float>& scores, float temp=1.0f) {
    float maxS = *std::max_element(scores.begin(), scores.end());
    std::vector<float> probs; float sum = 0;
    for (float s : scores) { float e = std::exp((s - maxS) / temp); probs.push_back(e); sum += e; }
    if (sum == 0) sum = 1;
    for (auto& p : probs) p /= sum;
    return probs;
}

inline int weightedPick(const std::vector<float>& scores, float temp=1.0f) {
    auto probs = softmax(scores, temp);
    float r = (float)std::rand() / RAND_MAX, cum = 0;
    for (size_t i = 0; i < probs.size(); i++) { cum += probs[i]; if (r <= cum) return (int)i; }
    return (int)probs.size() - 1;
}

inline std::pair<int,int> rcOf(const std::string& label) {
    if (label.size() < 2) return {-1,-1};
    int c = label[0] - 'A', r = std::stoi(label.substr(1)) - 1;
    return (c>=0 && c<6 && r>=0 && r<8) ? std::make_pair(r,c) : std::make_pair(-1,-1);
}

static std::string phName(Phase p) {
    switch (p) {
        case Phase::setup_german: return "setup-german"; case Phase::setup_british: return "setup-british";
        case Phase::german_move: return "german-move"; case Phase::british_move: return "british-move";
        case Phase::british_search: return "british-search"; case Phase::combat: return "combat";
        case Phase::transport_attack: return "transport-attack"; default: return "";
    }
}

// ========== 热力图 ==========
struct Heatmap {
    float data[8][6]{};
    std::unordered_map<std::string, int> recentVisits;

    void clear() { for(int r=0;r<8;r++) for(int c=0;c<6;c++) data[r][c]=0; }
    float get(int r,int c) const { return (r>=0&&r<8&&c>=0&&c<6) ? data[r][c] : 0; }
    void add(int r,int c,float v) { if(r>=0&&r<8&&c>=0&&c<6) data[r][c]+=v; }
    void set(int r,int c,float v) { if(r>=0&&r<8&&c>=0&&c<6) data[r][c]=v; }

    void addBritishShips(const GameState& st, float scale=1.0f) {
        // 德军所见所有英军算子均为"?", 不区分真船/伪装
        for (const auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto it = st.britishPositions.find(sh.def.id);
            if (it == st.britishPositions.end()) continue;
            auto label = hexToLabel(it->second); if (!label) continue;
            auto [r,c] = rcOf(*label); if (r<0) continue;
            add(r,c,2*scale);
            for (const auto& nb : hexNeighbors(it->second)) {
                auto nl = hexToLabel(nb); if (!nl) continue;
                auto [nr,nc] = rcOf(*nl); if (nr>=0) add(nr,nc,1*scale);
            }
        }
    }

    void addThreatRange(const GameState& st) {
        for (const auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto pit = st.britishPositions.find(sh.def.id);
            if (pit == st.britishPositions.end()) continue;
            for (int dr=-3; dr<=3; dr++)
                for (int dc=-3; dc<=3; dc++)
                    add(pit->second.r+dr, pit->second.q+dc, 0.5f);
        }
    }

    void applyAntiStuck(const std::string& label) {
        auto [r,c] = rcOf(label); if (r<0) return;
        int visits = recentVisits[label];
        if (visits >= 2) add(r, c, (visits - 1) * 4.0f); // 连停2回合才排斥
    }

    void recordVisit(const std::string& label) {
        recentVisits[label]++;
        for (auto& [k,v] : recentVisits) if (k != label) v = std::max(0, v - 1); // 动了就快速清零
    }
};

// ========== 德军 AI ==========
struct GermanBrain {
    Weights w;
    HexCoord lastBismarckPos{0,0}; bool hasLastPos = false;
    std::string lastStrategy = "rush";  // 供训练统计

    int selectAction(const GameState& st, const std::vector<GameAction>& actions, const std::string& phase) {
        if (phase == "setup-german") {
            std::vector<float> scores;
            for (auto& a : actions) scores.push_back(a.label.find("B7")!=std::string::npos?3:a.label.find("A6")!=std::string::npos?2:1);
            return actions[weightedPick(scores, 0.5f)].id;
        }
        if (phase == "german-move") {
            return handleMove(st, actions);
        }
        if (phase == "transport-attack") {
            std::vector<int> tIds;
            for (auto& a : actions) if (a.type == ActionType::Transport) tIds.push_back(a.id);
            if (!tIds.empty() && (float)std::rand()/RAND_MAX < 0.7f) return tIds[std::rand()%tIds.size()];
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        return actions[0].id;
    }

    int handleMove(const GameState& st, const std::vector<GameAction>& actions) {
        // 找当前船
        const ShipState* curShip = nullptr;
        for (auto& a : actions) {
            if (a.type == ActionType::Move && !a.shipId.empty()) {
                for (auto& s : st.germanShips) if (s.def.id == a.shipId && s.steps > 0) { curShip = &s; break; }
                break;
            }
        }
        if (!curShip) {
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        auto it = st.germanPositions.find(curShip->def.id);
        if (it == st.germanPositions.end()) {
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        HexCoord pos = it->second;
        if (curShip->def.id == "bismarck") { lastBismarckPos = pos; hasLastPos = true; }

        Heatmap hm;
        hm.addBritishShips(st);
        hm.addThreatRange(st);

        // 策略得分
        auto f7 = HexCoord{5,6};
        float distF7 = (float)hexDistance(pos, f7);
        bool onRoute = isSeaRoute(pos);
        int britNearF7 = 0;
        for (auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto pit = st.britishPositions.find(sh.def.id);
            if (pit != st.britishPositions.end() && hexDistance(pit->second, f7) <= 3) britNearF7++;
        }
        int nearbyBrit = 0;
        for (auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto pit = st.britishPositions.find(sh.def.id);
            if (pit != st.britishPositions.end() && hexDistance(pos, pit->second) <= 3) nearbyBrit++;
        }
        float avgProx = 0; int proxCnt = 0;
        for (auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto pit = st.britishPositions.find(sh.def.id);
            if (pit != st.britishPositions.end()) { avgProx += hexDistance(pos, pit->second); proxCnt++; }
        }
        avgProx = proxCnt > 0 ? avgProx / proxCnt / 8.0f : 0;

        bool vpLead = st.vp.german > st.vp.british;
        float vpGap = (float)std::max(0, st.vp.british - st.vp.german);
        float rush = w.w1 * std::max(0.0f, (8.0f - distF7) / 8.0f) + w.w2*(curShip->steps/(float)curShip->def.maxSteps)
                   + w.w3*(1-britNearF7/5.0f) - w.w4*(st.bismarckFound?1.0f:0)
                   + (vpLead ? w.rushVPReward : -vpGap * w.rushVPPenalty);
        float farm = w.w5*(onRoute?1:0) + w.w6*(1-st.vp.german/6.0f) + w.w7*(st.bismarckFound?0:1) + w.w8*0.3f;
        // 计算孤立英军目标 (德军所见均为"?", 不区分真船/伪装)
        int isolatedTargets = 0;
        for (auto& sh : st.britishShips) {
            if (sh.steps <= 0) continue;
            auto pit = st.britishPositions.find(sh.def.id);
            if (pit == st.britishPositions.end()) continue;
            int nearby = 0;
            for (auto& sh2 : st.britishShips) {
                if (sh2.steps <= 0 || sh2.def.id == sh.def.id) continue;
                auto p2 = st.britishPositions.find(sh2.def.id);
                if (p2 != st.britishPositions.end() && hexDistance(pit->second, p2->second) <= 3) nearby++;
            }
            if (nearby == 0) isolatedTargets++;
        }
        float hunt = w.w9 * isolatedTargets + w.w10*0.5f - w.w11*nearbyBrit;
        float hide = w.w12*(st.bismarckFound?1:0) + w.w13*(curShip->steps<2?1:0) + w.w14*avgProx - w.w15*(1-st.vp.german/6.0f);

        // 船特定修正
        bool isBismarck = curShip->def.id == "bismarck";
        float shipBonus[4] = { isBismarck?2.f:-2.f, isBismarck?0.f:1.f, isBismarck?-3.f:3.f, isBismarck?1.f:0.f };
        std::vector<float> finalScores{rush+shipBonus[0], farm+shipBonus[1], hunt+shipBonus[2], hide+shipBonus[3]};

        // 融合 5% 均匀
        auto probs = softmax(finalScores, w.temperature);
        for (int i = 0; i < 4; i++) probs[i] = probs[i]*0.95f + 0.25f*0.05f;

        std::vector<std::string> strategies{"rush","farm","hunt","hide"};
        int pickedIdx = weightedPick(finalScores, w.temperature); // 用原始得分, 避免双重softmax
        lastStrategy = strategies[pickedIdx];

        // 策略修正热力图
        if (lastStrategy == "rush") {
            hm.set(6,5, hm.get(6,5) + w.rushF7Pull);
            for (auto& nb : hexNeighbors(f7)) { auto nl = hexToLabel(nb); if (nl) { auto [r,c]=rcOf(*nl); if (r>=0) hm.set(r,c,hm.get(r,c)+w.rushF7Pull*0.5f); } }
            { const char* wp[] = {"D8","E7","F6","D6","C6","C7"}; float wv[] = {-4,-5,-7,-3,-2,-2};
              for (int i=0;i<6;i++) { auto [r,c]=rcOf(wp[i]); if (r>=0) hm.set(r,c,hm.get(r,c)+wv[i]*w.rushPathPull); } }
        } else if (lastStrategy == "farm") {
            float farmPull = -(w.farmBasePull + (6 - st.vp.german) * w.farmVPScale);
            for (auto& l : {"D2","D3","C3","C4","D5","E1","E4","E5"}) { auto [r,c]=rcOf(l); if (r>=0) hm.set(r,c,hm.get(r,c)+farmPull); }
        } else if (lastStrategy == "hunt") {
            // 主动猎杀: 孤立英军目标周围吸引
            for (auto& sh : st.britishShips) {
                if (sh.steps <= 0) continue;
                auto pit = st.britishPositions.find(sh.def.id); if (pit==st.britishPositions.end()) continue;
                int nearby=0;
                for (auto& sh2 : st.britishShips) { if(sh2.steps>0&&sh2.def.id!=sh.def.id){auto p2=st.britishPositions.find(sh2.def.id);if(p2!=st.britishPositions.end()&&hexDistance(pit->second,p2->second)<=3)nearby++;} }
                if (nearby==0) {
                    for (int r=0;r<8;r++) for (int c=0;c<6;c++) {
                        float d = hexDistance(pit->second, {c,r});
                        hm.add(r,c, -w.huntPull/(1+d));
                    }
                }
            }
        } else if (lastStrategy == "hide") {
            for (auto& sh : st.britishShips) {
                if (sh.steps <= 0) continue;
                auto pit = st.britishPositions.find(sh.def.id); if (pit==st.britishPositions.end()) continue;
                for (int dr=-3; dr<=3; dr++) for (int dc=-3; dc<=3; dc++)
                    hm.add(pit->second.r+dr, pit->second.q+dc, w.hidePush);
            }
        }

        // 防死锁
        for (auto& a : actions) if (a.type == ActionType::Move && !a.targetLabel.empty()) hm.applyAntiStuck(a.targetLabel);

        // 得分 = -heat (neg传播: 远处负值贡献)
        std::vector<int> moveIds; std::vector<float> moveScores;
        for (auto& a : actions) {
            if (a.type != ActionType::Move) continue;
            auto [r,c] = rcOf(a.targetLabel);
            if (r<0) { moveIds.push_back(a.id); moveScores.push_back(0); continue; }
            float base = -hm.get(r,c), bonus = 0;
            for (int pr=0;pr<8;pr++) for (int pc=0;pc<6;pc++) {
                float v = hm.data[pr][pc]; if (v >= 0) continue;
                float d = std::abs(pr-r) + std::abs(pc-c);
                if (d > 0) bonus += -v / ((1+d)*(1+d));
            }
            moveIds.push_back(a.id);
            moveScores.push_back(base + bonus + ((float)std::rand()/RAND_MAX-0.5f)*0.1f);
        }
        if (!moveIds.empty()) {
            int pick = weightedPick(moveScores, 0.5f);
            if (pick < (int)moveIds.size()) { hm.recordVisit(actions[pick].targetLabel); return moveIds[pick]; }
        }
        for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
        return actions[0].id;
    }
};

// ========== 英军 AI ==========
struct BritishBrain {
    Weights w;
    HexCoord lastKnownGermanPos{0,0}; bool hasLastKnown = false;
    int turnsSinceSeen = 0;

    int selectAction(const GameState& st, const std::vector<GameAction>& actions, const std::string& phase) {
        if (phase == "british-search") {
            // 航空索敌：优先搜德军冲港路线上的格
            std::vector<std::string> priority{"D8","E7","F6","D7","C7","E6","C6","D6","D5","E5"};
            std::unordered_set<std::string> priSet(priority.begin(), priority.end());
            std::vector<int> airIds; std::vector<float> airScores;
            for (auto& a : actions) if (a.type == ActionType::AirSearch) {
                airIds.push_back(a.id);
                airScores.push_back(priSet.count(a.targetLabel) ? 5.0f : 1.0f);
            }
            if (!airIds.empty()) return airIds[weightedPick(airScores, 0.8f)];
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        if (phase == "british-move") {
            Heatmap hm;
            // 当前舰船位置 (从第一个action获取)
            HexCoord pos{0,0}; bool hasPos = false;
            if (!actions.empty() && !actions[0].targetLabel.empty()) {
                auto [r,c] = rcOf(actions[0].targetLabel); if (r>=0) { pos = {c,r}; hasPos = true; }
            }
            auto bismarck = std::find_if(st.germanShips.begin(), st.germanShips.end(),
                [](auto& s){ return s.def.id == "bismarck" && s.steps > 0; });
            if (bismarck != st.germanShips.end()) {
                auto bp = st.germanPositions.find("bismarck");
                if (bp != st.germanPositions.end() && (st.germanPositionPublic || st.bismarckFound)) {
                    lastKnownGermanPos = bp->second; hasLastKnown = true; turnsSinceSeen = 0;
                }
            }
            if (!st.bismarckFound) turnsSinceSeen++;

            // 主动防守 + patrol
            float proactive = (st.turn >= 8 ? 1.0f : 0) + (st.vp.german >= 3 ? 1.0f : 0) + (st.vp.german >= 5 ? 2.0f : 0);
            bool inGerRange = hasLastKnown && hexDistance(pos, lastKnownGermanPos) <= turnsSinceSeen*2+2;
            bool onRoute = isSeaRoute(pos);
            float searchS = w.s1*(!st.bismarckFound?1:0) - w.s2*turnsSinceSeen - w.s3*st.vp.german/2.0f;
            // hunt拥挤惩罚: 超过5艘在目标附近→扣分
            int huntCount = 0;
            for (auto& sh : st.britishShips) if (sh.steps>0){ auto p=st.britishPositions.find(sh.def.id); if(p!=st.britishPositions.end()&&hexDistance(p->second,hasLastKnown?lastKnownGermanPos:pos)<=4)huntCount++; }
            float huntCrowd = std::max(0, huntCount-5)*1.5f;

            float patrolS = w.p1*(onRoute?1:0) + w.p2*(inGerRange?1:0) + w.p3*(1-(st.bismarckFound?0.5f:0));
            float defendS = w.d1*0 + w.d2*(st.vp.german>=5?1:0) + w.d3*1 + proactive;
            float huntS = w.h1*(st.bismarckFound?1:0); if(hasLastKnown)huntS+=w.h2*(5.0f/(hexDistance(pos,lastKnownGermanPos)+1));
            huntS += w.h3*1 - huntCrowd;
            std::vector<float> strScores{searchS, huntS, patrolS, defendS};
            int picked = weightedPick(strScores, w.temperature);

            // ===== 共享基图: 德军可能位置 (所有策略可见) =====
            int gTurns = hasLastKnown ? turnsSinceSeen : st.turn;
            if (hasLastKnown) {
                int radius = std::min(gTurns * 2, 8);
                for (int r=0;r<8;r++) for (int c=0;c<6;c++) {
                    float d = hexDistance({c,r}, lastKnownGermanPos);
                    if (d <= radius) hm.add(r,c, -std::max(0.2f, (radius-d)*0.25f));
                }
            } else {
                for (auto& l : GERMAN_START_HEXES) { auto [sr,sc]=rcOf(l); if(sr>=0){
                    int radius = std::min(gTurns * 2, 8);
                    for (int r=0;r<8;r++) for (int c=0;c<6;c++) {
                        float d = hexDistance({sc,sr}, {c,r});
                        if (d <= radius) hm.add(r,c, -std::max(0.2f, (radius-d)*0.25f));
                    }
                }}
            }

            // ===== 策略叠加 =====
            if (picked == 0) { // search — 分散
                for (auto& sh : st.britishShips) {
                    if (sh.steps <= 0 || sh.def.id == actions[0].shipId) continue;
                    auto pit = st.britishPositions.find(sh.def.id);
                    if (pit != st.britishPositions.end()) hm.add(pit->second.r, pit->second.q, 2);
                }
            } else if (picked == 1) { // hunt — 扩散梯度 + 近处抱团
                for (auto& sh : st.britishShips) {
                    if (sh.steps <= 0 || sh.def.id == actions[0].shipId) continue;
                    auto pit = st.britishPositions.find(sh.def.id);
                    if (pit != st.britishPositions.end() && hexDistance(pos,pit->second) <= 3) hm.add(pit->second.r, pit->second.q, -1);
                }
                if (hasLastKnown) {
                    float huntRadius = std::min(turnsSinceSeen*2.0f+2.0f, 6.0f);
                    for (int r=0;r<8;r++) for (int c=0;c<6;c++) {
                        float d = hexDistance({c,r}, lastKnownGermanPos);
                        if (d <= 1) hm.add(r,c, -6);
                        else if (d <= huntRadius) hm.add(r,c, -(4.0f - d*0.6f));
                        else if (d <= huntRadius+2) hm.add(r,c, 1);
                    }
                }
                // 如果俾斯麦与英军同格 → 全图 swarm
                if (st.bismarckFound) {
                    auto bpIt = st.germanPositions.find("bismarck");
                    if (bpIt != st.germanPositions.end()) {
                        for (auto& sh : st.britishShips) {
                            if (sh.steps <= 0) continue;
                            auto pit = st.britishPositions.find(sh.def.id);
                            if (pit != st.britishPositions.end() && hexDistance(pit->second, bpIt->second) == 0) {
                                for (int r=0;r<8;r++) for (int c=0;c<6;c++) {
                                    float d = hexDistance(bpIt->second, {c,r});
                                    hm.add(r,c, -5.0f / (1 + d)); // 高引力, 距离反比衰减
                                }
                                break;
                            }
                        }
                    }
                }
            } else if (picked == 2) { // patrol — 蹲航路(不碰F7)
                for (auto& l : {"D2","D3","C3","C4","D5","E1","E4","E5"}) {
                    auto [r,c] = rcOf(l); if (r>=0) hm.add(r,c,-3);
                }
                for (auto& l : {"D7","C7","D6"}) {
                    auto [r,c] = rcOf(l); if (r>=0) hm.add(r,c,-1);
                }
            } else { // defend — 死守F7
                auto [fr,fc] = rcOf("F7"); if (fr>=0) hm.set(fr,fc,-6);
                for (auto& nb : hexNeighbors({5,6})) {
                    auto nl = hexToLabel(nb); if (nl) { auto [nr,nc] = rcOf(*nl); if (nr>=0) hm.add(nr,nc,-3); }
                }
            }

            for (auto& a : actions) if (a.type == ActionType::Move && !a.targetLabel.empty()) hm.applyAntiStuck(a.targetLabel);

            std::vector<int> moveIds; std::vector<float> moveScores;
            for (auto& a : actions) {
                if (a.type != ActionType::Move) continue;
                auto [r,c] = rcOf(a.targetLabel);
                if (r<0) { moveIds.push_back(a.id); moveScores.push_back(0); continue; }
                float base = -hm.get(r,c), bonus = 0;
                for (int pr=0;pr<8;pr++) for (int pc=0;pc<6;pc++) {
                    float v = hm.data[pr][pc]; if (v >= 0) continue;
                    float d = std::abs(pr-r) + std::abs(pc-c);
                    if (d > 0) bonus += -v / ((1+d)*(1+d));
                }
                moveIds.push_back(a.id);
                moveScores.push_back(base + bonus + ((float)std::rand()/RAND_MAX-0.5f)*0.2f);
            }
            if (!moveIds.empty()) {
                int pick = weightedPick(moveScores, 0.6f);
                if (pick < (int)moveIds.size()) return moveIds[pick];
            }
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        if (phase == "combat") {
            for (auto& a : actions) if (a.type == ActionType::Combat) return a.id;
            return actions[0].id;
        }
        return actions[0].id;
    }
};
