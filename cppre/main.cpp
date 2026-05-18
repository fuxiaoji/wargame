#include "type.hpp"
#include "units.hpp"
#include <iostream>
#include "map.hpp"

int main() {
    std::cout << "德军 " << ALL_GERMAN_SHIPS.size() << " 艘\n";
    std::cout << "英军 " << ALL_BRITISH_SHIPS.size() << " 艘\n";
    std::cout << "伪装算子 " << DUMMY_COUNT << " 个\n";
    std::cout << "英军算子总计 " << getAllBritishTokens().size() << " 个\n";
    std::cout << "地图格数 " << labelToCoord.size() << " 个\n";
    // 测试工厂函数
    ShipState b = createShipState(BISMARCK);
    std::cout << "\n" << b.def.name << " Step:" << b.steps
              << " 攻:" << b.def.attack << " 防:" << b.def.defense << "\n";

    std::cout << "\n编译通过！\n";
    return 0;
}
