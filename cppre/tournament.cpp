/** C++ 高速锦标赛引擎 */
#include "state_machine.hpp"
#include "env.hpp"
#include <iostream>
#include <fstream>
#include <sstream>
#include <cstdlib>
#include <ctime>
#include <sys/stat.h>

struct WeightSet {
    Weights w; int wins = 0, total = 0;
    int rush = 0, farm = 0, hunt = 0, hide = 0;
};

// 简易 JSON 读写（不引入库，够用）
template<typename T>
T getN(const std::string& json, const std::string& key, T def) {
    auto pos = json.find("\"" + key + "\"");
    if (pos == std::string::npos) return def;
    pos = json.find(":", pos);
    if (pos == std::string::npos) return def;
    pos = json.find_first_not_of(": \t\n", pos);
    if (pos == std::string::npos) return def;
    std::string val = json.substr(pos, json.find_first_of(",}\n", pos) - pos);
    if constexpr (std::is_same<T, float>::value) return std::stof(val);
    if constexpr (std::is_same<T, int>::value) return std::stoi(val);
    return def;
}

float getWeight(const std::string& json, const std::string& key, float def) { return getN<float>(json, key, def); }

Weights loadWeights(const std::string& json) {
    Weights w;
    w.w1=getWeight(json,"w1",3); w.w2=getWeight(json,"w2",2); w.w3=getWeight(json,"w3",1); w.w4=getWeight(json,"w4",4);
    w.w5=getWeight(json,"w5",2); w.w6=getWeight(json,"w6",3); w.w7=getWeight(json,"w7",2); w.w8=getWeight(json,"w8",1);
    w.w9=getWeight(json,"w9",4); w.w10=getWeight(json,"w10",2); w.w11=getWeight(json,"w11",1);
    w.w12=getWeight(json,"w12",2); w.w13=getWeight(json,"w13",3); w.w14=getWeight(json,"w14",1); w.w15=getWeight(json,"w15",2);
    w.s1=getWeight(json,"s1",10); w.s2=getWeight(json,"s2",0.5f); w.s3=getWeight(json,"s3",1);
    w.h1=getWeight(json,"h1",10); w.h2=getWeight(json,"h2",5); w.h3=getWeight(json,"h3",3);
    w.d1=getWeight(json,"d1",5); w.d2=getWeight(json,"d2",3); w.d3=getWeight(json,"d3",4);
    w.temperature=getWeight(json,"temperature",1);
    return w;
}

std::string weightsToJson(const Weights& w) {
    std::ostringstream j;
    j << "{";
    j << "\"w1\":"<<w.w1<<",\"w2\":"<<w.w2<<",\"w3\":"<<w.w3<<",\"w4\":"<<w.w4<<",";
    j << "\"w5\":"<<w.w5<<",\"w6\":"<<w.w6<<",\"w7\":"<<w.w7<<",\"w8\":"<<w.w8<<",";
    j << "\"w9\":"<<w.w9<<",\"w10\":"<<w.w10<<",\"w11\":"<<w.w11<<",";
    j << "\"w12\":"<<w.w12<<",\"w13\":"<<w.w13<<",\"w14\":"<<w.w14<<",\"w15\":"<<w.w15<<",";
    j << "\"s1\":"<<w.s1<<",\"s2\":"<<w.s2<<",\"s3\":"<<w.s3<<",";
    j << "\"h1\":"<<w.h1<<",\"h2\":"<<w.h2<<",\"h3\":"<<w.h3<<",";
    j << "\"d1\":"<<w.d1<<",\"d2\":"<<w.d2<<",\"d3\":"<<w.d3<<",";
    j << "\"temperature\":"<<w.temperature;
    j << "}";
    return j.str();
}

// 跑一局，返回德军是否胜
bool runOneGame(const Weights& gerW, const Weights& britW) {
    GermanBrain ger(gerW); BritishBrain brit(britW);
    BismarckEnv env;
    int steps = 0, stuck = 0; Phase lastPhase = Phase::game_over;

    while (!env.game.state.gameOver && steps < 500) {
        auto obs = env.getFastObservation();  // 跳过文本生成，加速
        if (obs.phase != Phase::setup_british && obs.actions.empty()) break;

        if (obs.phase == lastPhase) stuck++;
        else { stuck = 0; lastPhase = obs.phase; }
        if (stuck > 20) {
            for (auto& a : obs.actions)
                if (a.type == ActionType::FinishPhase) { env.step(a); stuck = 0; break; }
            continue;
        }

        int actionId = -1;
        if (obs.phase == Phase::setup_british) {
            std::vector<std::string> dh = {"E5","E3","D5","C7","B6","F6","F5","F3","F2","E1","D1","C1"};
            for (auto& sh : env.game.state.britishShips)
                if (sh.def.isDummy && !env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, dh[std::rand()%dh.size()]);
            std::vector<std::string> hs = {"E7","E6","E5","E3","E2","E1","D7","D5","D1","C7","C1","B6","F6","F5","F3","F2"};
            for (auto& sh : env.game.state.britishShips)
                if (!env.game.state.britishPositions.count(sh.def.id))
                    env.game.placeBritishToken(sh.def.id, hs[std::rand()%hs.size()]);
            env.game.finishSetup();
            steps++; continue;
        }

        std::string phStr = phName(obs.phase);
        if (obs.activePlayer == ShipSide::german) actionId = ger.selectAction(env.game.state, obs.actions, phStr);
        else actionId = brit.selectAction(env.game.state, obs.actions, phStr);

        if (actionId >= 0) {
            for (auto& a : obs.actions) if (a.id == actionId) { env.step(a); break; }
        } else if (!obs.actions.empty()) {
            env.step(obs.actions[0]);
        }
        steps++;
    }
    return env.game.state.winner && *env.game.state.winner == ShipSide::german;
}

int main(int argc, char** argv) {
    std::srand(std::time(nullptr));
    int GEN = argc > 1 ? std::stoi(argv[1]) : 20;
    int POP = argc > 2 ? std::stoi(argv[2]) : 5;
    int GPP = argc > 3 ? std::stoi(argv[3]) : 50; // games per pair
    std::string outDir = argc > 4 ? argv[4] : "/Users/Zhuanz1/Desktop/code/wargame/tournament";

    mkdir(outDir.c_str(), 0755);

    // 加载或创建种群
    std::vector<WeightSet> gerPop(POP), britPop(POP);
    std::string ckFile = outDir + "/checkpoint_cpp.json";
    std::ifstream ckIn(ckFile);
    int startGen = 0;

    if (ckIn.good()) {
        std::string json((std::istreambuf_iterator<char>(ckIn)), std::istreambuf_iterator<char>());
        startGen = getN<int>(json, "generation", 0);
        std::cout << "从第 " << startGen << " 代恢复\n";
        // 简化: 重新随机初始化
    }

    // 初始化种群 (全部权重 30% 概率变异, 与 TS 版一致)
    auto mutateAll = [](Weights& w, float scale) {
        float* ptr = &w.w1; int count = sizeof(Weights) / sizeof(float);
        for (int i = 0; i < count; i++) {
            if ((float)std::rand()/RAND_MAX < 0.3f) {
                float& val = *(ptr + i);
                val = std::max(0.1f, val + ((float)std::rand()/RAND_MAX - 0.5f) * scale);
            }
        }
    };
    for (int i = 0; i < POP; i++) {
        gerPop[i].w = Weights{};
        britPop[i].w = Weights{};
        if (i > 0) {
            mutateAll(gerPop[i].w, 4.0f);
            mutateAll(britPop[i].w, 4.0f);
        }
    }

    std::cout << "C++ 锦标赛: " << GEN << "代 × " << POP << "×" << POP << " × " << GPP << "局\n";
    std::cout << "总局数/代: " << (POP * POP * GPP) << "\n\n";

    for (int gen = startGen; gen < GEN; gen++) {
        auto t0 = time(nullptr);
        // 重置统计
        for (auto& p : gerPop) { p.wins = 0; p.total = 0; p.rush = p.farm = p.hunt = p.hide = 0; }
        for (auto& p : britPop) { p.wins = 0; p.total = 0; }

        int completed = 0, total = POP * POP * GPP;
        for (int gi = 0; gi < POP; gi++) {
            for (int bi = 0; bi < POP; bi++) {
                for (int g = 0; g < GPP; g++) {
                    bool swap = g >= GPP / 2;
                    const Weights& gerW = swap ? britPop[bi].w : gerPop[gi].w;
                    const Weights& britW = swap ? gerPop[gi].w : britPop[bi].w;
                    bool gerWin = runOneGame(gerW, britW);

                    // 胜场记在"谁在玩德军谁就是德军权重"
                    if (!swap) {
                        gerPop[gi].total++; if (gerWin) gerPop[gi].wins++;
                        britPop[bi].total++; if (!gerWin) britPop[bi].wins++;
                    } else {
                        // swap=true: britPop[bi].w 玩德军, gerPop[gi].w 玩英军
                        britPop[bi].total++; if (gerWin) britPop[bi].wins++;
                        gerPop[gi].total++; if (!gerWin) gerPop[gi].wins++;
                    }
                    completed++;
                    if (completed % (total / 20 + 1) == 0) {
                        float pct = completed * 100.0f / total;
                        float elapsed = time(nullptr) - t0 + 1;
                        std::cout << "\r  进度: " << (int)pct << "% " << completed << "/" << total
                                  << " 速度:" << (int)(completed / elapsed) << "局/秒" << std::flush;
                    }
                }
            }
        }

        float elapsed = time(nullptr) - t0 + 1;
        float avgGer = 0, avgBrit = 0;
        for (auto& p : gerPop) avgGer += p.total > 0 ? (float)p.wins / p.total : 0;
        for (auto& p : britPop) avgBrit += p.total > 0 ? (float)p.wins / p.total : 0;
        avgGer /= POP; avgBrit /= POP;

        std::cout << "\r  代 " << (gen+1) << "/" << GEN
                  << " 德军:" << (int)(avgGer*100) << "% 英军:" << (int)(avgBrit*100)
                  << "% " << (int)elapsed << "s\n";

        // 保存 checkpoint
        std::ostringstream ck;
        ck << "{\"generation\":" << (gen+1) << ",\"gerPop\":[";
        for (int i = 0; i < POP; i++) { if (i) ck << ","; ck << weightsToJson(gerPop[i].w); }
        ck << "],\"britPop\":[";
        for (int i = 0; i < POP; i++) { if (i) ck << ","; ck << weightsToJson(britPop[i].w); }
        ck << "],\"avgGer\":" << avgGer << ",\"avgBrit\":" << avgBrit << "}";
        std::ofstream(ckFile) << ck.str();

        // 排名: 综合德军胜率+英军胜率
        std::sort(gerPop.begin(), gerPop.end(), [](auto& a, auto& b) {
            float fa = (a.total>0?(float)a.wins/a.total:0);
            float fb = (b.total>0?(float)b.wins/b.total:0);
            return fa > fb;
        });
        std::sort(britPop.begin(), britPop.end(), [](auto& a, auto& b) {
            float fa = (a.total>0?(float)a.wins/a.total:0);
            float fb = (b.total>0?(float)b.wins/b.total:0);
            return fa > fb;
        });

        float anneal = std::max(0.1f, 1.0f - gen * 0.01f);  // 退火
        for (int i = 3; i < POP; i++) {
            int parent = std::rand() % 3;
            gerPop[i].w = gerPop[parent].w; mutateAll(gerPop[i].w, 2.0f * anneal);
            britPop[i].w = britPop[parent].w; mutateAll(britPop[i].w, 2.0f * anneal);
        }
    }

    std::cout << "\n✅ 完成! " << outDir << "/checkpoint_cpp.json\n";
    return 0;
}
