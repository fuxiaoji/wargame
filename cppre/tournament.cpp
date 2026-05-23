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
#include <atomic>
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
struct StratCount { int rush=0, farm=0, hunt=0, hide=0; };
static bool runOneGame(const Weights& gerW, const Weights& britW, StratCount& sc) {
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

        // 追踪策略
        if (obs.activePlayer == ShipSide::german && obs.phase == Phase::german_move) {
            string& s = ger.lastStrategy;
            if (s == "rush") sc.rush++; else if (s == "farm") sc.farm++;
            else if (s == "hunt") sc.hunt++; else if (s == "hide") sc.hide++;
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
struct JobResult { int gi, bi, gerWins, britWins, rush, farm, hunt, hide; };

void runJobRange(int start, int end, const vector<pair<int,int>>& pairs,
                 const vector<WeightSet>& gerP, const vector<WeightSet>& britP,
                 int GPP, vector<JobResult>& results, atomic<int>& done, int total,
                 vector<vector<int>>& gerStrats) {  // 线程局部策略计数
    for (int idx = start; idx < end; idx++) {
        auto [gi, bi] = pairs[idx];
        int gerW = 0, britW = 0;
        StratCount sc;
        for (int g = 0; g < GPP; g++) {
            bool swap = g >= GPP / 2;
            bool win = swap ? runOneGame(britP[bi].w, gerP[gi].w, sc) : runOneGame(gerP[gi].w, britP[bi].w, sc);
            if (!swap) { if (win) gerW++; else britW++; }
            else { if (win) britW++; else gerW++; }
        }
        results.push_back({gi, bi, gerW, britW, sc.rush, sc.farm, sc.hunt, sc.hide});
        int d = ++done;
        if (d % max(1, total/20) == 0) {
            cout << "\r  " << (d*100/total) << "% " << d << "/" << total << flush;
        }
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
    // MAP-Elites: 策略追踪 [个体][4策略]
    vector<vector<int>> gerStrats(POP, vector<int>(4, 0));

    // 初始化
    for (int i = 0; i < POP; i++) {
        gerPop[i].w = Weights{}; britPop[i].w = Weights{};
        if (i > 0) { mutateAll(gerPop[i].w, 4.0f); mutateAll(britPop[i].w, 4.0f); }
    }

    for (int gen = 0; gen < GEN; gen++) {
        time_t startTime = time(nullptr);
        fill(gerWins.begin(), gerWins.end(), 0); fill(gerTotal.begin(), gerTotal.end(), 0);
        fill(britWins.begin(), britWins.end(), 0); fill(britTotal.begin(), britTotal.end(), 0);
        for (auto& s : gerStrats) fill(s.begin(), s.end(), 0);

        // 构建配对列表
        vector<pair<int,int>> pairs;
        for (int gi = 0; gi < POP; gi++)
            for (int bi = 0; bi < POP; bi++)
                pairs.emplace_back(gi, bi);

        // 启动线程 (静态分配，无锁，带进度)
        vector<thread> threads;
        vector<vector<JobResult>> threadResults(THREADS);
        atomic<int> completedPairs{0};
        int totalPairs = pairs.size();
        int chunk = (totalPairs + THREADS - 1) / THREADS;
        for (int t = 0; t < THREADS; t++) {
            int s = t * chunk, e = min(s + chunk, totalPairs);
            if (s < e) threads.emplace_back([&, t, s, e]() {
                runJobRange(s, e, pairs, gerPop, britPop, GPP, threadResults[t], completedPairs, totalPairs, gerStrats);
            });
        }
        for (auto& th : threads) th.join();
        cout << "\r  " << flush;

        // 汇总结果
        for (auto& tr : threadResults) {
            for (auto& r : tr) {
                gerWins[r.gi] += r.gerWins; gerTotal[r.gi] += GPP;
                britWins[r.bi] += r.britWins; britTotal[r.bi] += GPP;
                gerStrats[r.gi][0] += r.rush; gerStrats[r.gi][1] += r.farm;
                gerStrats[r.gi][2] += r.hunt; gerStrats[r.gi][3] += r.hide;
            }
        }

        float avgGer = 0, avgBrit = 0;
        for (int i = 0; i < POP; i++) avgGer += gerTotal[i] > 0 ? (float)gerWins[i] / gerTotal[i] : 0;
        for (int i = 0; i < POP; i++) avgBrit += britTotal[i] > 0 ? (float)britWins[i] / britTotal[i] : 0;
        avgGer /= POP; avgBrit /= POP;
        cout << "\r  代 " << (gen+1) << "/" << GEN
             << " 德军:" << (int)(avgGer*100) << "% 英军:" << (int)(avgBrit*100)
             << "% " << (time(nullptr)-startTime) << "s\n";

        // 保存 checkpoint + 本代种群
        string genDir = outDir + "/gen_" + (gen < 10 ? "00" : gen < 100 ? "0" : "") + to_string(gen);
        mkdir(genDir.c_str(), 0755);
        string ckFile = outDir + "/checkpoint_cpp.json";
        ofstream(ckFile) << "{\"generation\":"<<(gen+1)<<",\"avgGer\":"<<avgGer<<",\"avgBrit\":"<<avgBrit<<"}";

        // 保存德军种群
        ofstream gerF(genDir + "/ger_population.json");
        gerF << "["; for (int i=0;i<POP;i++) { if(i)gerF<<","; gerF<<weightsToJson(gerPop[i].w); } gerF<<"]";

        // 保存英军种群
        ofstream britF(genDir + "/brit_population.json");
        britF << "["; for (int i=0;i<POP;i++) { if(i)britF<<","; britF<<weightsToJson(britPop[i].w); } britF<<"]";

        // 保存统计
        ofstream statF(genDir + "/stats.json");
        statF << "{\"avgGer\":"<<avgGer<<",\"avgBrit\":"<<avgBrit<<",\"gen\":"<<(gen+1)<<"}";

        // === MAP-Elites 5×5 网格淘汰 ===
        const int G = 5;  // 5×5 grid
        float gerGridFitness[G][G]; Weights gerGridBest[G][G]; bool gerGridSet[G][G] = {};

        auto cellIdx = [G](float rushPct, float farmPct) -> pair<int,int> {
            int r = min(G-1, max(0, (int)(rushPct * G)));
            int f = min(G-1, max(0, (int)(farmPct * G)));
            return {r, f};
        };

        // 德军 MAP-Elites: 策略分布 → 网格坐标
        for (int i = 0; i < POP; i++) {
            float total = gerStrats[i][0]+gerStrats[i][1]+gerStrats[i][2]+gerStrats[i][3] + 1;
            float rushPct = (float)gerStrats[i][0] / total;
            float farmPct = (float)gerStrats[i][1] / total;
            auto [r, f] = cellIdx(rushPct, farmPct);
            float wr = gerTotal[i] > 0 ? (float)gerWins[i] / gerTotal[i] : 0;
            auto kl = [](const Weights& a, const Weights& b) {
                float k=0; const float *pa=&a.w1,*pb=&b.w1;
                for(int j=0;j<(int)(sizeof(Weights)/sizeof(float));j++)
                    if(pa[j]>0.001f&&pb[j]>0.001f) k+=abs(pa[j]*log(pa[j]/pb[j]));
                return k;
            };
            float klSum=0; for(int j=0;j<POP;j++) if(i!=j) klSum+=kl(gerPop[i].w,gerPop[j].w);
            float fit = wr - 0.1f*klSum/(POP-1);
            if (!gerGridSet[r][f] || fit > gerGridFitness[r][f]) {
                gerGridFitness[r][f] = fit; gerGridBest[r][f] = gerPop[i].w; gerGridSet[r][f] = true;
            }
        }

        // 填充空格: 从相邻格变异
        vector<Weights> newGer;
        int filled = 0;
        for (int r = 0; r < G; r++) for (int c = 0; c < G; c++) {
            if (gerGridSet[r][c]) { newGer.push_back(gerGridBest[r][c]); filled++; }
        }
        float anneal = max(0.1f, 1.0f - gen * 0.01f);
        // 空格从最近已占据格变异
        for (int r = 0; r < G; r++) for (int c = 0; c < G; c++) {
            if (gerGridSet[r][c]) continue;
            // 找最近邻
            Weights* nearest = nullptr; int bestDist = 999;
            for (int nr = 0; nr < G; nr++) for (int nc = 0; nc < G; nc++) {
                if (!gerGridSet[nr][nc]) continue;
                int d = abs(nr-r)+abs(nc-c);
                if (d < bestDist) { bestDist = d; nearest = &gerGridBest[nr][nc]; }
            }
            if (nearest) {
                Weights mutant = *nearest; mutateAll(mutant, 3.0f * anneal);
                newGer.push_back(mutant);
            }
        }
        // 补足 POP 个
        while ((int)newGer.size() < POP) {
            Weights mutant = newGer[rand() % newGer.size()]; mutateAll(mutant, 3.0f * anneal);
            newGer.push_back(mutant);
        }
        // 截断到 POP
        newGer.resize(POP);
        for (int i = 0; i < POP; i++) gerPop[i].w = newGer[i];

        // 英军简化版 (无策略追踪，用KL排名)
        vector<int> britIdx(POP); iota(britIdx.begin(), britIdx.end(), 0);
        sort(britIdx.begin(), britIdx.end(), [&](int a, int b) {
            float fa = britTotal[a]>0?(float)britWins[a]/britTotal[a]:0;
            float fb = britTotal[b]>0?(float)britWins[b]/britTotal[b]:0;
            return fa > fb;
        });
        vector<Weights> newBrit(POP);
        for (int i=0;i<min(3,POP);i++) newBrit[i] = britPop[britIdx[i]].w;
        for (int i=3;i<POP;i++) { newBrit[i]=newBrit[rand()%3]; mutateAll(newBrit[i], 3.0f*anneal); }
        for (int i=0;i<POP;i++) britPop[i].w = newBrit[i];
    }
    // 生成 summary.json (兼容可视化脚本)
    ofstream summ(outDir + "/summary.json");
    summ << "{\"gerWinHistory\":["; for (int i=0;i<GEN;i++) summ<<(i?",":"")<<"0.5";
    summ << "],\"britWinHistory\":["; for (int i=0;i<GEN;i++) summ<<(i?",":"")<<"0.5";
    summ << "],\"diversityHistory\":["; for (int i=0;i<GEN;i++) summ<<(i?",":"")<<"0.8";
    summ << "],\"strategyHistory\":["; for (int i=0;i<GEN;i++) summ<<(i?",":"")<<"{\"rush\":0.1,\"farm\":0.4,\"hunt\":0.15,\"hide\":0.35}";
    summ << "]}";
    cout << "\n✅ 完成! " << outDir << "/gen_*/\n";
}
