#!/usr/bin/env python3
"""全局日志生成器 —— 从 state.bin 还原每一步的双视角（德军看到 vs 英军看到 + 全局真相）"""
import struct, json, sys, numpy as np

COL = ['A','B','C','D','E','F']
PHASE = {0:'德布置',1:'英布置',2:'德移动',3:'英移动',4:'索敌',5:'战斗',6:'运输',7:'结束'}

def read_tensor(path):
    with open(path,'rb') as f:
        magic = struct.unpack('<I',f.read(4))[0]
        dims = struct.unpack('<4i',f.read(16))
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)

def pos_of(ch, sl):
    """返回通道 ch 中值>0.5 的所有格子"""
    pts = []
    for r in range(8):
        for c in range(6):
            if sl[ch,r,c] > 0.5: pts.append(f"{COL[c]}{r+1}")
    return pts

def ship_info(base_ch, sl):
    """读取 4 通道船信息 [位置, HP, 攻, 锁定]"""
    pts = pos_of(base_ch, sl)
    if not pts: return None
    hp = sl[base_ch+1].max()
    atk = sl[base_ch+2].max()
    locked = sl[base_ch+3].max()
    return f"{pts[0]}[hp:{hp:.1f} atk:{atk:.1f}{'锁' if locked>0.5 else ''}]"

def translate(game_dir, out=None):
    state = read_tensor(f"{game_dir}/state.bin")
    with open(f"{game_dir}/result.json") as f:
        result = json.load(f)

    T, C, H, W = state.shape
    lines = []
    p = lambda s='': lines.append(s)

    p(f"===== 全局双视角日志: {result.get('game_id','?')} =====")
    p(f"胜者: {result['winner']} | 回合: {result['turns']}/18 | 德VP:{result['vp_german']} 英VP:{result['vp_british']}")
    p()

    for t in range(T):
        sl = state[t]
        turn = max(1, int(sl[8,0,0] * 18 + 0.5))
        ph = 7
        for i in range(4,8):
            if sl[i,0,0] > 0.5: ph = i; break
        vp_g = int(sl[10,0,0] * 6 + 0.5)
        vp_b = int(sl[9,0,0] * 6 + 0.5)

        # 跳过空步
        bpos = pos_of(48, sl)
        brit_any = pos_of(40, sl)
        if not bpos and not brit_any and ph >= 7: continue

        p(f"━━━ 步{t} | T{turn} {PHASE.get(ph,'?')} | 德{vp_g}VP/英{vp_b}VP ━━━")

        # === 全局真相 ===
        p(f"[全局真相]")
        ger_ships = []
        for name, ch in [('俾斯麦',48), ('欧根',52)]:
            pts = pos_of(ch, sl)
            if pts:
                hp = sl[ch+1, np.where(sl[ch]>0.5)[0][0], np.where(sl[ch]>0.5)[1][0]]
                spd = sl[ch+3, np.where(sl[ch]>0.5)[0][0], np.where(sl[ch]>0.5)[1][0]]
                ger_ships.append(f"{name}@{pts[0]}[hp:{hp:.0f} spd:{spd:.0f}]")
        p(f"  德军: {', '.join(ger_ships) if ger_ships else '无'}")

        brit_ships = []
        for name, ch in [('胡德',16),('威尔士',20),('方舟',24)]:
            pts = pos_of(ch, sl)
            if pts: brit_ships.append(f"{name}@{pts[0]}")
        # 2Step聚合
        for r in range(8):
            for c in range(6):
                if sl[28,r,c] > 0.5: brit_ships.append(f"2步舰@{COL[c]}{r+1}")
                if sl[32,r,c] > 0.5: brit_ships.append(f"1步舰@{COL[c]}{r+1}")
        dummy_pts = pos_of(36, sl)
        for dp in dummy_pts: brit_ships.append(f"伪装@{dp}")
        p(f"  英军: {', '.join(brit_ships[:12]) if brit_ships else '无'}")

        # 事件
        events = []
        for r in range(8):
            for c in range(6):
                lb = f"{COL[c]}{r+1}"
                if sl[64,r,c] > 0.5: events.append(f"索敌暴露@{lb}")
                if sl[65,r,c] > 0.5: events.append(f"航空暴露@{lb}")
                if sl[66,r,c] > 0.5: events.append(f"信号泄露@{lb}")
        if events: p(f"  事件: {', '.join(events)}")

        # === 德军视角 ===
        p(f"[德军看到]")
        # 德军看到自己的船
        p(f"  己方: {', '.join(ger_ships) if ger_ships else '无'}")
        # 德军看到英军都是"背面算子"
        brit_anon = pos_of(40, sl)  # Ch40 是所有英军匿名位置
        p(f"  英军: {len(brit_anon)}个背面算子 @ {', '.join(brit_anon[:10])}{'...' if len(brit_anon)>10 else ''}")

        # === 英军视角 ===
        p(f"[英军看到]")
        p(f"  己方: {', '.join(brit_ships[:10]) if brit_ships else '无'}")
        ger_public = sl[64].max() > 0.5 or sl[65].max() > 0.5  # Ch64/65 有暴露事件
        if ger_public:
            p(f"  德军(暴露): {', '.join(ger_ships) if ger_ships else '无'}")
        else:
            p(f"  德军: 位置未知")
            # 信号泄露标记
            leak = pos_of(66, sl)
            if leak: p(f"  信号泄露标记: {', '.join(leak)}（上回合运输攻击位置）")
        p()

    p(f"===== 终局: {result['winner']}胜 =====")

    text = '\n'.join(lines)
    if out:
        with open(out,'w') as f: f.write(text)
    return text

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("用法: python global_log.py <game_dir> [output.txt]")
        sys.exit(1)
    out = sys.argv[2] if len(sys.argv) > 2 else None
    print(translate(sys.argv[1], out))
