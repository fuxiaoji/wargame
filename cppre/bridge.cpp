#include "env.hpp"
#include <iostream>
#include <string>
#include <sstream>
#include <unordered_map>

// 简易 JSON 序列化（不引入第三方库，手写几个字段）
static std::string esc(const std::string& s) {
    std::string r; r.reserve(s.size());
    for (char c : s) { if (c == '"' || c == '\\') r += '\\'; r += c; }
    return r;
}

static std::string shipPosJson(const GameState& s, const std::string& id,
                                const std::unordered_map<std::string, HexCoord>& posMap) {
    auto it = posMap.find(id);
    if (it == posMap.end()) return "null";
    auto label = hexToLabel(it->second).value_or("?");
    return "\"" + label + "\"";
}

static std::string stateToJson(const GameState& s) {
    std::ostringstream j;
    j << "{";
    j << "\"turn\":" << s.turn;
    j << ",\"phase\":\"" << (int)s.phase << "\"";
    j << ",\"vpGerman\":" << s.vp.german;
    j << ",\"vpBritish\":" << s.vp.british;
    j << ",\"bismarckFound\":" << (s.bismarckFound ? "true" : "false");
    j << ",\"combatPending\":" << (s.combatPending ? "true" : "false");
    j << ",\"transportPending\":" << (s.transportPending ? "true" : "false");
    j << ",\"gameOver\":" << (s.gameOver ? "true" : "false");

    if (s.winner)
        j << ",\"winner\":\"" << (*s.winner == ShipSide::german ? "german" : "british") << "\"";
    else
        j << ",\"winner\":null";
    j << ",\"victoryReason\":\"" << esc(s.victoryReason) << "\"";

    // 英军位置
    j << ",\"britishPositions\":{";
    bool first = true;
    for (const auto& [id, coord] : s.britishPositions) {
        if (!first) j << ","; first = false;
        j << "\"" << esc(id) << "\":\"" << hexToLabel(coord).value_or("?") << "\"";
    }
    j << "}";

    // 德军位置（仅当公开时）
    if (s.bismarckFound || s.germanPositionPublic) {
        j << ",\"germanPositions\":{";
        first = true;
        for (const auto& [id, coord] : s.germanPositions) {
            if (!first) j << ","; first = false;
            j << "\"" << esc(id) << "\":\"" << hexToLabel(coord).value_or("?") << "\"";
        }
        j << "}";
    }

    j << ",\"ships\":{";
    j << "\"german\":[";
    for (size_t i = 0; i < s.germanShips.size(); ++i) {
        if (i) j << ",";
        const auto& sh = s.germanShips[i];
        j << "{\"id\":\"" << esc(sh.def.id) << "\""
          << ",\"name\":\"" << esc(sh.def.name) << "\""
          << ",\"steps\":" << sh.steps
          << ",\"maxSteps\":" << sh.def.maxSteps
          << ",\"attack\":" << sh.def.attack
          << ",\"defense\":" << sh.def.defense;
        auto pit = s.germanPositions.find(sh.def.id);
        if (pit != s.germanPositions.end())
            j << ",\"pos\":\"" << hexToLabel(pit->second).value_or("?") << "\"";
        j << "}";
    }
    j << "],\"british\":[";
    for (size_t i = 0; i < s.britishShips.size(); ++i) {
        if (i) j << ",";
        const auto& sh = s.britishShips[i];
        j << "{\"id\":\"" << esc(sh.def.id) << "\""
          << ",\"name\":\"" << esc(sh.def.name) << "\""
          << ",\"steps\":" << sh.steps
          << ",\"maxSteps\":" << sh.def.maxSteps
          << ",\"attack\":" << sh.def.attack
          << ",\"defense\":" << sh.def.defense
          << ",\"revealed\":" << (sh.revealed ? "true" : "false")
          << ",\"isDummy\":" << (sh.def.isDummy ? "true" : "false");
        auto pit = s.britishPositions.find(sh.def.id);
        if (pit != s.britishPositions.end())
            j << ",\"pos\":\"" << hexToLabel(pit->second).value_or("?") << "\"";
        j << "}";
    }
    j << "]}";

    j << "}";
    return j.str();
}

int main() {
    std::ios::sync_with_stdio(false);
    BismarckEnv env(42); // 固定种子可复现，改 0 用随机

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        // 极简 JSON 解析：{ "method": "xxx", "args": ["a","b"] }
        auto findStr = [&](const std::string& key) -> std::string {
            auto pos = line.find("\"" + key + "\"");
            if (pos == std::string::npos) return "";
            pos = line.find("\"", pos + key.size() + 2);
            if (pos == std::string::npos) return "";
            auto end = line.find("\"", pos + 1);
            if (end == std::string::npos) return "";
            return line.substr(pos + 1, end - pos - 1);
        };

        std::string method = findStr("method");
        std::string arg1 = findStr("arg1");
        std::string arg2 = findStr("arg2");
        std::string arg3 = findStr("arg3");

        std::string response;
        auto& g = env.game;

        if (method == "state") {
            response = stateToJson(g.state);
        }
        else if (method == "setGermanStart") {
            auto r = g.setGermanStart(arg1);
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "placeBritishToken") {
            auto r = g.placeBritishToken(arg1, arg2);
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "finishSetup") {
            auto r = g.finishSetup();
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "germanMove") {
            auto r = g.germanMove(arg1, arg2);
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "finishGermanMove") {
            auto r = g.finishGermanMove();
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "britishMove") {
            auto r = g.britishMove(arg1, arg2);
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "finishBritishMove") {
            auto r = g.finishBritishMove();
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "doSearch") {
            auto result = g.doSearch();
            response = "{\"searchType\":\"" + std::string(result.type == SearchType::None ? "none" : result.type == SearchType::CoLocate ? "co-locate" : "air-search")
                       + "\",\"germanLabel\":\"" + result.germanLabel.value_or("") + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "doAirSearch") {
            auto result = g.doAirSearch(arg1);
            response = "{\"searchType\":\"air-search\""
                       + std::string(",\"found\":") + (result.foundShips.empty() ? "false" : "true")
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "finishSearch") {
            auto r = g.finishSearch();
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "doCombat") {
            auto result = g.doCombat();
            response = "{\"shipsSunk\":[";
            for (size_t i = 0; i < result.shipsSunk.size(); ++i) {
                if (i) response += ",";
                response += "\"" + esc(result.shipsSunk[i]) + "\"";
            }
            response += "],\"germanVp\":" + std::to_string(result.germanVpGained)
                      + ",\"britishVp\":" + std::to_string(result.britishVpGained)
                      + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "doTransportAttack") {
            auto result = g.doTransportAttack(arg1);
            response = "{\"revealed\":" + std::string(result.positionRevealed ? "true" : "false")
                       + ",\"vp\":" + std::to_string(result.vpGained)
                       + ",\"desc\":\"" + esc(result.description) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "skipTransportAttack") {
            g.skipTransportAttack();
            response = "{\"ok\":true,\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "undoLastMove") {
            auto r = g.undoLastMove(arg1);
            response = "{\"ok\":" + std::string(r.ok ? "true" : "false")
                       + ",\"error\":\"" + esc(r.error) + "\""
                       + ",\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "getReachable") {
            // 返回某船可达格
            auto& s = g.state;
            std::string labels = "[";
            bool first = true;

            auto gIt = std::find_if(s.germanShips.begin(), s.germanShips.end(),
                [&](const ShipState& sh) { return sh.def.id == arg1; });
            if (gIt != s.germanShips.end() && gIt->steps > 0) {
                auto pit = s.germanPositions.find(arg1);
                if (pit != s.germanPositions.end()) {
                    for (auto& l : getGermanReachableLabels(pit->second, *gIt)) {
                        if (!first) labels += ","; first = false;
                        labels += "\"" + l + "\"";
                    }
                }
            }
            auto bIt = std::find_if(s.britishShips.begin(), s.britishShips.end(),
                [&](const ShipState& sh) { return sh.def.id == arg1; });
            if (bIt != s.britishShips.end() && bIt->steps > 0) {
                auto pit = s.britishPositions.find(arg1);
                if (pit != s.britishPositions.end()) {
                    for (auto& l : getBritishReachableLabels(s, pit->second, *bIt)) {
                        if (!first) labels += ","; first = false;
                        labels += "\"" + l + "\"";
                    }
                }
            }
            labels += "]";
            response = "{\"labels\":" + labels + "}";
        }
        else if (method == "getAirSearchTargets") {
            auto& s = g.state;
            std::string labels = "[";
            auto arkIt = std::find_if(s.britishShips.begin(), s.britishShips.end(),
                [](const ShipState& sh) { return sh.def.id == "ark-royal" && sh.steps > 0; });
            if (arkIt != s.britishShips.end()) {
                auto pit = s.britishPositions.find("ark-royal");
                if (pit != s.britishPositions.end()) {
                    auto targets = getAirSearchTargets(pit->second);
                    for (size_t i = 0; i < targets.size(); ++i) {
                        if (i) labels += ",";
                        labels += "\"" + targets[i] + "\"";
                    }
                }
            }
            labels += "]";
            response = "{\"labels\":" + labels + "}";
        }
        else if (method == "getTransportAttackers") {
            auto attackers = getTransportAttackers(g.state);
            std::string ids = "[";
            for (size_t i = 0; i < attackers.size(); ++i) {
                if (i) ids += ",";
                ids += "\"" + attackers[i]->def.id + "\"";
            }
            ids += "]";
            response = "{\"ids\":" + ids + "}";
        }
        else if (method == "newGame") {
            env.reset();
            response = "{\"ok\":true,\"state\":" + stateToJson(g.state) + "}";
        }
        else if (method == "getActivePlayer") {
            auto player = g.getActivePlayer();
            response = "{\"player\":\"" + std::string(player == ShipSide::german ? "german" : "british") + "\"}";
        }
        else {
            response = "{\"error\":\"unknown method: " + esc(method) + "\"}";
        }

        std::cout << response << std::endl;
    }
    return 0;
}
