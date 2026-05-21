#pragma once

#include <vector>
#include <string>
#include <optional>

#include "type.hpp"
#include "map.hpp"
#include "random.hpp" 
#include <sstream>    // 字符串流，用来拼接战斗日志
#include <algorithm>  // 排序算法 std::sort


struct CombatRound
{
    std::string attacker;       // ship name
    std::string target;         // ship name
    int attackDice;             // 投骰数
    int defenseTarget;          // 目标值
    std::vector<int> rolls;     // 每次骰点
    int hits;                   // 成功命中数
};

struct CombatResult
{
    std::vector<CombatRound> rounds;
    int germanVpGained = 0;
    int britishVpGained = 0;
    std::vector<std::string> shipsSunk;
    std::vector<std::string> log;
};

// 前向声明
inline int getEffectiveAttack(const ShipState& ship);

inline CombatRound resolveAttack(
    const ShipState& attacker, // 攻击方 (只读引用)
    const ShipState& target,   // 防守方 (只读引用)
    IRandomizer& rng           // 随机数生成器 (可变引用)
) {
    // std::max 保证骰子数不会变成负数（比如被挂了负面减益）
    int attackDice = std::max(0, getEffectiveAttack(attacker));
    int defenseTarget = target.def.defense;
    
    std::vector<int> rolls;
    // 💡 C++ 老手的性能黑魔法：提前预定内存！
    rolls.reserve(attackDice);
    
    int hits = 0;

    // 开始疯狂掷骰子
    for (int i = 0; i < attackDice; ++i) {
        int roll = rng.d6();
        rolls.push_back(roll); // 塞入记录表
        
        if (roll >= defenseTarget) {
            hits++; // 大于等于防守阈值，判定为命中！
        }
    }

    // 使用 C++11 的聚合初始化 (Aggregate Initialization) 打包返回
    return CombatRound {
        attacker.def.name,
        target.def.name,
        attackDice,
        defenseTarget,
        rolls, 
        hits
    };
}

inline int getEffectiveAttack(const ShipState& ship) {
    if (ship.steps < ship.def.maxSteps && ship.def.side == ShipSide::british) {
        return std::max(0, ship.def.attack - 2); // 受损时攻击力-2
    }
    return ship.def.attack;
}

inline int applyDamage(ShipState& target, int hits) {
    const int actualHits = std::min(hits, target.steps); // 实际命中数不能超过剩余 Step
    target.steps  -= actualHits; // 扣除命中造成的 Step 损失
    return actualHits; // 返回实际造成的伤害，用于 VP 结算
}

// 传入参数：由于我们要给船只扣血，所以 GameState 必须是可变引用（&）
// TS里的可选参数 airAttackTarget，在 C++ 里变成了默认值为 nullptr 的指针
inline CombatResult resolveCombat(
    GameState& state,
    HexCoord combatCoord,
    IRandomizer& rng,
    bool isAirAttack = false,
    ShipState* airAttackTarget = nullptr 
) {
    CombatResult result; // 聚合初始化，整数已在结构体中默认设为 0

    // ==========================================
    // 1. 收集该格的双方舰船 (必须存指针，因为后续要扣血！)
    // ==========================================
    std::vector<ShipState*> germanShips;
    std::vector<ShipState*> britishShips;

    for (auto& s : state.germanShips) {
        if (s.steps <= 0) continue;
        auto posIt = state.germanPositions.find(s.def.id);
        if (posIt != state.germanPositions.end() && hexEquals(posIt->second, combatCoord)) {
            germanShips.push_back(&s); // 存入真实战舰的内存地址
        }
    }

    for (auto& s : state.britishShips) {
        if (s.steps <= 0 || s.def.isDummy) continue; // 忽略死船和假目标
        auto posIt = state.britishPositions.find(s.def.id);
        if (posIt != state.britishPositions.end() && hexEquals(posIt->second, combatCoord)) {
            britishShips.push_back(&s);
        }
    }

    // ==========================================
    // 2. 航空攻击优先结算
    // ==========================================
    if (isAirAttack && airAttackTarget != nullptr) {
        // 查找皇家方舟号
        auto it = std::find_if(state.britishShips.begin(), state.britishShips.end(), [](const ShipState& s) {
            return s.def.id == "ark-royal";
        });

        if (it != state.britishShips.end() && it->steps > 0) {
            ShipState* arkRoyal = &(*it); // 提取出皇家方舟号的指针
            
            // 发起攻击 (之前讲过的骰子结算函数)
            CombatRound round = resolveAttack(*arkRoyal, *airAttackTarget, rng);
            result.rounds.push_back(round);

            // 扣血并结算 VP！ (注意解引用 *)
            int vp = applyDamage(*airAttackTarget, round.hits);
            result.britishVpGained += vp;

            // 🌟 C++ 的字符串拼接黑魔法：ostringstream
            std::ostringstream logStream;
            logStream << "航空攻击: " << arkRoyal->def.name << " → " << airAttackTarget->def.name 
                      << ", 投骰 [";
            // 模拟 JS 的 join(', ')
            for (size_t i = 0; i < round.rolls.size(); ++i) {
                logStream << round.rolls[i];
                if (i < round.rolls.size() - 1) logStream << ", ";
            }
            logStream << "], 命中 " << round.hits << " 次";
            result.log.push_back(logStream.str()); // 转换为 string 存入日志

            // 沉没判定
            if (airAttackTarget->steps <= 0) {
                result.shipsSunk.push_back(airAttackTarget->def.name);
                result.log.push_back(airAttackTarget->def.name + " 被击沉!");
            }
        }
    }

    // ==========================================
    // 3. 表面战斗 (重头戏：按攻击力排序)
    // ==========================================
    std::vector<ShipState*> allAttackers;
    // 模拟 TS 的 [...germanShips, ...britishShips]
    for (auto ship : germanShips) if (ship->steps > 0) allAttackers.push_back(ship);
    for (auto ship : britishShips) if (ship->steps > 0) allAttackers.push_back(ship);

    // 🌟 C++ 的 Lambda 排序机制：从高到低排序 (降序)
    std::sort(allAttackers.begin(), allAttackers.end(), [](ShipState* a, ShipState* b) {
        return getEffectiveAttack(*a) > getEffectiveAttack(*b); 
    });

    // 遍历所有存活且参战的船只，依次开火
    for (ShipState* attacker : allAttackers) {
        if (attacker->steps <= 0) continue; // 可能在前面回合刚被打沉了，不能再还击
        
        // 航空战斗时 Ark Royal 在邻格，不参与水面互殴
        if (isAirAttack && attacker->def.id == "ark-royal") continue;

        // 选择敌方阵营的列表
        const std::vector<ShipState*>& enemyList = (attacker->def.side == ShipSide::german) ? britishShips : germanShips;
        
        std::vector<ShipState*> targets;
        for (auto enemy : enemyList) {
            if (enemy->steps > 0) targets.push_back(enemy);
        }

        if (targets.empty()) continue; // 没活着的敌人了，停止开火

        // 优先攻击敌方当前攻击力最高的单位
        std::sort(targets.begin(), targets.end(), [](ShipState* a, ShipState* b) {
            return getEffectiveAttack(*a) > getEffectiveAttack(*b);
        });

        ShipState* target = targets[0]; // 锁定首要目标

        // 执行攻击与扣血
        CombatRound round = resolveAttack(*attacker, *target, rng);
        result.rounds.push_back(round);

        int vp = applyDamage(*target, round.hits);
        if (attacker->def.side == ShipSide::german) {
            result.germanVpGained += vp;
        } else {
            result.britishVpGained += vp;
        }

        // 拼接日志
        std::ostringstream logStream;
        logStream << attacker->def.name << " → " << target->def.name << ": 投骰 [";
        for (size_t i = 0; i < round.rolls.size(); ++i) {
            logStream << round.rolls[i];
            if (i < round.rolls.size() - 1) logStream << ", ";
        }
        logStream << "], 命中 " << round.hits << " 次";
        result.log.push_back(logStream.str());

        // 沉没判定
        if (target->steps <= 0) {
            result.shipsSunk.push_back(target->def.name);
            result.log.push_back(target->def.name + " 被击沉!");
        }
    }

    return result;
}
inline bool canCombat (const GameState& state, HexCoord coord) {
    // 检查该格是否有双方舰船
    bool hasGerman = false;
    bool hasBritish = false;

    for (const auto& s : state.germanShips) {
        if (s.steps <= 0) continue;
        auto posIt = state.germanPositions.find(s.def.id);
        if (posIt != state.germanPositions.end() && hexEquals(posIt->second, coord)) {
            hasGerman = true;
            break;
        }
    }

    for (const auto& s : state.britishShips) {
        if (s.steps <= 0 || s.def.isDummy) continue;
        auto posIt = state.britishPositions.find(s.def.id);
        if (posIt != state.britishPositions.end() && hexEquals(posIt->second, coord)) {
            hasBritish = true;
            break;
        }
    }

    return hasGerman && hasBritish; // 只有双方都有活船才可战斗
}