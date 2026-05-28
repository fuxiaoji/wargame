/** 状态机预设个体 —— 权重内嵌，无需文件加载即可在浏览器使用 */
import type { Weights } from './state-machine'

export interface PresetInfo {
  label: string
  version: string
  generation: number
  index: number
  side: 'german' | 'british'
  winRate: number
  style: string
  weights: Weights
}

export const GERMAN_PRESETS: PresetInfo[] = [
  {
    label: '德#1 贪心', version: 'training_v1', generation: 19, index: 1, side: 'german', winRate: 0.38, style: '贪心',
    weights: { w1:3.32947,w2:1.26753,w3:1.69273,w4:3.81086,w5:2.3467,w6:7.0588,w7:2.26437,w8:1.76156,w9:2.67395,w10:0.103602,w11:0.1,w12:0.792771,w13:2.59881,w14:0.428668,w15:1.91109,s1:9.26848,s2:1.07617,s3:3.14763,h1:8.36655,h2:5,h3:2.41065,d1:4.4175,d2:1.81786,d3:3.36256,temperature:0.241787 }
  },
  {
    label: '德#2 不躲·贪心', version: 'training_v1', generation: 19, index: 6, side: 'german', winRate: 0.34, style: '不躲·贪心',
    weights: { w1:2.656,w2:1.63725,w3:0.441582,w4:3.19706,w5:2.77504,w6:5.87324,w7:2.26437,w8:1.19517,w9:3.30538,w10:0.215458,w11:0.139115,w12:0.1,w13:1.80242,w14:0.309871,w15:1.18098,s1:10.0358,s2:0.1,s3:3.10526,h1:8.64098,h2:5.61875,h3:1.77941,d1:4.42462,d2:2.10828,d3:3.42193,temperature:0.1 }
  },
  {
    label: '德#3 打工仔·贪心', version: 'training_v1', generation: 19, index: 7, side: 'german', winRate: 0.30, style: '打工仔·贪心',
    weights: { w1:3.31953,w2:1.96553,w3:0.707472,w4:3.28305,w5:3.69798,w6:6.09668,w7:1.51523,w8:1.76156,w9:2.76209,w10:0.171395,w11:0.3249,w12:0.326597,w13:1.47523,w14:0.876759,w15:1.65684,s1:9.66428,s2:1.00787,s3:2.50174,h1:7.58511,h2:5,h3:1.87558,d1:5.1063,d2:1.95128,d3:4,temperature:0.1 }
  },
  {
    label: '德#4 均衡派', version: 'training_v2', generation: 19, index: 6, side: 'german', winRate: 0.28, style: '均衡派',
    weights: { w1:3,w2:3.1717,w3:0.1,w4:4.49987,w5:1.73141,w6:2.41892,w7:1.86504,w8:1,w9:3.26323,w10:3.13349,w11:0.1,w12:0.77209,w13:1.2382,w14:1,w15:2,s1:9.91833,s2:0.1,s3:0.1,h1:9.96313,h2:4.80304,h3:3.28406,d1:5.37141,d2:3,d3:4.84018,temperature:1 }
  },
  {
    label: '德#5 均衡派', version: 'training_v2', generation: 19, index: 2, side: 'german', winRate: 0.26, style: '均衡派',
    weights: { w1:3,w2:2.82902,w3:0.1,w4:4.17305,w5:1.73141,w6:2.52543,w7:1.86504,w8:1,w9:3.26323,w10:3.13349,w11:0.1,w12:0.888028,w13:2.2087,w14:1,w15:2,s1:10.4744,s2:0.1,s3:0.1,h1:9.96313,h2:5.29048,h3:3.28406,d1:5.37141,d2:3,d3:5.01272,temperature:1 }
  },
]

export const BRITISH_PRESETS: PresetInfo[] = [
  {
    label: '英#1 均衡派', version: 'training_v2', generation: 19, index: 6, side: 'british', winRate: 0.90, style: '均衡派',
    weights: { w1:0.99126,w2:1.5065,w3:1.68643,w4:0.309636,w5:3.5327,w6:4.09477,w7:2.14038,w8:1.83969,w9:3.57685,w10:4.07734,w11:2.80333,w12:0.945536,w13:0.540855,w14:0.507227,w15:0.1,s1:10,s2:0.1,s3:2.22049,h1:10.9762,h2:6.75507,h3:2.19612,d1:5.1606,d2:4.79299,d3:3.83719,temperature:0.803092 }
  },
  {
    label: '英#2 均衡派', version: 'training_v2', generation: 19, index: 1, side: 'british', winRate: 0.88, style: '均衡派',
    weights: { w1:0.99126,w2:1.5065,w3:1.04377,w4:1.37945,w5:5.27284,w6:4.09477,w7:2.14038,w8:1.86585,w9:5.74475,w10:4.07734,w11:1.88156,w12:0.1,w13:1.36098,w14:0.36169,w15:0.800276,s1:10.4861,s2:0.1,s3:1.64865,h1:9.67726,h2:6.76051,h3:2.64317,d1:4.82369,d2:5.76493,d3:4.24195,temperature:0.803092 }
  },
  {
    label: '英#3 均衡派', version: 'training_v2', generation: 19, index: 8, side: 'british', winRate: 0.88, style: '均衡派',
    weights: { w1:0.99126,w2:1.5065,w3:1.68643,w4:0.321574,w5:3.5327,w6:4.09477,w7:1.16899,w8:2.29508,w9:4.60915,w10:3.07817,w11:1.86392,w12:0.945536,w13:0.540855,w14:0.507227,w15:0.1,s1:9.19176,s2:0.1,s3:3.38182,h1:10.9762,h2:7.01795,h3:2.19612,d1:5.1606,d2:5.82753,d3:3.83719,temperature:1.41574 }
  },
  {
    label: '英#4 均衡派', version: 'training_v2', generation: 19, index: 9, side: 'british', winRate: 0.86, style: '均衡派',
    weights: { w1:0.99126,w2:1.5065,w3:1.68643,w4:0.1,w5:3.5327,w6:4.57241,w7:2.14038,w8:2.29508,w9:4.60915,w10:4.07734,w11:2.80333,w12:0.945536,w13:0.1,w14:0.507227,w15:0.1,s1:9.9318,s2:0.1,s3:2.22049,h1:10.7217,h2:7.66374,h3:2.19612,d1:5.1606,d2:6.34,d3:3.83719,temperature:0.803092 }
  },
  {
    label: '英#5 均衡派', version: 'training_v1', generation: 19, index: 1, side: 'british', winRate: 0.84, style: '均衡派',
    weights: { w1:1.99355,w2:1.51453,w3:0.384976,w4:3.8295,w5:2.68631,w6:1.49898,w7:3.9065,w8:0.859949,w9:6.19015,w10:1.3025,w11:1.67016,w12:2.72209,w13:3.50826,w14:0.821839,w15:2.14585,s1:10.3472,s2:0.112073,s3:0.894285,h1:9.71913,h2:4.19794,h3:5.2253,d1:5.01394,d2:5.05727,d3:2.10349,temperature:3.531 }
  },
]

// V8 最佳个体 (训练产出, 嵌入避免 fs 依赖)
export const V8_GERMAN_BEST: Weights = { w1:8,w2:0.228,w3:0.977,w4:2.834,w5:3,w6:2.662,w7:2,w8:2.445,w9:4,w10:2.692,w11:2,w12:0.2,w13:2,w14:1,w15:2, s1:9.503,s2:1.547,s3:1.533, h1:10.246,h2:6.399,h3:3, d1:5,d2:4.747,d3:5.549, p1:3,p2:1.716,p3:2.312, rushF7Pull:0.2,rushPathPull:1,farmBasePull:2,farmVPScale:0.2,huntPull:3,hidePush:8,rushVPPenalty:1.327,rushVPReward:3, britDiffuseStr:0.25,britPatrolPull:3,britDefendPull:6,britHuntCenter:6,britSearchRepel:2, temperature:0.2 }
export const V8_BRITISH_BEST: Weights = { w1:6.567,w2:2.715,w3:1.414,w4:4.208,w5:4.898,w6:3.715,w7:3.376,w8:2.910,w9:3.701,w10:2.724,w11:1.738,w12:1.333,w13:1.152,w14:1,w15:3.526, s1:10.403,s2:0.408,s3:3.029, h1:12.251,h2:5.409,h3:2.281, d1:5.388,d2:0.2,d3:1.257, p1:0.989,p2:2.117,p3:6.161, rushF7Pull:2.092,rushPathPull:1.965,farmBasePull:3.793,farmVPScale:0.358,huntPull:3.758,hidePush:8.982,rushVPPenalty:7.253,rushVPReward:6.622, britDiffuseStr:0.25,britPatrolPull:3,britDefendPull:6,britHuntCenter:6,britSearchRepel:2, temperature:0.2 }

// V11 最佳个体 (修正引擎训练, 德军vs英军47%/83%)
export const V11_GERMAN_BEST: Weights = { w1:8.04735,w2:3.07,w3:2,w4:4,w5:2.8305,w6:4,w7:2,w8:2.13044,w9:4.17702,w10:2,w11:2.33376,w12:1,w13:2,w14:1.31943,w15:1.51764, s1:10,s2:0.972907,s3:1, h1:10.2651,h2:5,h3:2.91992, d1:4.81105,d2:3,d3:4, p1:3,p2:2,p3:1.66836, rushF7Pull:-10,rushPathPull:1,farmBasePull:2,farmVPScale:0.5,huntPull:3.13809,hidePush:8,rushVPPenalty:3.65023,rushVPReward:3, britDiffuseStr:0.530452,britPatrolPull:3,britDefendPull:5.99404,britHuntCenter:6.09259,britSearchRepel:2.3681, temperature:1 }
export const V11_BRITISH_BEST: Weights = { w1:9.41201,w2:0.392016,w3:1.09188,w4:4.48387,w5:3.96454,w6:6.0023,w7:3.20005,w8:4.40677,w9:5.48735,w10:1.93869,w11:0.451817,w12:1.38819,w13:1.97128,w14:0.45494,w15:4.00254, s1:7.37706,s2:0.2,s3:1.44999, h1:8.16728,h2:5.09438,h3:2.94916, d1:4.76407,d2:2.84638,d3:3.09996, p1:5.44017,p2:5.11854,p3:2.04929, rushF7Pull:0.2,rushPathPull:2.28412,farmBasePull:1.22567,farmVPScale:4.29396,huntPull:3.08288,hidePush:8.76752,rushVPPenalty:2.9022,rushVPReward:1.85178, britDiffuseStr:1.41022,britPatrolPull:2.53782,britDefendPull:3.37668,britHuntCenter:7.4293,britSearchRepel:3.46623, temperature:1.84452 }

/** 根据版本和索引查找权重，不限于预设 */
export function findPresetWeights(version: string, index: number): Weights | undefined {
  for (const p of [...GERMAN_PRESETS, ...BRITISH_PRESETS]) {
    if (p.version === version && p.index === index) return p.weights
  }
  return undefined
}
