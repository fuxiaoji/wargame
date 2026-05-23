#!/usr/bin/env python3
"""演化可视化 —— 从 tournament/ 生成胜率曲线/策略分布/热力图"""

import json, sys, os, struct, numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation, FFMpegWriter
from collections import defaultdict

COL = ['A','B','C','D','E','F']
TOUR_DIR = sys.argv[1] if len(sys.argv) > 1 else 'tournament'
OUT_DIR = os.path.join(TOUR_DIR, 'viz')
os.makedirs(OUT_DIR, exist_ok=True)

# ========== 加载数据 ==========
summ = json.load(open(os.path.join(TOUR_DIR, 'summary.json')))
ger_hist = summ['gerWinHistory']
brit_hist = summ['britWinHistory']
div_hist = summ['diversityHistory']
strat_hist = summ['strategyHistory']
gens = range(1, len(ger_hist) + 1)

# ========== 1. 胜率曲线 ==========
print("绘制胜率曲线...")
fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(gens, ger_hist, 'r-', label='德军胜率', linewidth=2)
ax.plot(gens, brit_hist, 'b-', label='英军胜率', linewidth=2)
ax.axhline(y=0.5, color='gray', linestyle='--', alpha=0.5)
ax.fill_between(gens, ger_hist, brit_hist, alpha=0.1, color='purple')
ax.set_xlabel('代数', fontsize=12)
ax.set_ylabel('胜率', fontsize=12)
ax.set_title('双种群共演化 — 胜率曲线', fontsize=14)
ax.legend(fontsize=11)
ax.set_ylim(0, 1)
ax.grid(alpha=0.3)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, 'winrate.png'), dpi=150)
plt.close()

# ========== 2. 多样性曲线 ==========
print("绘制多样性曲线...")
fig, ax = plt.subplots(figsize=(10, 4))
ax.plot(gens, div_hist, 'g-', linewidth=2, marker='o', markersize=3)
ax.set_xlabel('代数', fontsize=12)
ax.set_ylabel('多样性指数', fontsize=12)
ax.set_title('策略多样性 (1=完全多样, 0=收敛单一)', fontsize=14)
ax.set_ylim(0, 1.1)
ax.grid(alpha=0.3)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, 'diversity.png'), dpi=150)
plt.close()

# ========== 3. 策略分布面积图 ==========
print("绘制策略分布...")
fig, ax = plt.subplots(figsize=(10, 5))
rush = [s['rush'] for s in strat_hist]
farm = [s['farm'] for s in strat_hist]
hunt = [s['hunt'] for s in strat_hist]
hide = [s['hide'] for s in strat_hist]
ax.stackplot(gens, rush, farm, hunt, hide,
    labels=['RushBrest', 'FarmRoutes', 'HuntShips', 'HideDeep'],
    colors=['#e74c3c', '#2ecc71', '#f39c12', '#3498db'], alpha=0.8)
ax.set_xlabel('代数', fontsize=12)
ax.set_ylabel('策略占比', fontsize=12)
ax.set_title('德军策略分布演化', fontsize=14)
ax.legend(loc='center right', fontsize=10)
ax.set_ylim(0, 1)
ax.grid(alpha=0.3)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, 'strategy.png'), dpi=150)
plt.close()

# ========== 4. 权重平行坐标图 ==========
print("绘制权重演化...")
ger_pops = []
for g in range(len(gens)):
    gen_dir = os.path.join(TOUR_DIR, f'gen_{g:03d}')
    pop_file = os.path.join(gen_dir, 'ger_population.json')
    if os.path.exists(pop_file):
        ger_pops.append(json.load(open(pop_file)))

if ger_pops:
    key_weights = ['w1','w2','w4','w5','w6','w12','w13','temperature']
    n_gen = len(ger_pops)
    n_w = len(key_weights)

    fig, axes = plt.subplots(2, 4, figsize=(16, 8))
    axes = axes.flatten()
    for i, kw in enumerate(key_weights):
        if i >= len(axes): break
        ax = axes[i]
        for g_idx in [0, n_gen//4, n_gen//2, -1]:  # gen 1, 25%, 50%, last
            vals = [p[kw] for p in ger_pops[g_idx]]
            ax.scatter([g_idx]*len(vals), vals, alpha=0.5, s=10)
        ax.set_title(kw, fontsize=12)
        ax.set_xlabel('代')
    plt.suptitle('德军关键权重演化', fontsize=14)
    plt.tight_layout()
    plt.savefig(os.path.join(OUT_DIR, 'weights.png'), dpi=150)
    plt.close()

# ========== 5. 热力图 GIF (每 5 代一帧) ==========
print("生成热力图 GIF...")
def read_tensor(path):
    with open(path,'rb') as f:
        magic = struct.unpack('<I',f.read(4))[0]
        dims = struct.unpack('<4i',f.read(16))
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)

def draw_heatmap_frame(ax, state, heatmap_data, turn, gen):
    H, W = 8, 6
    grid = np.zeros((H, W))
    for r in range(H):
        for c in range(W):
            grid[r, c] = heatmap_data[r][c] if hasattr(heatmap_data, '__getitem__') else 0
    ax.clear()
    ax.imshow(grid, cmap='RdYlBu_r', origin='upper', vmin=-5, vmax=10)
    # 标注 F7
    ax.text(5, 6, 'F7', ha='center', va='center', fontsize=8, color='black', fontweight='bold')
    # 标注德军营
    for r in range(H):
        for c in range(W):
            if state[48, r, c] > 0.5:
                ax.text(c, r, 'B', ha='center', va='center', fontsize=10, color='white', fontweight='bold')
    ax.set_title(f'Gen {gen+1} Step {turn}', fontsize=10)
    ax.set_xticks(range(W)); ax.set_xticklabels(COL)
    ax.set_yticks(range(H)); ax.set_yticklabels(range(1, H+1))

# 尝试读取第一代样本游戏
sample_dir = os.path.join(TOUR_DIR, 'gen_000', 'sample_games')
if not os.path.exists(sample_dir):
    print("  (无样本游戏，跳过 GIF)")
else:
    game_dirs = [d for d in os.listdir(sample_dir) if os.path.isdir(os.path.join(sample_dir, d))]
    if game_dirs:
        game_dir = os.path.join(sample_dir, game_dirs[0])
        state_file = os.path.join(game_dir, 'state.bin')
        if os.path.exists(state_file):
            state = read_tensor(state_file)
            fig, ax = plt.subplots(figsize=(6, 6))
            frames = []
            step = 0
            for t in range(0, min(state.shape[0], 20), 2):
                sl = state[t]
                if sl.max() < 0.01: continue  # skip empty
                grid = np.zeros((8, 6))
                for r in range(8):
                    for c in range(6):
                        val = sl[48, r, c] * 5 + sl[40, r, c] * 2 + sl[66, r, c] * 1
                        grid[r, c] = val
                ax.clear()
                im = ax.imshow(grid, cmap='hot', origin='upper', vmin=0, vmax=5)
                ax.set_title(f'Step {t}', fontsize=10)
                ax.set_xticks(range(6)); ax.set_xticklabels(COL)
                ax.set_yticks(range(8)); ax.set_yticklabels(range(1, 9))
                step += 1
            plt.tight_layout()
            plt.savefig(os.path.join(OUT_DIR, 'heatmap_sample.png'), dpi=150)
            plt.close()
            print("  热力图样本已保存")

# ========== 输出汇总 ==========
print(f"\n✅ 全部图表已保存到 {OUT_DIR}/")
print(f"   winrate.png   — 胜率曲线")
print(f"   diversity.png — 多样性曲线")
print(f"   strategy.png  — 策略分布面积图")
if ger_pops: print(f"   weights.png   — 权重演化")
if os.path.exists(os.path.join(OUT_DIR, 'heatmap_sample.png')):
    print(f"   heatmap_sample.png — 热力图样本")
