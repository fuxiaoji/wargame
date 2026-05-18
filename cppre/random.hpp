#pragma once
#include <vector>
#include <algorithm> // 引入 std::swap
#include <cstdint>   // 引入固定大小的整数类型 (如 uint32_t)

// C++ 中接口通常以 I 开头命名
class IRandomizer {
public:
    virtual ~IRandomizer() = default; // 必备的虚析构函数，防止内存泄漏

    // 1. 投一个 D6，返回 1-6
    virtual int d6() = 0;

    // 2. 返回 [0, max) 随机整数
    // 注意：C++ 中 int 是关键字，所以改名叫 nextInt
    virtual int nextInt(int max) = 0;

    // 3. Fisher-Yates 洗牌 (泛型实现)
    template <typename T>
    std::vector<T> shuffle(const std::vector<T>& arr) {
        std::vector<T> result = arr; // 拷贝一份原数组
        
        // 使用 size_t，并且条件是 i > 0 防止死循环下溢出
        for (size_t i = result.size() - 1; i > 0; --i) {
            size_t j = nextInt(i + 1); // 借助具体的子类去生成随机数
            std::swap(result[i], result[j]);
        }
        return result;
    }
};
#include <random>

class DefaultRandom : public IRandomizer {
private:
    // C++11 标准的高质量随机数生成器引擎
    std::mt19937 rng; 

public:
    DefaultRandom() {
        // 构造函数：用操作系统的真随机硬件设备，给引擎提供一颗随机种子
        rng.seed(std::random_device{}()); 
    }

    int d6() override {
        // 定义一个 1 到 6 的均匀分布
        std::uniform_int_distribution<int> dist(1, 6);
        return dist(rng); // 让引擎吐出一个符合这个分布的数字
    }

    int nextInt(int max) override {
        if (max <= 0) return 0; // 防御性编程
        // 定义一个 0 到 max-1 的均匀分布
        std::uniform_int_distribution<int> dist(0, max - 1);
        return dist(rng);
    }
};
class SeededRandom : public IRandomizer {
private:
    uint32_t state;   // uint32_t 完美对应 32 位无符号整数
    uint32_t counter;

    // 私有辅助方法，生成 0.0 到 1.0 之间的小数 (完全等价于 Math.random)
    double next() {
        // C++ 的无符号整数溢出是合法的，会自动截断，完美替代 JS 的位运算模拟
        uint32_t t = (state += 0x6d2b79f5 + counter++);
        
        // TS: t = Math.imul(t ^ (t >>> 15), t | 1)
        // C++: 无符号整数的 >> 自动等价于 TS 的无符号右移 >>>，乘法直接替代 imul
        t = (t ^ (t >> 15)) * (t | 1);
        
        // TS: t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        t ^= t + (t ^ (t >> 7)) * (t | 61);
        
        // TS: return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        uint32_t finalInt = (t ^ (t >> 14));
        
        // 除以 2 的 32 次方，得到一个 [0, 1) 的 double 小数
        return static_cast<double>(finalInt) / 4294967296.0; 
    }

public:
    // 构造函数，接收固定的种子
    SeededRandom(uint32_t seed) : state(seed), counter(0) {}

    int d6() override {
        // 逻辑与 TS 保持完全一致
        return static_cast<int>(next() * 6) + 1;
    }

    int nextInt(int max) override {
        if (max <= 0) return 0;
        return static_cast<int>(next() * max);
    }
};