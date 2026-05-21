#pragma once

#include "type.hpp"
#include "setup.hpp"
#include "map.hpp"
#include "random.hpp"
#include "movement.hpp"
#include "search.hpp"
#include "combat.hpp"
#include "transport.hpp"
#include "victory.hpp"

class BismarckGame {
public:
    GameState state;

    // 不传 seed → 随机种子；传 seed → 可复现
    BismarckGame() : state(createGameState()), rng() {}
    explicit BismarckGame(int seed) : state(createGameState()), rng(static_cast<uint32_t>(seed)) {}

    // 拿随机数引用，供搜索/战斗/运输模块用
    IRandomizer& getRng() { return rng; }

    // 当前轮到谁操作
    ShipSide getActivePlayer() const {
        switch (state.phase) {
            case Phase::setup_german:
            case Phase::german_move:
            case Phase::transport_attack:
                return ShipSide::german;
            default:
                return ShipSide::british;
        }
    }

private:
    SeededRandom rng;

    // 游戏结束
    void endGame(const VictoryCheck& v) {
        state.gameOver = true;
        state.winner = v.winner;
        state.victoryReason = v.reason;
        state.phase = Phase::game_over;
    }

    // 回合结束 → 检查胜利 → 进入下一回合
    void endTurn() {
        state.phaseStep = 0;
        auto v = checkEndTurnVictory(state);
        if (v.gameOver) { endGame(v); return; }
        state.turn++;
        state.combatPending = false;
        state.transportPending = false;
        state.movedThisTurn.clear();
        state.phase = Phase::german_move;
    }

    // ===== 接下来是公开方法，你从第 2 段开始写 =====
};
