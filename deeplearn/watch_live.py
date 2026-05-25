"""实时训练可视化 — 读取 live.json 并刷新图表"""
import json, time, sys, os
import matplotlib.pyplot as plt
import matplotlib.animation as animation

LIVE_PATH = sys.argv[1] if len(sys.argv) > 1 else "data/training_v5_win/live.json"


def load():
    try:
        with open(LIVE_PATH) as f:
            return json.load(f)
    except:
        return None


def main():
    plt.rcParams['font.sans-serif'] = ['SimHei', 'DejaVu Sans']
    plt.rcParams['axes.unicode_minus'] = False

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.canvas.manager.set_window_title('Training Monitor')

    def update(_):
        data = load()
        if not data:
            return

        gen = data.get("gen", 0)
        max_gen = data.get("max_gen", 1)

        for ax in axes.flat:
            ax.clear()

        # 1. 胜率曲线
        ax = axes[0, 0]
        g = data.get("ger_history", [])
        b = data.get("brit_history", [])
        xs = range(1, len(g) + 1)
        ax.plot(xs, [v * 100 for v in g], 'b-o', label='德军胜率', markersize=4)
        ax.plot(xs, [v * 100 for v in b], 'r-o', label='英军胜率', markersize=4)
        ax.axhline(y=50, color='gray', linestyle='--', alpha=0.5)
        ax.set_title(f'胜率曲线 (代 {gen}/{max_gen})')
        ax.set_ylabel('胜率 %')
        ax.legend()
        ax.grid(True, alpha=0.3)

        # 2. 策略分布
        ax = axes[0, 1]
        strat = data.get("strategy_history", [])
        if strat:
            sx = range(1, len(strat) + 1)
            rush = [s.get("rush", 0) * 100 for s in strat]
            farm = [s.get("farm", 0) * 100 for s in strat]
            hunt = [s.get("hunt", 0) * 100 for s in strat]
            hide = [s.get("hide", 0) * 100 for s in strat]
            ax.stackplot(sx, rush, farm, hunt, hide,
                         labels=['Rush', 'Farm', 'Hunt', 'Hide'],
                         colors=['#e74c3c', '#2ecc71', '#3498db', '#9b59b6'],
                         alpha=0.8)
            ax.set_title('德军策略分布')
            ax.set_ylabel('占比')
            ax.legend(loc='upper right')
            ax.set_ylim(0, 100)

        # 3. 多样性 (KL)
        ax = axes[1, 0]
        div = data.get("diversity_history", [])
        if div:
            ax.fill_between(range(1, len(div) + 1), div, alpha=0.3, color='green')
            ax.plot(range(1, len(div) + 1), div, 'g-o', markersize=4)
            ax.set_title('种群多样性 (KL散度)')
            ax.set_ylabel('KL')
            ax.grid(True, alpha=0.3)

        # 4. 进度条 + 信息
        ax = axes[1, 1]
        ax.axis('off')
        elapsed = data.get("total_elapsed_s", 0)
        h, m = elapsed // 3600, (elapsed % 3600) // 60
        s = elapsed % 60
        eta_str = f"{h}h{m}m{s}s" if h else f"{m}m{s}s"
        pct = gen / max_gen * 100
        bar_w = 30
        filled = int(pct * bar_w / 100)
        bar = '[' + '=' * filled + '>' + ' ' * (bar_w - filled - 1) + ']'

        info_lines = [
            f"{bar} {pct:.0f}%",
            f"",
            f"代: {gen}/{max_gen}",
            f"耗时: {eta_str}",
            f"",
            f"德军胜率: {data.get('avg_ger', 0)*100:.1f}%",
            f"英军胜率: {data.get('avg_brit', 0)*100:.1f}%",
            f"最佳德军: {data.get('best_ger_wr', 0)*100:.1f}%",
            f"最佳英军: {data.get('best_brit_wr', 0)*100:.1f}%",
            f"多样性 KL: {data.get('diversity_kl', 0):.4f}",
        ]
        for i, line in enumerate(info_lines):
            ax.text(0.5, 0.95 - i * 0.09, line, transform=ax.transAxes,
                    fontsize=12, fontfamily='monospace', va='top', ha='center')

        fig.suptitle(f'Bismarck 进化训练 — 实时监控', fontsize=14, fontweight='bold')
        fig.tight_layout()

    ani = animation.FuncAnimation(fig, update, interval=3000, cache_frame_data=False)
    plt.show()


if __name__ == '__main__':
    main()
