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
#include <string>

struct Weights {
    float w1=3,w2=2,w3=1,w4=4, w5=2,w6=3,w7=2,w8=1, w9=3,w10=2,w11=2, w12=5,w13=4,w14=1,w15=2;
    float s1=10,s2=0.5f,s3=1, h1=10,h2=5,h3=3, d1=5,d2=3,d3=4;
    float temperature = 1.0f;
};

inline std::pair<int,int> rcOf(const std::string& label) {
    if (label.size() < 2) return {-1,-1};
    int c = label[0] - 'A', r = std::stoi(label.substr(1)) - 1;
    return (c>=0 && c<6 && r>=0 && r<8) ? std::make_pair(r,c) : std::make_pair(-1,-1);
}

// softmax 采样
inline int weightedPick(const std::vector<float>& scores, float temp = 1.0f) {
    float maxS = *std::max_element(scores.begin(), scores.end());
    std::vector<float> probs; float sum = 0;
    for (float s : scores) { float e = std::exp((s - maxS) / temp); probs.push_back(e); sum += e; }
    float r = (float)std::rand() / RAND_MAX, cum = 0;
    for (size_t i = 0; i < probs.size(); i++) { cum += probs[i] / sum; if (r <= cum) return (int)i; }
    return (int)probs.size() - 1;
}

struct Heatmap {
    float data[8][6]{};
    void clear() { for (int r=0;r<8;r++) for (int c=0;c<6;c++) data[r][c]=0; }
    void add(int r, int c, float v) { if (r>=0&&r<8&&c>=0&&c<6) data[r][c] += v; }
    float get(int r,int c) const { return (r>=0&&r<8&&c>=0&&c<6) ? data[r][c] : 0; }
    void set(int r,int c,float v) { if (r>=0&&r<8&&c>=0&&c<6) data[r][c]=v; }

    void addBritishShips(const GameState& st, float scale=1.0f) {
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

    void addSpawnZone() {
        for (auto& l : {"A5","A6","B7"}) { auto [r,c]=rcOf(l); if (r>=0) add(r,c,3); }
    }
};

struct GermanBrain {
    Weights w;
    HexCoord lastBismarckPos{0,0}; bool hasLastPos = false;

    int selectAction(const GameState& st, const std::vector<GameAction>& actions, const std::string& phase) {
        if (phase == "setup-german") {
            // 倾向 B7
            std::vector<float> scores;
            for (auto& a : actions) scores.push_back(a.label.find("B7") != std::string::npos ? 3 : a.label.find("A6") != std::string::npos ? 2 : 1);
            return actions[weightedPick(scores, 0.5f)].id;
        }
        if (phase == "german-move") {
            // 找到当前船
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
            // 威胁范围简化
            for (const auto& sh : st.britishShips) {
                if (sh.steps <= 0) continue;
                auto pit = st.britishPositions.find(sh.def.id);
                if (pit == st.britishPositions.end()) continue;
                for (int dr=-3; dr<=3; dr++) for (int dc=-3; dc<=3; dc++)
                    hm.add(pit->second.r+dr, pit->second.q+dc, 0.5f);
            }

            // 策略得分简化
            float onRoute = isSeaRoute(pos) ? 1 : 0;
            auto f7 = HexCoord{5,6};
            float distF7 = hexDistance(pos, f7);
            float rush = w.w1/(distF7+1) + w.w2*(curShip->steps/(float)curShip->def.maxSteps) - w.w4*(st.bismarckFound?2:0);
            float farm = w.w5*onRoute + w.w6*(1-st.vp.german/6.0f) + w.w7*(st.bismarckFound?0:1);
            float hide = w.w12*(st.bismarckFound?1:0) + w.w13*(curShip->steps<2?1:0);

            // 船特定修正
            bool isBismarck = curShip->def.id == "bismarck";
            float shipBonus[4] = { isBismarck ? 2.f : -2.f, isBismarck ? 0.f : 1.f, isBismarck ? -3.f : 3.f, isBismarck ? 1.f : 0.f };
            std::vector<float> strScores{rush + shipBonus[0], farm + shipBonus[1], 0.f + shipBonus[2], hide + shipBonus[3]};
            int picked = weightedPick(strScores, w.temperature);

            if (picked == 0) { hm.set(6,5, hm.get(6,5)-10); }
            else if (picked == 1) {
                for (auto& l : {"D2","D3","C3","C4","D5","E1","E4","E5"}) { auto [r,c]=rcOf(l); if (r>=0) hm.set(r,c,hm.get(r,c)-2); }
            }

            std::vector<int> moveIds; std::vector<float> moveScores;
            for (auto& a : actions) {
                if (a.type != ActionType::Move) continue;
                auto [r,c] = rcOf(a.targetLabel);
                moveIds.push_back(a.id);
                moveScores.push_back((r>=0) ? -hm.get(r,c) + ((float)std::rand()/RAND_MAX-0.5f)*0.1f : 0);
            }
            if (!moveIds.empty()) return moveIds[weightedPick(moveScores, 0.5f)];
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        if (phase == "transport-attack") {
            std::vector<int> tIds; for (auto& a : actions) if (a.type == ActionType::Transport) tIds.push_back(a.id);
            if (!tIds.empty() && (float)std::rand()/RAND_MAX < 0.7f) return tIds[std::rand() % tIds.size()];
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        return actions[0].id;
    }
};

struct BritishBrain {
    Weights w;

    int selectAction(const GameState& st, const std::vector<GameAction>& actions, const std::string& phase) {
        if (phase == "british-search") {
            std::vector<int> airIds; for (auto& a : actions) if (a.type == ActionType::AirSearch) airIds.push_back(a.id);
            if (!airIds.empty() && (float)std::rand()/RAND_MAX < 0.6f) return airIds[std::rand() % airIds.size()];
            for (auto& a : actions) if (a.type == ActionType::FinishPhase) return a.id;
            return actions[0].id;
        }
        if (phase == "british-move") {
            Heatmap hm;
            hm.addSpawnZone();
            std::vector<int> moveIds; std::vector<float> moveScores;
            for (auto& a : actions) {
                if (a.type != ActionType::Move) continue;
                auto [r,c] = rcOf(a.targetLabel);
                moveIds.push_back(a.id);
                moveScores.push_back((r>=0) ? -hm.get(r,c) + ((float)std::rand()/RAND_MAX-0.5f)*0.2f : 0);
            }
            if (!moveIds.empty()) return moveIds[weightedPick(moveScores, 0.6f)];
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
