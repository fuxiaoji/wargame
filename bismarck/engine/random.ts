/** 可注入的随机数接口 (方便测试和 AI 复现) */
export interface Randomizer {
  /** 投一个 D6，返回 1-6 */
  d6(): number
  /** 返回 [0, max) 随机整数 */
  int(max: number): number
  /** Fisher-Yates 洗牌 */
  shuffle<T>(arr: T[]): T[]
}

export class DefaultRandom implements Randomizer {
  d6(): number {
    return Math.floor(Math.random() * 6) + 1
  }

  int(max: number): number {
    return Math.floor(Math.random() * max)
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}

/** 可注入的确定性随机 (测试/AI 用) */
export class SeededRandom implements Randomizer {
  private state: number
  private counter: number

  constructor(seed: number) {
    this.state = seed
    this.counter = 0
  }

  private next(): number {
    // mulberry32 PRNG
    let t = (this.state += 0x6d2b79f5 + this.counter++)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  d6(): number {
    return Math.floor(this.next() * 6) + 1
  }

  int(max: number): number {
    return Math.floor(this.next() * max)
  }

  shuffle<T>(arr: T[]): T[] {
    const result = [...arr]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }
}
