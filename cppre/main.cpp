#include "env.hpp"
#include "tensor_logger.hpp"
#include <iostream>
#include <cstdlib>
#include <ctime>
#include <string>

int main() {
    std::srand(static_cast<unsigned>(std::time(nullptr)));
    std::string outDir = "../deeplearn/data/test";

    // 确保输出目录存在
    std::string cmd = "mkdir -p " + outDir;
    system(cmd.c_str());

    int germanWins = 0, britishWins = 0;
    const int GAMES = 5;

    for (int g = 0; g < GAMES; ++g) {
        BismarckEnv env;
        std::string gameId = "game_" + std::to_string(g);

        std::vector<float> stateBuf;
        std::vector<ActionRecord> actions;
        int stepIdx = 0;

        while (!env.game.state.gameOver && stepIdx < T) {
            float slice[SLICE_SIZE];
            fillStateSlice(slice, env.game.state, ShipSide::german); // 全局视角
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
            if (obs.phase == Phase::setup_british && acts.size() == 1
                && acts[0].type == ActionType::Move
                && acts[0].label == "发送初设并开始游戏") {
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

        // 补零
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
        res.winner = (s.winner && *s.winner == ShipSide::german) ? "german" : "british";
        res.vp_german = s.vp.german; res.vp_british = s.vp.british;
        res.turns = s.turn; res.total_steps = stepIdx; res.seed = -1;
        res.bismarck_sunk = [&](){
            auto it = std::find_if(s.germanShips.begin(), s.germanShips.end(),
                [](const ShipState& sh){ return sh.def.id == "bismarck"; });
            return it != s.germanShips.end() && it->steps <= 0;
        }();
        res.brest_reached = s.victoryReason.find("布雷斯特") != std::string::npos;

        writeGameLog(outDir, gameId, stateBuf, actions, res);

        if (s.winner && *s.winner == ShipSide::german) germanWins++;
        else britishWins++;

        std::cout << gameId << ": " << res.winner << "胜 | T" << s.turn
                  << " | 德" << s.vp.german << "VP/英" << s.vp.british << "VP"
                  << " | " << s.victoryReason << std::endl;
    }

    std::cout << "\n" << GAMES << " 局完成: 德军" << germanWins << " 英军" << britishWins << std::endl;
    std::cout << "日志目录: " << outDir << std::endl;
    return 0;
}
