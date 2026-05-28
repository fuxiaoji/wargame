/** C++ V3 锦标赛引擎 — 多线程 + 分级张量记录 */
#include "state_machine.hpp"
#include "env.hpp"
#include "tensor_logger.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <ctime>
#include <numeric>
#include <thread>
#include <atomic>
#include <deque>
#include <sys/stat.h>
using namespace std;

struct WeightSet { Weights w; };

// ===== 扩展游戏结果 =====
struct GameResult {
    int gi, bi, gerWins, britWins;
    int rush=0, farm=0, hunt=0, hide=0;
    int vpGer=0, vpBrit=0, turns=0, totalSteps=0;
    bool isClose=false;
    string dominantStrategy;
};

struct PairResults {
    int gi, bi, gerWins=0, britWins=0;
    vector<GameResult> games;
};

// ===== JSON 工具 =====
template<typename T> T getN(const string& j, const string& k, T d) {
    auto p = j.find("\"" + k + "\""); if (p == string::npos) return d;
    p = j.find(":", p); if (p == string::npos) return d;
    p = j.find_first_not_of(": \t\n", p); if (p == string::npos) return d;
    string v = j.substr(p, j.find_first_of(",}\n", p) - p);
    if constexpr (is_same<T, float>::value) return stof(v);
    if constexpr (is_same<T, int>::value) return stoi(v);
    return d;
}
float getWeight(const string& j, const string& k, float d) { return getN<float>(j,k,d); }

string weightsToJson(const Weights& w) {
    ostringstream j;
    j<<"{\"w1\":"<<w.w1<<",\"w2\":"<<w.w2<<",\"w3\":"<<w.w3<<",\"w4\":"<<w.w4<<",";
    j<<"\"w5\":"<<w.w5<<",\"w6\":"<<w.w6<<",\"w7\":"<<w.w7<<",\"w8\":"<<w.w8<<",";
    j<<"\"w9\":"<<w.w9<<",\"w10\":"<<w.w10<<",\"w11\":"<<w.w11<<",";
    j<<"\"w12\":"<<w.w12<<",\"w13\":"<<w.w13<<",\"w14\":"<<w.w14<<",\"w15\":"<<w.w15<<",";
    j<<"\"s1\":"<<w.s1<<",\"s2\":"<<w.s2<<",\"s3\":"<<w.s3<<",";
    j<<"\"h1\":"<<w.h1<<",\"h2\":"<<w.h2<<",\"h3\":"<<w.h3<<",";
    j<<"\"d1\":"<<w.d1<<",\"d2\":"<<w.d2<<",\"d3\":"<<w.d3<<",";
    j<<"\"p1\":"<<w.p1<<",\"p2\":"<<w.p2<<",\"p3\":"<<w.p3<<",";
    j<<"\"rushF7Pull\":"<<w.rushF7Pull<<",\"rushPathPull\":"<<w.rushPathPull<<",";
    j<<"\"farmBasePull\":"<<w.farmBasePull<<",\"farmVPScale\":"<<w.farmVPScale<<",";
    j<<"\"huntPull\":"<<w.huntPull<<",\"hidePush\":"<<w.hidePush<<",\"rushVPPenalty\":"<<w.rushVPPenalty<<",\"rushVPReward\":"<<w.rushVPReward<<",";
    j<<"\"britDiffuseStr\":"<<w.britDiffuseStr<<",\"britPatrolPull\":"<<w.britPatrolPull<<",\"britDefendPull\":"<<w.britDefendPull<<",";
    j<<"\"britHuntCenter\":"<<w.britHuntCenter<<",\"britSearchRepel\":"<<w.britSearchRepel<<",";
    j<<"\"temperature\":"<<w.temperature<<"}";
    return j.str();
}

string padGen(int gen) { return gen < 10 ? "00" + to_string(gen) : (gen < 100 ? "0" + to_string(gen) : to_string(gen)); }

string gameResultJson(const GameResult& gr) {
    ostringstream j;
    j << "{\"gi\":"<<gr.gi<<",\"bi\":"<<gr.bi
      <<",\"gerWins\":"<<gr.gerWins<<",\"britWins\":"<<gr.britWins
      <<",\"rush\":"<<gr.rush<<",\"farm\":"<<gr.farm<<",\"hunt\":"<<gr.hunt<<",\"hide\":"<<gr.hide
      <<",\"vpGer\":"<<gr.vpGer<<",\"vpBrit\":"<<gr.vpBrit
      <<",\"turns\":"<<gr.turns<<",\"steps\":"<<gr.totalSteps
      <<",\"close\":"<<(gr.isClose?"true":"false")
      <<",\"strategy\":\""<<gr.dominantStrategy<<"\"}";
    return j.str();
}

// ===== 随机 AI (乱打) =====
inline int randomAction(const std::vector<GameAction>& actions) {
    return actions[rand() % actions.size()].id;
}

// ===== 单局游戏 (可选张量记录) =====
static GameResult runOneGame(const Weights& gerW, const Weights& britW,
                              int gi, int bi, int seed, bool recordTensor,
                              const string& tensorDir, const string& gameId) {
    srand(seed);
    GermanBrain ger; ger.w = gerW; BritishBrain brit; brit.w = britW;
    BismarckEnv env;
    int steps = 0, stuck = 0; Phase lastPhase = Phase::game_over;
    int rush=0, farm=0, hunt=0, hide=0;

    vector<float> stateBuf; vector<ActionRecord> actions;
    if (recordTensor) stateBuf.resize(T * C * H * W);

    while (!env.game.state.gameOver && steps < 500) {
        auto obs = env.getFastObservation();
        if (obs.phase != Phase::setup_british && obs.actions.empty()) break;

        if (obs.phase == lastPhase) stuck++;
        else { stuck = 0; lastPhase = obs.phase; }
        if (stuck > 20) {
            for (auto& a : obs.actions)
                if (a.type == ActionType::FinishPhase) { env.step(a); stuck=0; break; }
            continue;
        }

        if (recordTensor && steps < T) {
            TensorLoggerState tracker;
            ShipSide viewer = (obs.activePlayer == ShipSide::german || obs.phase == Phase::setup_german)
                ? ShipSide::german : ShipSide::british;
            fillStateSlice(&stateBuf[steps * C * H * W], env.game.state, viewer, &tracker);
            ActionRecord rec{};
            rec.step_index = (uint8_t)steps;
            rec.side = (uint8_t)obs.activePlayer;
            actions.push_back(rec);
        }

        if (obs.phase == Phase::setup_british) {
            unordered_set<string> usedHexes(GERMAN_START_HEXES.begin(), GERMAN_START_HEXES.end());
            for (const auto& [hex, shipIds] : BRITISH_FIXED_POSITIONS) {
                usedHexes.insert(hex);
                for (const auto& id : shipIds) env.game.placeBritishToken(id, hex);
            }
            // 使用引擎自带 reachable 计算，替代手写 BFS
            unordered_set<string> reachable;
            ShipState dummyShip;
            dummyShip.def.speed = 2; dummyShip.steps = 2;
            for (const auto& label : GERMAN_START_HEXES) {
                auto h = labelToHex(label); if (!h) continue;
                for (const auto& l : getGermanReachableLabels(*h, dummyShip)) {
                    if (!usedHexes.count(l)) reachable.insert(l);
                }
            }
            auto placeFree = [&](bool isDummy) {
                for (auto& sh : env.game.state.britishShips) {
                    if (sh.def.isDummy != isDummy || env.game.state.britishPositions.count(sh.def.id)) continue;
                    vector<string> avail;
                    for (const auto& h : reachable) if (!usedHexes.count(h)) avail.push_back(h);
                    if (!avail.empty()) {
                        const auto& picked = avail[rand() % avail.size()];
                        env.game.placeBritishToken(sh.def.id, picked);
                        usedHexes.insert(picked);
                    }
                }
            };
            placeFree(false); placeFree(true);
            const char* fallback[] = {"E7","E5","E3","E2","E1","D8","D5","D4","D3","D2","D1","C7","C1","B6","F6","F5","F3","F2","A3","A4","B4"};
            for (auto& sh : env.game.state.britishShips)
                if (!env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, fallback[rand()%21]);
            env.game.finishSetup(); steps++; continue;
        }

        if (obs.activePlayer == ShipSide::german && obs.phase == Phase::german_move) {
            string& s = ger.lastStrategy;
            if (s == "rush") rush++; else if (s == "farm") farm++;
            else if (s == "hunt") hunt++; else if (s == "hide") hide++;
        }

        string phStr = phName(obs.phase);
        int actionId = (obs.activePlayer == ShipSide::german)
            ? ger.selectAction(env.game.state, obs.actions, phStr)
            : brit.selectAction(env.game.state, obs.actions, phStr);

        if (actionId >= 0) {
            for (auto& a : obs.actions) if (a.id == actionId) { env.step(a); break; }
        } else if (!obs.actions.empty()) env.step(obs.actions[0]);
        steps++;
    }

    bool gerWin = env.game.state.winner && *env.game.state.winner == ShipSide::german;
    GameResult gr;
    gr.gi = gi; gr.bi = bi;
    gr.gerWins = gerWin ? 1 : 0; gr.britWins = gerWin ? 0 : 1;
    gr.rush = rush; gr.farm = farm; gr.hunt = hunt; gr.hide = hide;
    gr.vpGer = env.game.state.vp.german; gr.vpBrit = env.game.state.vp.british;
    gr.turns = env.game.state.turn; gr.totalSteps = steps;
    gr.isClose = (abs(gr.vpGer - gr.vpBrit) <= 1) || (gr.turns >= 17);
    for (auto& sh : env.game.state.germanShips)
        if (sh.def.id=="bismarck" && sh.steps<=0) gr.isClose = true;

    int maxStrat = max({rush, farm, hunt, hide});
    if (maxStrat == rush) gr.dominantStrategy = "rush";
    else if (maxStrat == farm) gr.dominantStrategy = "farm";
    else if (maxStrat == hunt) gr.dominantStrategy = "hunt";
    else gr.dominantStrategy = "hide";

    if (recordTensor && !tensorDir.empty()) {
        GameLogResult res;
        res.winner = gerWin ? "german" : "british";
        res.vp_german = gr.vpGer; res.vp_british = gr.vpBrit;
        res.turns = gr.turns; res.total_steps = steps; res.seed = seed;
        writeGameLog(tensorDir, gameId, stateBuf, actions, res);
    }
    return gr;
}

// 德军权重 vs 英军乱打
static GameResult runOneGameRandomBrit(const Weights& gerW, int gi, int seed) {
    srand(seed);
    GermanBrain ger; ger.w = gerW;
    BismarckEnv env;
    int steps = 0, stuck = 0; Phase lastPhase = Phase::game_over;
    int rush=0, farm=0, hunt=0, hide=0;
    while (!env.game.state.gameOver && steps < 500) {
        auto obs = env.getFastObservation();
        if (obs.phase != Phase::setup_british && obs.actions.empty()) break;
        if (obs.phase == lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase; }
        if (stuck > 20) { for (auto& a : obs.actions) if (a.type == ActionType::FinishPhase) { env.step(a); stuck=0; break; } continue; }
        if (obs.phase == Phase::setup_british) {
            // 随机英军初设
            unordered_set<string> usedHexes(GERMAN_START_HEXES.begin(), GERMAN_START_HEXES.end());
            for (const auto& [hex, shipIds] : BRITISH_FIXED_POSITIONS) {
                usedHexes.insert(hex);
                for (const auto& id : shipIds) env.game.placeBritishToken(id, hex);
            }
            unordered_set<string> reachable;
            ShipState dummyShip; dummyShip.def.speed = 2; dummyShip.steps = 2;
            for (const auto& label : GERMAN_START_HEXES) {
                auto h = labelToHex(label); if (!h) continue;
                for (const auto& l : getGermanReachableLabels(*h, dummyShip))
                    if (!usedHexes.count(l)) reachable.insert(l);
            }
            auto placeFree = [&](bool isDummy) {
                for (auto& sh : env.game.state.britishShips) {
                    if (sh.def.isDummy != isDummy || env.game.state.britishPositions.count(sh.def.id)) continue;
                    vector<string> avail;
                    for (const auto& h : reachable) if (!usedHexes.count(h)) avail.push_back(h);
                    if (!avail.empty()) { const auto& p = avail[rand()%avail.size()]; env.game.placeBritishToken(sh.def.id, p); usedHexes.insert(p); }
                }
            };
            placeFree(false); placeFree(true);
            const char* fallback[] = {"E7","E5","E3","E2","E1","D8","D5","D4","D3","D2","D1","C7","C1","B6","F6","F5","F3","F2","A3","A4","B4"};
            for (auto& sh : env.game.state.britishShips)
                if (!env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, fallback[rand()%21]);
            env.game.finishSetup(); steps++; continue;
        }
        if (obs.activePlayer == ShipSide::german && obs.phase == Phase::german_move) {
            string& s = ger.lastStrategy;
            if (s == "rush") rush++; else if (s == "farm") farm++;
            else if (s == "hunt") hunt++; else if (s == "hide") hide++;
        }
        string phStr = phName(obs.phase);
        int actionId = (obs.activePlayer == ShipSide::german)
            ? ger.selectAction(env.game.state, obs.actions, phStr)
            : randomAction(obs.actions);  // 英军乱打
        if (actionId >= 0) { for (auto& a : obs.actions) if (a.id == actionId) { env.step(a); break; } }
        else if (!obs.actions.empty()) env.step(obs.actions[0]);
        steps++;
    }
    bool gerWin = env.game.state.winner && *env.game.state.winner == ShipSide::german;
    GameResult gr; gr.gi = gi; gr.bi = -1;
    gr.gerWins = gerWin?1:0; gr.britWins = gerWin?0:1;
    gr.rush=rush; gr.farm=farm; gr.hunt=hunt; gr.hide=hide;
    gr.vpGer=env.game.state.vp.german; gr.vpBrit=env.game.state.vp.british;
    gr.turns=env.game.state.turn; gr.totalSteps=steps;
    int maxStrat=max({rush,farm,hunt,hide});
    gr.dominantStrategy = (maxStrat==rush)?"rush":(maxStrat==farm)?"farm":(maxStrat==hunt)?"hunt":"hide";
    return gr;
}

// 德军乱打 vs 英军权重
static GameResult runOneGameRandomGer(const Weights& britW, int bi, int seed) {
    srand(seed);
    BritishBrain brit; brit.w = britW;
    BismarckEnv env;
    int steps = 0, stuck = 0; Phase lastPhase = Phase::game_over;
    while (!env.game.state.gameOver && steps < 500) {
        auto obs = env.getFastObservation();
        if (obs.phase != Phase::setup_british && obs.actions.empty()) break;
        if (obs.phase == lastPhase) stuck++; else { stuck = 0; lastPhase = obs.phase; }
        if (stuck > 20) { for (auto& a : obs.actions) if (a.type == ActionType::FinishPhase) { env.step(a); stuck=0; break; } continue; }
        if (obs.phase == Phase::setup_british) {
            unordered_set<string> usedHexes(GERMAN_START_HEXES.begin(), GERMAN_START_HEXES.end());
            for (const auto& [hex, shipIds] : BRITISH_FIXED_POSITIONS) {
                usedHexes.insert(hex);
                for (const auto& id : shipIds) env.game.placeBritishToken(id, hex);
            }
            unordered_set<string> reachable;
            ShipState dummyShip; dummyShip.def.speed = 2; dummyShip.steps = 2;
            for (const auto& label : GERMAN_START_HEXES) {
                auto h = labelToHex(label); if (!h) continue;
                for (const auto& l : getGermanReachableLabels(*h, dummyShip))
                    if (!usedHexes.count(l)) reachable.insert(l);
            }
            auto placeFree = [&](bool isDummy) {
                for (auto& sh : env.game.state.britishShips) {
                    if (sh.def.isDummy != isDummy || env.game.state.britishPositions.count(sh.def.id)) continue;
                    vector<string> avail;
                    for (const auto& h : reachable) if (!usedHexes.count(h)) avail.push_back(h);
                    if (!avail.empty()) { const auto& p = avail[rand()%avail.size()]; env.game.placeBritishToken(sh.def.id, p); usedHexes.insert(p); }
                }
            };
            placeFree(false); placeFree(true);
            const char* fallback[] = {"E7","E5","E3","E2","E1","D8","D5","D4","D3","D2","D1","C7","C1","B6","F6","F5","F3","F2","A3","A4","B4"};
            for (auto& sh : env.game.state.britishShips)
                if (!env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, fallback[rand()%21]);
            env.game.finishSetup(); steps++; continue;
        }
        string phStr = phName(obs.phase);
        int actionId = (obs.activePlayer == ShipSide::german)
            ? randomAction(obs.actions)  // 德军乱打
            : brit.selectAction(env.game.state, obs.actions, phStr);
        if (actionId >= 0) { for (auto& a : obs.actions) if (a.id == actionId) { env.step(a); break; } }
        else if (!obs.actions.empty()) env.step(obs.actions[0]);
        steps++;
    }
    bool gerWin = env.game.state.winner && *env.game.state.winner == ShipSide::german;
    GameResult gr; gr.gi = -1; gr.bi = bi;
    gr.gerWins = gerWin?1:0; gr.britWins = gerWin?0:1;
    gr.vpGer=env.game.state.vp.german; gr.vpBrit=env.game.state.vp.british;
    gr.turns=env.game.state.turn; gr.totalSteps=steps;
    return gr;
}

// ===== 无锁线程工作 =====
void runJobRange(int start, int end, const vector<pair<int,int>>& pairs,
                 const vector<WeightSet>& gerP, const vector<WeightSet>& britP,
                 int GPP, int gen, const string& tensorDir,
                 vector<PairResults>& results, atomic<int>& done, int total) {
    for (int idx = start; idx < end; idx++) {
        auto [gi, bi] = pairs[idx];
        PairResults pr; pr.gi = gi; pr.bi = bi;
        int gerW = 0, britW = 0;
        bool gerRandom = (gi < 0), britRandom = (bi < 0);
        int gpp = gerRandom || britRandom ? max(1, GPP/2) : GPP;  // 乱打局提高信号质量
        for (int g = 0; g < gpp; g++) {
            int seed = (gen+1)*100000 + abs(gi)*1000 + abs(bi)*50 + g;
            GameResult gr;
            if (gerRandom) {
                // 德军乱打, 英军用权重
                gr = runOneGameRandomGer(britP[bi].w, bi, seed);
                gerW += gr.gerWins; britW += gr.britWins;
            } else if (britRandom) {
                // 英军乱打, 德军用权重
                gr = runOneGameRandomBrit(gerP[gi].w, gi, seed);
                gerW += gr.gerWins; britW += gr.britWins;
            } else {
                bool swap = g >= GPP / 2;
                seed += (swap?500000:0);
                gr = swap
                    ? runOneGame(britP[bi].w, gerP[gi].w, bi, gi, seed, false, "", "")
                    : runOneGame(gerP[gi].w, britP[bi].w, gi, bi, seed, false, "", "");
                if (!swap) { gerW += gr.gerWins; britW += gr.britWins; }
                else { gerW += gr.britWins; britW += gr.gerWins; }
            }
            pr.games.push_back(gr);
        }
        pr.gerWins = gerW; pr.britWins = britW;
        results.push_back(pr);
        int d = ++done;
        if (d % max(1, total/20) == 0)
            cout << "\r  " << (d*100/total) << "% " << d << "/" << total << flush;
    }
}

// ===== 变异 =====
void mutateAll(Weights& w, float scale) {
    float* ptr = &w.w1; int count = sizeof(Weights) / sizeof(float);
    for (int i = 0; i < count; i++) {
        if ((float)rand()/RAND_MAX < 0.5f) {  // 50% 变异率
            float& val = *(ptr + i);
            val = max(0.2f, val + ((float)rand()/RAND_MAX - 0.5f) * scale);  // 下限 0.2
        }
    }
}

int main(int argc, char** argv) {
    srand(time(nullptr));
    int GEN = argc > 1 ? stoi(argv[1]) : 20;
    int POP = argc > 2 ? stoi(argv[2]) : 10;
    int GPP = argc > 3 ? stoi(argv[3]) : 100;
    int THREADS = argc > 4 ? stoi(argv[4]) : thread::hardware_concurrency();
    string outDir = argc > 5 ? argv[5] : "/Users/Zhuanz1/Desktop/code/wargame/deeplearn/data/training_v3";

    mkdir(outDir.c_str(), 0755);
    cout << "V10 锦标赛: " << GEN << "代 × " << POP << "×" << POP << " × " << GPP << "局 | " << THREADS << "线程 | 德军精英按乱打基线\n";
    long totalPerGen = (long)POP * POP * GPP;
    cout << "总局数/代: " << totalPerGen/1000 << "K | 总计: " << (totalPerGen*GEN)/10000 << "万局\n\n";

    ofstream cfg(outDir + "/run_config.json");
    cfg << "{\"gen\":"<<GEN<<",\"pop\":"<<POP<<",\"gpp\":"<<GPP
        <<",\"threads\":"<<THREADS<<",\"timestamp\":"<<time(nullptr)<<"}";

    vector<WeightSet> gerPop(POP), britPop(POP);
    vector<int> gerWins(POP), gerTotal(POP), britWins(POP), britTotal(POP);
    vector<vector<int>> gerStrats(POP, vector<int>(4, 0));
    vector<float> gerWinHist, britWinHist, diversityHist;
    vector<float> gerVsRandomHist, britVsRandomHist;  // 乱打基线
    vector<string> strategyHist;

    // Gen0: 前几个保留默认权重作为锚, 其余变异
    for (int i = 0; i < POP; i++) {
        gerPop[i].w = Weights{}; britPop[i].w = Weights{};
        if (i >= 3) { mutateAll(gerPop[i].w, 3.0f); mutateAll(britPop[i].w, 3.0f); }
    }

    for (int gen = 0; gen < GEN; gen++) {
        time_t startTime = time(nullptr);
        fill(gerWins.begin(), gerWins.end(), 0); fill(gerTotal.begin(), gerTotal.end(), 0);
        fill(britWins.begin(), britWins.end(), 0); fill(britTotal.begin(), britTotal.end(), 0);
        for (auto& s : gerStrats) fill(s.begin(), s.end(), 0);

        string genDir = outDir + "/gen_" + padGen(gen);
        mkdir(genDir.c_str(), 0755);
        string resDir = genDir + "/results"; mkdir(resDir.c_str(), 0755);

        vector<pair<int,int>> pairs;
        for (int gi = 0; gi < POP; gi++)
            for (int bi = 0; bi < POP; bi++)
                pairs.emplace_back(gi, bi);
        // 乱打基线: 每代每个个体 vs 乱打对手 (gi=-1 德军乱打, bi=-1 英军乱打)
        for (int gi = 0; gi < POP; gi++) pairs.emplace_back(gi, -1);  // 德军个体 vs 乱打英军
        for (int bi = 0; bi < POP; bi++) pairs.emplace_back(-1, bi);  // 乱打德军 vs 英军个体

        vector<thread> threads;
        vector<vector<PairResults>> threadResults(THREADS);
        atomic<int> completedPairs{0};
        int totalPairs = pairs.size();
        int chunk = (totalPairs + THREADS - 1) / THREADS;
        for (int t = 0; t < THREADS; t++) {
            int s = t * chunk, e = min(s + chunk, totalPairs);
            if (s < e) threads.emplace_back([&, t, s, e]() {
                runJobRange(s, e, pairs, gerPop, britPop, GPP, gen, outDir, threadResults[t], completedPairs, totalPairs);
            });
        }
        for (auto& th : threads) th.join();
        cout << "\r  " << flush;

        // 汇总 + Tier 0 写 per-pair results
        int totalClose=0, totalGames=0;
        float sumVpGer=0, sumVpBrit=0, sumTurns=0;
        for (auto& tr : threadResults) {
            for (auto& pr : tr) {
                string pf = resDir + "/pair_g" + to_string(pr.gi) + "_b" + to_string(pr.bi) + ".json";
                ofstream pfs(pf);
                pfs << "[";
                for (size_t gi=0; gi<pr.games.size(); gi++) {
                    if (gi) pfs << ",";
                    pfs << gameResultJson(pr.games[gi]);
                }
                pfs << "]";

                if (pr.gi >= 0) {
                    gerWins[pr.gi]+=pr.gerWins; gerTotal[pr.gi]+=max(1, (int)pr.games.size());
                    for (auto& gr : pr.games) {
                        gerStrats[pr.gi][0]+=gr.rush; gerStrats[pr.gi][1]+=gr.farm;
                        gerStrats[pr.gi][2]+=gr.hunt; gerStrats[pr.gi][3]+=gr.hide;
                    }
                }
                if (pr.bi >= 0) {
                    britWins[pr.bi]+=pr.britWins; britTotal[pr.bi]+=max(1, (int)pr.games.size());
                }
                for (auto& gr : pr.games) {
                    if (gr.isClose) totalClose++;
                    sumVpGer+=gr.vpGer; sumVpBrit+=gr.vpBrit;
                    sumTurns+=gr.turns; totalGames++;
                }
            }
        }

        float avgGer=0, avgBrit=0;
        for (int i=0;i<POP;i++) avgGer+=gerTotal[i]>0?(float)gerWins[i]/gerTotal[i]:0;
        for (int i=0;i<POP;i++) avgBrit+=britTotal[i]>0?(float)britWins[i]/britTotal[i]:0;
        avgGer/=POP; avgBrit/=POP;
        int elapsed=time(nullptr)-startTime;

        int bestGer=0, bestBrit=0;
        float bestGerWR=0, bestBritWR=0;
        for (int i=0;i<POP;i++) {
            float gr=gerTotal[i]>0?(float)gerWins[i]/gerTotal[i]:0;
            float br=britTotal[i]>0?(float)britWins[i]/britTotal[i]:0;
            if (gr>bestGerWR){bestGerWR=gr;bestGer=i;}
            if (br>bestBritWR){bestBritWR=br;bestBrit=i;}
        }

        int totalR=0,totalF=0,totalH=0,totalD=0;
        for (int i=0;i<POP;i++){totalR+=gerStrats[i][0];totalF+=gerStrats[i][1];totalH+=gerStrats[i][2];totalD+=gerStrats[i][3];}
        float ttl=totalR+totalF+totalH+totalD+1;
        float rushPct=(float)totalR/ttl,farmPct=(float)totalF/ttl,huntPct=(float)totalH/ttl,hidePct=(float)totalD/ttl;

        // 乱打基线胜率 (每德军个体独立统计)
        vector<float> gerRandomWR(POP, 0);
        vector<int> gerRandomGames(POP, 0);
        float avgBritVsRandom=0; int britVsRandomGames=0;
        for (auto& tr : threadResults) for (auto& pr : tr) {
            if (pr.bi < 0 && pr.gi >= 0) {  // 德军个体 vs 乱打英军
                float wr = pr.games.empty() ? 0 : (float)pr.gerWins / pr.games.size();
                gerRandomWR[pr.gi] += wr;
                gerRandomGames[pr.gi]++;
            }
            if (pr.gi < 0 && pr.bi >= 0) {  // 乱打德军 vs 英军个体
                avgBritVsRandom += (float)pr.britWins / max(1, (int)pr.games.size());
                britVsRandomGames++;
            }
        }
        float avgGerVsRandom = 0;
        for (int i=0;i<POP;i++) if (gerRandomGames[i]>0) { gerRandomWR[i] /= gerRandomGames[i]; avgGerVsRandom += gerRandomWR[i]; }
        avgGerVsRandom /= POP;
        if (britVsRandomGames > 0) avgBritVsRandom /= britVsRandomGames;
        gerVsRandomHist.push_back(avgGerVsRandom);
        britVsRandomHist.push_back(avgBritVsRandom);

        cout << "\r  代"<<(gen+1)<<"/"<<GEN<<" 德:"<<(int)(avgGer*100)<<"% 英:"<<(int)(avgBrit*100)
             <<"% 焦灼:"<<(totalGames>0?totalClose*100/totalGames:0)<<"%"
             <<" 乱打:德"<<(int)(avgGerVsRandom*100)<<"%/英"<<(int)(avgBritVsRandom*100)<<"%"
             <<" "<<elapsed<<"s\n";

        // KL diversity
        float klMean=0; int klPairs=0;
        for (int i=0;i<POP;i++) for (int j=i+1;j<POP;j++) {
            float k=0; const float *pa=&gerPop[i].w.w1,*pb=&gerPop[j].w.w1;
            for (int x=0;x<(int)(sizeof(Weights)/sizeof(float));x++)
                if(pa[x]>0.001f&&pb[x]>0.001f) k+=abs(pa[x]*log(pa[x]/pb[x]));
            klMean+=k; klPairs++;
        }
        klMean=klPairs>0?klMean/klPairs:0;

        // Tier 1: 精英对战 (top德 vs top英, 全部50局张量)
        string eliteDir=genDir+"/elite"; mkdir(eliteDir.c_str(),0755);
        for (int g=0;g<GPP;g++) {
            int seed=(gen+1)*900000+g;
            runOneGame(gerPop[bestGer].w,britPop[bestBrit].w,bestGer,bestBrit,seed,true,eliteDir,"elite_"+to_string(g));
        }

        // Tier 3: 焦灼局重播 (80局/代)
        string closeDir=genDir+"/close"; mkdir(closeDir.c_str(),0755);
        int closeSaved=0;
        for (auto& tr : threadResults) for (auto& pr : tr) for (auto& gr : pr.games) {
            if (closeSaved>=80||!gr.isClose) continue;
            int seed=(gen+1)*700000+closeSaved;
            runOneGame(gerPop[gr.gi].w,britPop[gr.bi].w,gr.gi,gr.bi,seed,true,closeDir,"close_"+to_string(closeSaved));
            closeSaved++;
        }

        // Tier 5: 随机抽样 (80局/代, 德胜英胜各半)
        string randDir=genDir+"/random"; mkdir(randDir.c_str(),0755);
        int randGer=0,randBrit=0;
        for (int k=0;k<400&&(randGer<40||randBrit<40);k++) {
            int gi=rand()%POP,bi=rand()%POP;
            int seed=(gen+1)*800000+k;
            bool gerW=runOneGame(gerPop[gi].w,britPop[bi].w,gi,bi,seed,false,"","").gerWins>0;
            if(gerW&&randGer>=40)continue; if(!gerW&&randBrit>=40)continue;
            string gid=(gerW?"ger":"brit")+to_string(gerW?randGer:randBrit);
            runOneGame(gerPop[gi].w,britPop[bi].w,gi,bi,seed+1,true,randDir,gid);
            if(gerW)randGer++; else randBrit++;
        }

        // 种群保存
        ofstream gerF(genDir+"/ger_population.json");
        gerF<<"["; for(int i=0;i<POP;i++){if(i)gerF<<",";gerF<<weightsToJson(gerPop[i].w);} gerF<<"]";
        ofstream britF(genDir+"/brit_population.json");
        britF<<"["; for(int i=0;i<POP;i++){if(i)britF<<",";britF<<weightsToJson(britPop[i].w);} britF<<"]";

        // 每代个体统计 (KL vs WR 散点图用)
        ofstream indF(genDir+"/individual_stats.json");
        indF<<"[";
        for (int i=0;i<POP;i++) {
            if (i) indF<<",";
            float wr=gerTotal[i]>0?(float)gerWins[i]/gerTotal[i]:0;
            auto kl=[&](int a,int b){
                float k=0;const float *pa=&gerPop[a].w.w1,*pb=&gerPop[b].w.w1;
                for(int x=0;x<(int)(sizeof(Weights)/sizeof(float));x++)
                    if(pa[x]>0.001f&&pb[x]>0.001f)k+=abs(pa[x]*log(pa[x]/pb[x]));
                return k;
            };
            float klSum=0;for(int j=0;j<POP;j++)if(i!=j)klSum+=kl(i,j);
            float t=gerStrats[i][0]+gerStrats[i][1]+gerStrats[i][2]+gerStrats[i][3]+1;
            indF<<"{\"idx\":"<<i<<",\"wr\":"<<wr<<",\"kl\":"<<klSum/(POP-1)
                <<",\"rush\":"<<gerStrats[i][0]<<",\"farm\":"<<gerStrats[i][1]
                <<",\"hunt\":"<<gerStrats[i][2]<<",\"hide\":"<<gerStrats[i][3]<<"}";
        }
        indF<<"]";

        // 每代 Top-3 权重 (权重轨迹图用)
        vector<int> gerRank(POP), britRank(POP);
        iota(gerRank.begin(),gerRank.end(),0); iota(britRank.begin(),britRank.end(),0);
        sort(gerRank.begin(),gerRank.end(),[&](int a,int b){
            return (gerTotal[a]>0?(float)gerWins[a]/gerTotal[a]:0) > (gerTotal[b]>0?(float)gerWins[b]/gerTotal[b]:0);
        });
        sort(britRank.begin(),britRank.end(),[&](int a,int b){
            return (britTotal[a]>0?(float)britWins[a]/britTotal[a]:0) > (britTotal[b]>0?(float)britWins[b]/britTotal[b]:0);
        });
        ofstream topF(genDir+"/top_weights.json");
        topF<<"{\"top_ger\":[";
        for (int i=0;i<min(3,POP);i++) {
            if(i)topF<<","; int idx=gerRank[i];
            topF<<"{\"idx\":"<<idx<<",\"wr\":"<<(gerTotal[idx]>0?(float)gerWins[idx]/gerTotal[idx]:0)
                <<",\"weights\":"<<weightsToJson(gerPop[idx].w)<<"}";
        }
        topF<<"],\"top_brit\":[";
        for (int i=0;i<min(3,POP);i++) {
            if(i)topF<<","; int idx=britRank[i];
            topF<<"{\"idx\":"<<idx<<",\"wr\":"<<(britTotal[idx]>0?(float)britWins[idx]/britTotal[idx]:0)
                <<",\"weights\":"<<weightsToJson(britPop[idx].w)<<"}";
        }
        topF<<"]}";

        // 扩展 stats.json (含 MAP-Elites 网格快照)
        // 先算 MAP-Elites 网格 (移到 stats 前面)
        const int G=5;
        float gerGridFitness[G][G]; Weights gerGridBest[G][G]; bool gerGridSet[G][G]={};
        float gerGridWR[G][G]={};
        auto cellIdx=[G](float rp,float fp){return make_pair(min(G-1,max(0,(int)(rp*G))),min(G-1,max(0,(int)(fp*G))));};
        for (int i=0;i<POP;i++) {
            float t=gerStrats[i][0]+gerStrats[i][1]+gerStrats[i][2]+gerStrats[i][3]+1;
            auto [r,f]=cellIdx((float)gerStrats[i][0]/t,(float)gerStrats[i][1]/t);
            float wr=gerTotal[i]>0?(float)gerWins[i]/gerTotal[i]:0;
            auto kl=[&](int a,int b){
                float k=0;const float *pa=&gerPop[a].w.w1,*pb=&gerPop[b].w.w1;
                for(int x=0;x<(int)(sizeof(Weights)/sizeof(float));x++)
                    if(pa[x]>0.001f&&pb[x]>0.001f)k+=abs(pa[x]*log(pa[x]/pb[x]));
                return k;
            };
            float klSum=0;for(int j=0;j<POP;j++)if(i!=j)klSum+=kl(i,j);
            float fit=wr-0.1f*klSum/(POP-1);
            if(!gerGridSet[r][f]||fit>gerGridFitness[r][f]){
                gerGridFitness[r][f]=fit;gerGridBest[r][f]=gerPop[i].w;gerGridSet[r][f]=true;gerGridWR[r][f]=wr;
            }
        }
        // 写 stats.json
        ofstream statF(genDir+"/stats.json");
        statF<<"{\"avgGer\":"<<avgGer<<",\"avgBrit\":"<<avgBrit<<",\"gen\":"<<(gen+1)
             <<",\"diversity_kl\":"<<klMean
             <<",\"strategy_dist\":{\"rush\":"<<rushPct<<",\"farm\":"<<farmPct<<",\"hunt\":"<<huntPct<<",\"hide\":"<<hidePct<<"}"
             <<",\"best_ger_wr\":"<<bestGerWR<<",\"best_brit_wr\":"<<bestBritWR
             <<",\"best_ger\":"<<bestGer<<",\"best_brit\":"<<bestBrit
             <<",\"avg_vp_ger\":"<<(totalGames>0?sumVpGer/totalGames:0)
             <<",\"avg_vp_brit\":"<<(totalGames>0?sumVpBrit/totalGames:0)
             <<",\"avg_turns\":"<<(totalGames>0?sumTurns/totalGames:0)
             <<",\"close_pct\":"<<(totalGames>0?(float)totalClose/totalGames:0)
             <<",\"grid_cells\":[";
        bool firstCell=true;
        for(int r=0;r<G;r++)for(int c=0;c<G;c++){
            if(!firstCell)statF<<",";firstCell=false;
            statF<<"{\"r\":"<<r<<",\"c\":"<<c<<",\"occ\":"<<(gerGridSet[r][c]?"true":"false");
            if(gerGridSet[r][c])statF<<",\"wr\":"<<gerGridWR[r][c]<<",\"fit\":"<<gerGridFitness[r][c];
            statF<<"}";
        }
        statF<<"]"
             <<",\"elapsed_s\":"<<elapsed<<"}";

        ofstream ck(outDir+"/checkpoint_cpp.json");
        ck<<"{\"generation\":"<<(gen+1)<<",\"avgGer\":"<<avgGer<<",\"avgBrit\":"<<avgBrit
          <<",\"bestGer\":"<<bestGer<<",\"bestBrit\":"<<bestBrit<<"}";

        gerWinHist.push_back(avgGer); britWinHist.push_back(avgBrit); diversityHist.push_back(klMean);
        ostringstream sh; sh<<"{\"rush\":"<<rushPct<<",\"farm\":"<<farmPct<<",\"hunt\":"<<huntPct<<",\"hide\":"<<hidePct<<"}";
        strategyHist.push_back(sh.str());

        // 德军: 精英保留(按乱打基线排名top-5) + MAP-Elites网格繁殖 + 默认权重锚定
        vector<int> gerIdx(POP);iota(gerIdx.begin(),gerIdx.end(),0);
        sort(gerIdx.begin(),gerIdx.end(),[&](int a,int b){
            return gerRandomWR[a] > gerRandomWR[b];  // 按乱打基线排名
        });
        vector<Weights> newGer(POP);
        // Top-5 精英保留 (不变异)
        int eliteCount = min(5, POP);
        for(int i=0;i<eliteCount;i++) newGer[i]=gerPop[gerIdx[i]].w;
        // 默认权重锚定 (防退化)
        newGer[eliteCount] = Weights{};
        // MAP-Elites 网格填充剩余
        int fillIdx = eliteCount + 1;
        float anneal=max(0.1f,1.0f-gen*0.01f);
        for(int r=0;r<G;r++)for(int c=0;c<G;c++){
            if(!gerGridSet[r][c])continue;
            // 跳过已在精英中的个体
            bool isElite=false;
            for(int i=0;i<eliteCount;i++) if(&gerPop[gerIdx[i]].w == &gerGridBest[r][c]) isElite=true;
            if(isElite) continue;
            if(fillIdx < POP) newGer[fillIdx++] = gerGridBest[r][c];
        }
        // 空网格格: 取最近网格格的变体
        for(int r=0;r<G;r++)for(int c=0;c<G;c++){
            if(gerGridSet[r][c] || fillIdx >= POP) continue;
            Weights* nearest=nullptr;int bestDist=999;
            for(int nr=0;nr<G;nr++)for(int nc=0;nc<G;nc++){
                if(!gerGridSet[nr][nc])continue;
                int d=abs(nr-r)+abs(nc-c);if(d<bestDist){bestDist=d;nearest=&gerGridBest[nr][nc];}
            }
            if(nearest){Weights mutant=*nearest;mutateAll(mutant,1.0f*anneal);newGer[fillIdx++]=mutant;}
        }
        // 剩余: 精英变体
        while(fillIdx < POP){newGer[fillIdx]=newGer[rand()%eliteCount];mutateAll(newGer[fillIdx],1.0f*anneal);fillIdx++;}
        for(int i=0;i<POP;i++)gerPop[i].w=newGer[i];

        vector<int> britIdx(POP);iota(britIdx.begin(),britIdx.end(),0);
        sort(britIdx.begin(),britIdx.end(),[&](int a,int b){
            float fa=britTotal[a]>0?(float)britWins[a]/britTotal[a]:0;
            float fb=britTotal[b]>0?(float)britWins[b]/britTotal[b]:0;return fa>fb;
        });
        vector<Weights> newBrit(POP);
        for(int i=0;i<min(3,POP);i++)newBrit[i]=britPop[britIdx[i]].w;
        for(int i=3;i<POP;i++){newBrit[i]=newBrit[rand()%3];mutateAll(newBrit[i],3.0f*anneal);}
        for(int i=0;i<POP;i++)britPop[i].w=newBrit[i];
    }

    ofstream summ(outDir+"/summary.json");
    summ<<"{\"gerWinHistory\":[";for(size_t i=0;i<gerWinHist.size();i++)summ<<(i?",":"")<<gerWinHist[i];
    summ<<"],\"britWinHistory\":[";for(size_t i=0;i<britWinHist.size();i++)summ<<(i?",":"")<<britWinHist[i];
    summ<<"],\"diversityHistory\":[";for(size_t i=0;i<diversityHist.size();i++)summ<<(i?",":"")<<diversityHist[i];
    summ<<"],\"strategyHistory\":[";for(size_t i=0;i<strategyHist.size();i++)summ<<(i?",":"")<<strategyHist[i];
    summ<<"],\"gerVsRandomHistory\":[";for(size_t i=0;i<gerVsRandomHist.size();i++)summ<<(i?",":"")<<gerVsRandomHist[i];
    summ<<"],\"britVsRandomHistory\":[";for(size_t i=0;i<britVsRandomHist.size();i++)summ<<(i?",":"")<<britVsRandomHist[i];
    summ<<"]}";
    cout<<"\n✅ V3完成! "<<outDir<<"/gen_*/\n";
}
