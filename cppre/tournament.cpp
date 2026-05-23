/** C++ 高速锦标赛引擎 — 多线程 + 向量化 */
#include "state_machine.hpp"
#include "env.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <ctime>
#include <numeric>
#include <thread>
#include <sys/stat.h>
using namespace std;

struct WeightSet { Weights w; };

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
    j<<"\"temperature\":"<<w.temperature<<"}";
    return j.str();
}

// ===== 超快游戏 (无堆分配) =====
static bool runOneGame(const Weights& gerW, const Weights& britW) {
    GermanBrain ger(gerW); BritishBrain brit(britW);
    BismarckEnv env;
    int steps = 0, stuck = 0; Phase lastPhase = Phase::game_over;

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

        if (obs.phase == Phase::setup_british) {
            const char* dh[] = {"E5","E3","D5","C7","B6","F6","F5","F3","F2","E1","D1","C1"};
            const char* hs[] = {"E7","E6","E5","E3","E2","E1","D7","D5","D1","C7","C1","B6","F6","F5","F3","F2"};
            for (auto& sh : env.game.state.britishShips)
                if (sh.def.isDummy && !env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, dh[rand()%12]);
            for (auto& sh : env.game.state.britishShips)
                if (!env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, hs[rand()%16]);
            env.game.finishSetup(); steps++; continue;
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
    return env.game.state.winner && *env.game.state.winner == ShipSide::german;
}

// ===== 无锁线程工作 (静态分配) =====
struct JobResult { int gi, bi, gerWins, britWins; };

void runJobRange(int start, int end, const vector<pair<int,int>>& pairs,
                 const vector<WeightSet>& gerP, const vector<WeightSet>& britP,
                 int GPP, vector<JobResult>& results) {
    for (int idx = start; idx < end; idx++) {
        auto [gi, bi] = pairs[idx];
        int gerW = 0, britW = 0;
        for (int g = 0; g < GPP; g++) {
            bool swap = g >= GPP / 2;
            bool win = swap ? runOneGame(britP[bi].w, gerP[gi].w) : runOneGame(gerP[gi].w, britP[bi].w);
            if (!swap) { if (win) gerW++; else britW++; }
            else { if (win) britW++; else gerW++; }
        }
        results.push_back({gi, bi, gerW, britW});
    }
}

// ===== 变异 =====
void mutateAll(Weights& w, float scale) {
    float* ptr = &w.w1; int count = sizeof(Weights) / sizeof(float);
    for (int i = 0; i < count; i++) {
        if ((float)rand()/RAND_MAX < 0.3f) {
            float& val = *(ptr + i);
            val = max(0.1f, val + ((float)rand()/RAND_MAX - 0.5f) * scale);
        }
    }
}

int main(int argc, char** argv) {
    srand(time(nullptr));
    int GEN = argc > 1 ? stoi(argv[1]) : 20;
    int POP = argc > 2 ? stoi(argv[2]) : 10;
    int GPP = argc > 3 ? stoi(argv[3]) : 100;
    int THREADS = argc > 4 ? stoi(argv[4]) : thread::hardware_concurrency();
    string outDir = argc > 5 ? argv[5] : "/Users/Zhuanz1/Desktop/code/wargame/tournament";

    mkdir(outDir.c_str(), 0755);
    cout << "C++ 锦标赛: " << GEN << "代 × " << POP << "×" << POP << " × " << GPP << "局 | " << THREADS << "线程\n";
    long totalPerGen = (long)POP * POP * GPP;
    cout << "总局数/代: " << totalPerGen / 1000 << "K\n\n";

    vector<WeightSet> gerPop(POP), britPop(POP);
    vector<int> gerWins(POP), gerTotal(POP), britWins(POP), britTotal(POP);

    // 初始化
    for (int i = 0; i < POP; i++) {
        gerPop[i].w = Weights{}; britPop[i].w = Weights{};
        if (i > 0) { mutateAll(gerPop[i].w, 4.0f); mutateAll(britPop[i].w, 4.0f); }
    }

    for (int gen = 0; gen < GEN; gen++) {
        time_t startTime = time(nullptr);
        fill(gerWins.begin(), gerWins.end(), 0); fill(gerTotal.begin(), gerTotal.end(), 0);
        fill(britWins.begin(), britWins.end(), 0); fill(britTotal.begin(), britTotal.end(), 0);

        // 构建配对列表
        vector<pair<int,int>> pairs;
        for (int gi = 0; gi < POP; gi++)
            for (int bi = 0; bi < POP; bi++)
                pairs.emplace_back(gi, bi);

        // 启动线程 (静态分配，无锁)
        vector<thread> threads;
        vector<vector<JobResult>> threadResults(THREADS);
        int chunk = (pairs.size() + THREADS - 1) / THREADS;
        for (int t = 0; t < THREADS; t++) {
            int s = t * chunk, e = min(s + chunk, (int)pairs.size());
            if (s < e) threads.emplace_back([&, t, s, e]() {
                runJobRange(s, e, pairs, gerPop, britPop, GPP, threadResults[t]);
            });
        }
        for (auto& th : threads) th.join();

        // 汇总结果
        for (auto& tr : threadResults) {
            for (auto& r : tr) {
                gerWins[r.gi] += r.gerWins; gerTotal[r.gi] += GPP;
                britWins[r.bi] += r.britWins; britTotal[r.bi] += GPP;
            }
        }

        float avgGer = 0, avgBrit = 0;
        for (int i = 0; i < POP; i++) avgGer += gerTotal[i] > 0 ? (float)gerWins[i] / gerTotal[i] : 0;
        for (int i = 0; i < POP; i++) avgBrit += britTotal[i] > 0 ? (float)britWins[i] / britTotal[i] : 0;
        avgGer /= POP; avgBrit /= POP;
        cout << "\r  代 " << (gen+1) << "/" << GEN
             << " 德军:" << (int)(avgGer*100) << "% 英军:" << (int)(avgBrit*100)
             << "% " << (time(nullptr)-startTime) << "s\n";

        // 保存 checkpoint
        string ckFile = outDir + "/checkpoint_cpp.json";
        ofstream(ckFile) << "{\"generation\":"<<(gen+1)<<",\"avgGer\":"<<avgGer<<",\"avgBrit\":"<<avgBrit<<"}";

        // 繁殖: 用 wins/total 排序
        vector<int> idx(POP); iota(idx.begin(), idx.end(), 0);
        sort(idx.begin(), idx.end(), [&](int a, int b) {
            float fa = gerTotal[a] > 0 ? (float)gerWins[a] / gerTotal[a] : 0;
            float fb = gerTotal[b] > 0 ? (float)gerWins[b] / gerTotal[b] : 0;
            return fa > fb;
        });
        vector<Weights> newGer(POP), newBrit(POP);
        for (int i = 0; i < min(3, POP); i++) { newGer[i] = gerPop[idx[i]].w; newBrit[i] = britPop[idx[i]].w; }

        float anneal = max(0.1f, 1.0f - gen * 0.01f);
        for (int i = 3; i < POP; i++) {
            int p = rand() % 3;
            newGer[i] = newGer[p]; mutateAll(newGer[i], 2.0f * anneal);
            newBrit[i] = newBrit[p]; mutateAll(newBrit[i], 2.0f * anneal);
        }
        for (int i = 0; i < POP; i++) { gerPop[i].w = newGer[i]; britPop[i].w = newBrit[i]; }
    }
    cout << "\n✅ 完成!\n";
}
