#!/usr/bin/env python3
"""V3 演化可视化 —— 动画 + 静态图 + 游戏回放帧"""
import json, sys, os, struct, numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

for f in ['PingFang SC', 'Heiti SC', 'STHeiti', 'Arial Unicode MS', 'sans-serif']:
    try: fm.findfont(f, fallback_to_default=False); plt.rcParams['font.sans-serif'] = [f]; break
    except: pass
plt.rcParams['axes.unicode_minus'] = False
from matplotlib.animation import FuncAnimation, FFMpegWriter
from collections import defaultdict

TOUR_DIR = sys.argv[1] if len(sys.argv) > 1 else 'deeplearn/data/training_v3'
OUT_DIR = os.path.join(TOUR_DIR, 'viz')
FRAME_DIR = os.path.join(OUT_DIR, 'video_frames')
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(FRAME_DIR, exist_ok=True)

COL = ['A','B','C','D','E','F']
LAND = {'E6', 'D7'}

# ========== 加载 ==========
summ = json.load(open(os.path.join(TOUR_DIR, 'summary.json')))
ger_hist = summ['gerWinHistory']; brit_hist = summ['britWinHistory']
div_hist = summ.get('diversityHistory', [0.5]*len(ger_hist))
strat_hist = summ.get('strategyHistory', [])
gens = range(1, len(ger_hist) + 1); n_gen = len(gens)

# 每代 stats
all_stats = []
for g in range(n_gen):
    sf = os.path.join(TOUR_DIR, f'gen_{g:03d}', 'stats.json')
    if os.path.exists(sf): all_stats.append(json.load(open(sf)))
    else: all_stats.append({})

# 每代个体统计
all_indiv = []
for g in range(n_gen):
    f = os.path.join(TOUR_DIR, f'gen_{g:03d}', 'individual_stats.json')
    if os.path.exists(f): all_indiv.append(json.load(open(f)))
    else: all_indiv.append([])

# 每代 top 权重
all_top = []
for g in range(n_gen):
    f = os.path.join(TOUR_DIR, f'gen_{g:03d}', 'top_weights.json')
    if os.path.exists(f): all_top.append(json.load(open(f)))
    else: all_top.append({})

# ========== 1. 胜率动画 (MP4) ==========
print("生成胜率动画...")
fig, ax = plt.subplots(figsize=(10, 6))

def update_winrate(frame):
    ax.clear()
    x = list(gens)[:frame+1]
    ax.set_xlim(0, n_gen+1); ax.set_ylim(0, 1)
    ax.axhline(y=0.5, color='gray', linestyle='--', alpha=0.3)
    ax.plot(x, ger_hist[:frame+1], 'r-', linewidth=2.5, label='德军')
    ax.plot(x, brit_hist[:frame+1], 'b-', linewidth=2.5, label='英军')
    if frame > 0: ax.fill_between(x, ger_hist[:frame+1], brit_hist[:frame+1], alpha=0.08, color='purple')
    ax.set_xlabel('代'); ax.set_ylabel('胜率')
    ax.set_title(f'双种群共演化 — 胜率曲线 (代 {frame+1}/{n_gen})')
    ax.legend(loc='lower right')

anim = FuncAnimation(fig, update_winrate, frames=n_gen, interval=350, blit=False)
anim.save(os.path.join(OUT_DIR, 'winrate.mp4'), writer=FFMpegWriter(fps=5, bitrate=2000))
plt.close()
print(f"  -> {OUT_DIR}/winrate.mp4")

# ========== 2. 策略堆叠动画 ==========
print("生成策略分布动画...")
if strat_hist:
    rush=[s['rush'] for s in strat_hist]; farm=[s['farm'] for s in strat_hist]
    hunt=[s['hunt'] for s in strat_hist]; hide=[s['hide'] for s in strat_hist]
    fig, ax = plt.subplots(figsize=(10, 6))
    colors = ['#e74c3c', '#2ecc71', '#f39c12', '#3498db']
    labels = ['RushBrest', 'FarmRoutes', 'HuntShips', 'HideDeep']
    def update_strat(frame):
        ax.clear()
        ax.set_xlim(0, n_gen+1); ax.set_ylim(0, 1)
        x = list(gens)[:frame+1]
        ax.stackplot(x, np.vstack([rush[:frame+1], farm[:frame+1], hunt[:frame+1], hide[:frame+1]]),
                     labels=labels, colors=colors, alpha=0.8)
        ax.set_xlabel('代'); ax.set_ylabel('策略占比')
        ax.set_title(f'德军策略分布演化 (代 {frame+1}/{n_gen})')
        ax.legend(loc='center right')
    anim = FuncAnimation(fig, update_strat, frames=n_gen, interval=350, blit=False)
    anim.save(os.path.join(OUT_DIR, 'strategy_stack.mp4'), writer=FFMpegWriter(fps=5, bitrate=2000))
    plt.close()
    print(f"  -> {OUT_DIR}/strategy_stack.mp4")

# ========== 3. MAP-Elites 网格动画 ==========
print("生成 MAP-Elites 网格动画...")
def has_grid_data(): return any(s.get('grid_cells') for s in all_stats)
if has_grid_data():
    fig, ax = plt.subplots(figsize=(7, 6))
    def update_grid(frame):
        ax.clear()
        cells = all_stats[frame].get('grid_cells', [])
        G = 5; grid_data = np.full((G, G), np.nan)
        for c in cells:
            if c.get('occ'): grid_data[c['r'], c['c']] = c.get('wr', 0)
        im = ax.imshow(grid_data, cmap='RdYlGn', origin='upper', vmin=0, vmax=1)
        for r in range(G):
            for c in range(G):
                v = grid_data[r, c]
                ax.text(c, r, f'{v*100:.0f}%' if not np.isnan(v) else '空',
                       ha='center', va='center', fontsize=8, color='black' if not np.isnan(v) else 'gray')
        ax.set_xticks(range(G)); ax.set_xticklabels([f'{i*25}%' for i in range(G)])
        ax.set_yticks(range(G)); ax.set_yticklabels([f'{i*25}%' for i in range(G)])
        ax.set_xlabel('Farm%'); ax.set_ylabel('Rush%')
        ax.set_title(f'MAP-Elites 5x5 网格 (代 {frame+1}/{n_gen})')
        filled = sum(1 for c in cells if c.get('occ'))
        ax.text(0.02, 0.98, f'已占据: {filled}/25', transform=ax.transAxes, fontsize=10, va='top')
    anim = FuncAnimation(fig, update_grid, frames=n_gen, interval=400, blit=False)
    anim.save(os.path.join(OUT_DIR, 'map_elites_grid.mp4'), writer=FFMpegWriter(fps=5, bitrate=2000))
    plt.close()
    print(f"  -> {OUT_DIR}/map_elites_grid.mp4")

# ========== 4. KL vs WR 散点图 ==========
print("生成 KL vs WR 散点图...")
fig, ax = plt.subplots(figsize=(10, 6))
colors = plt.cm.viridis(np.linspace(0.1, 0.9, n_gen))
for gi, indivs in enumerate(all_indiv):
    if not indivs: continue
    wrs = [i['wr'] for i in indivs]; kls = [i.get('kl', 0) for i in indivs]
    ax.scatter(kls, wrs, c=[colors[gi]], alpha=0.6, s=30, label=f'代{gi+1}' if gi%5==0 else '')
ax.set_xlabel('KL 散度 (与同代其他个体平均)'); ax.set_ylabel('胜率')
ax.set_title('多样性 vs 质量 — 每代20个体的 KL-WR 散点')
ax.legend(loc='lower left', fontsize=8, ncol=2)
ax.grid(alpha=0.3)
plt.tight_layout(); plt.savefig(os.path.join(OUT_DIR, 'kl_vs_wr.png'), dpi=150); plt.close()
print(f"  -> {OUT_DIR}/kl_vs_wr.png")

# ========== 5. 权重轨迹图 ==========
print("生成权重轨迹图...")
fig, axes = plt.subplots(2, 3, figsize=(16, 9))
axes = axes.flatten()
key_ws = [('w1', 'Rush冲港'), ('w5', 'Farm打工'), ('w12', 'Hide躲藏'),
          ('s1', 'Search搜索'), ('h1', 'Hunt猎杀'), ('d1', 'Defend防守')]
for i, (wk, title) in enumerate(key_ws):
    ax = axes[i]
    for rank in range(3):
        vals = []
        for gi in range(n_gen):
            top = all_top[gi]
            ger_top = top.get('top_ger', [])
            if rank < len(ger_top):
                vals.append(ger_top[rank]['weights'].get(wk, 0))
            else: vals.append(None)
        valid_x = [g+1 for g, v in enumerate(vals) if v is not None]
        valid_y = [v for v in vals if v is not None]
        if valid_x:
            ax.plot(valid_x, valid_y, '-o', markersize=2, linewidth=1.5, label=f'#{rank+1}')
    ax.set_title(title, fontsize=11)
    ax.set_xlabel('代'); ax.grid(alpha=0.3)
    if i == 0: ax.legend(fontsize=7)
plt.suptitle('Top-3 德军权重演化轨迹', fontsize=14)
plt.tight_layout()
plt.savefig(os.path.join(OUT_DIR, 'weights_trajectory.png'), dpi=150); plt.close()
print(f"  -> {OUT_DIR}/weights_trajectory.png")

# ========== 6. 游戏回放热力图帧 ==========
print("生成游戏回放帧...")
def read_tensor(path):
    with open(path,'rb') as f:
        magic = struct.unpack('<I',f.read(4))[0]
        dims = struct.unpack('<4i',f.read(16))
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)

# 找 elite 游戏
elite_games = []
for g in range(min(5, n_gen)):  # 前5代
    elite_dir = os.path.join(TOUR_DIR, f'gen_{g:03d}', 'elite')
    if os.path.exists(elite_dir):
        for d in sorted(os.listdir(elite_dir))[:3]:  # 每代3局
            elite_games.append((g, os.path.join(elite_dir, d)))
# 最后一两代
if n_gen > 5:
    for g in [n_gen//2, n_gen-1]:
        elite_dir = os.path.join(TOUR_DIR, f'gen_{g:03d}', 'elite')
        if os.path.exists(elite_dir):
            for d in sorted(os.listdir(elite_dir))[:3]:
                elite_games.append((g, os.path.join(elite_dir, d)))

replay_count = 0
for gen_idx, game_dir in elite_games:
    sf = os.path.join(game_dir, 'state.bin')
    if not os.path.exists(sf): continue
    state = read_tensor(sf)
    n_steps = state.shape[0]
    # 每5步取一帧
    for t in range(0, min(n_steps, 60), 3):
        sl = state[t]
        if np.max(sl) < 0.01 and t > 10: break
        fig, ax = plt.subplots(figsize=(10, 8))
        # 叠加多个channel做热力图: ch48=bismarck, ch40=german ships, ch64=british ships
        grid = sl[48] * 4 + sl[40] * 2 + sl[64] * 3 + sl[66] * 1
        # 标记陆地
        for hex_lbl in LAND:
            col = ord(hex_lbl[0]) - 65; row = int(hex_lbl[1:]) - 1
            if 0 <= row < 8 and 0 <= col < 6: grid[row, col] = -1
        masked = np.ma.masked_where(grid < 0, grid)
        im = ax.imshow(masked, cmap='YlOrRd', origin='upper', vmin=0, vmax=8)
        for r in range(8):
            for c in range(6):
                if grid[r, c] < 0: ax.text(c, r, '陆', ha='center', va='center', fontsize=8, color='gray')
        ax.set_xticks(range(6)); ax.set_xticklabels(COL)
        ax.set_yticks(range(8)); ax.set_yticklabels(range(1, 9))
        ax.set_title(f'Gen{gen_idx+1} Step{t}')
        plt.tight_layout()
        fname = f'replay_g{gen_idx:02d}_s{t:02d}.png'
        plt.savefig(os.path.join(FRAME_DIR, fname), dpi=100)
        plt.close()
        replay_count += 1
        if replay_count > 200: break
    if replay_count > 200: break
print(f"  -> {replay_count} 帧 -> {FRAME_DIR}/")

# ========== 7. 每代仪表盘 ==========
print("生成每代仪表盘...")
for gi in range(0, n_gen, max(1, n_gen//8)):
    s = all_stats[gi]
    if not s: continue
    fig, axes = plt.subplots(2, 2, figsize=(12, 10))
    # 胜率条
    ax = axes[0,0]; ax.bar(['德军', '英军'], [s.get('avgGer',0)*100, s.get('avgBrit',0)*100], color=['#e74c3c','#3498db'])
    ax.set_ylabel('胜率 %'); ax.set_title(f'代 {gi+1} 胜率'); ax.set_ylim(0, 100); ax.axhline(50, color='gray', ls='--')
    # 策略饼图
    ax = axes[0,1]; sd = s.get('strategy_dist',{})
    if sd:
        ax.pie([sd.get('rush',0), sd.get('farm',0), sd.get('hunt',0), sd.get('hide',0)],
               labels=['Rush','Farm','Hunt','Hide'], colors=['#e74c3c','#2ecc71','#f39c12','#3498db'], autopct='%.0f%%')
        ax.set_title('德军策略分布')
    # MAP-Elites
    ax = axes[1,0]; cells = s.get('grid_cells',[])
    if cells:
        G=5; gd=np.full((G,G),np.nan)
        for c in cells:
            if c.get('occ'): gd[c['r'],c['c']]=c.get('wr',0)
        im=ax.imshow(gd,cmap='RdYlGn',vmin=0,vmax=1)
        for r in range(G):
            for c in range(G):
                v=gd[r,c]; ax.text(c,r,f'{v*100:.0f}%' if not np.isnan(v) else '空', ha='center',va='center',fontsize=7)
        ax.set_title('MAP-Elites 网格')
        plt.colorbar(im, ax=ax)
    # 关键数字
    ax = axes[1,1]; ax.axis('off')
    metrics = [
        f"最佳德军: {s.get('best_ger_wr',0)*100:.0f}% (#{s.get('best_ger','?')})",
        f"最佳英军: {s.get('best_brit_wr',0)*100:.0f}% (#{s.get('best_brit','?')})",
        f"平均回合: {s.get('avg_turns',0):.1f}",
        f"焦灼局率: {s.get('close_pct',0)*100:.0f}%",
        f"多样性KL: {s.get('diversity_kl',0):.2f}",
        f"耗时: {s.get('elapsed_s',0)}s"
    ]
    for i,m in enumerate(metrics): ax.text(0.1, 0.9-i*0.15, m, transform=ax.transAxes, fontsize=11)
    plt.suptitle(f'V3 训练仪表盘 — 代 {gi+1}/{n_gen}', fontsize=14)
    plt.tight_layout()
    plt.savefig(os.path.join(FRAME_DIR, f'dashboard_g{gi:02d}.png'), dpi=120)
    plt.close()
print(f"  -> {FRAME_DIR}/dashboard_*.png")

# ========== 汇总 ==========
print(f"\n✅ 全部可视化保存到 {OUT_DIR}/")
for f in sorted(os.listdir(OUT_DIR)):
    path = os.path.join(OUT_DIR, f)
    size = os.path.getsize(path) if os.path.isfile(path) else sum(os.path.getsize(os.path.join(dp,fn)) for dp,_,fns in os.walk(path) for fn in fns)
    print(f"   {f} ({size/1024:.0f} KB)" if size<1024*1024 else f"   {f} ({size/1024/1024:.1f} MB)")
