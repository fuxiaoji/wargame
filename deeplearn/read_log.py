#!/usr/bin/env python3
"""张量日志翻译器 —— 读取 state.bin + action.bin → 人类可读文本"""
import struct, json, sys, os

T, C, H, W = 73, 128, 8, 6
SLICE = C * H * W

PHASE_NAMES = {
    0: "德军布置", 1: "英军布置", 2: "德军移动", 3: "英军移动",
    4: "英军索敌", 5: "战斗", 6: "攻击运输", 7: "结束"
}
SIDE_NAMES = {0: "德军", 1: "英军"}
ACTION_NAMES = {0: "移动", 1: "推进阶段", 2: "航空索敌", 3: "战斗", 4: "运输"}
CH_NAMES = {
    0: "可通行", 1: "航路", 2: "布雷斯特", 3: "德军起始",
    4: "德移阶段", 5: "英移阶段", 6: "索敌阶段", 7: "战斗阶段",
    8: "回合进度", 9: "英VP", 10: "德VP",
    16: "胡德", 20: "威尔士", 24: "方舟", 28: "2步舰", 32: "1步舰",
    36: "伪装", 40: "英匿名位", 48: "俾斯麦", 52: "欧根",
    64: "索敌暴露", 65: "航空暴露", 66: "信号泄露", 67: "伪装移除",
    69: "德轨迹", 96: "信念B", 97: "意图Π"
}

COL_LABELS = ['A','B','C','D','E','F']

def read_tensor(path):
    with open(path, 'rb') as f:
        magic = struct.unpack('<I', f.read(4))[0]
        assert magic == 0x42534D42, f"Bad magic: {hex(magic)}"
        dims = struct.unpack('<4i', f.read(16))
        data = f.read()
    import numpy as np
    return np.frombuffer(data, dtype=np.float32).reshape(dims)

def read_actions(path):
    recs = []
    with open(path, 'rb') as f:
        while True:
            data = f.read(8)
            if len(data) < 8: break
            step, phase, side, atype, ship, q, r, pad = struct.unpack('<BBBBbbbB', data)
            recs.append({
                'step': step, 'phase': phase, 'side': side,
                'type': atype, 'ship_id': ship,
                'target': f"{COL_LABELS[q]}{r+1}" if q >= 0 and r >= 0 else None,
            })
    return recs

def translate(game_dir, out=None):
    """读取 game_dir/ 下的张量日志，翻译为人类可读文本"""
    state = read_tensor(f"{game_dir}/state.bin")
    actions = read_actions(f"{game_dir}/action.bin")

    with open(f"{game_dir}/result.json") as f:
        result = json.load(f)

    lines = []
    def p(s=""): lines.append(s)

    p(f"===== {result.get('game_id', '?')} =====")
    p(f"胜者: {result['winner']} | 回合: {result['turns']}/18 | "
      f"德VP: {result['vp_german']} 英VP: {result['vp_british']}")
    p(f"俾斯麦沉没: {result['bismarck_sunk']} | 抵达布雷斯特: {result['brest_reached']}")
    p()

    for act in actions:
        step, ph, side = act['step'], act['phase'], act['side']
        if ph == 7: break  # game_over, 后续为空
        sl = state[step]
        phase_name = PHASE_NAMES.get(ph, f"?{ph}")
        side_name = SIDE_NAMES.get(side, "?")

        # 提取关键通道
        turn = int(sl[8, 0, 0] * 18 + 0.5) or 1
        vp_b = int(sl[9, 0, 0] * 6 + 0.5)
        vp_g = int(sl[10, 0, 0] * 6 + 0.5)

        # 找俾斯麦位置
        bismarck_pos = None
        for r in range(H):
            for c in range(W):
                if sl[48, r, c] > 0.5:
                    bismarck_pos = f"{COL_LABELS[c]}{r+1}"

        p(f"--- 步{step} | T{turn} {phase_name} | {side_name} | 德VP:{vp_g} 英VP:{vp_b}")
        if bismarck_pos: p(f"    俾斯麦位置: {bismarck_pos}")

        # 动作
        a_name = ACTION_NAMES.get(act['type'], f"?{act['type']}")
        tgt = act['target'] or '无'
        p(f"    动作: {a_name} → {tgt}")

        # 英军船位置
        brit_positions = []
        for r in range(H):
            for c in range(W):
                if sl[16, r, c] > 0.5: brit_positions.append(f"胡德@{COL_LABELS[c]}{r+1}")
                if sl[20, r, c] > 0.5: brit_positions.append(f"威尔士@{COL_LABELS[c]}{r+1}")
                if sl[24, r, c] > 0.5: brit_positions.append(f"方舟@{COL_LABELS[c]}{r+1}")
                if sl[36, r, c] > 0.5: brit_positions.append(f"伪装@{COL_LABELS[c]}{r+1}")
        if brit_positions and len(brit_positions) <= 8:
            p(f"    英军: {', '.join(brit_positions)}")

        # 事件通道
        events = []
        for r in range(H):
            for c in range(W):
                lbl = f"{COL_LABELS[c]}{r+1}"
                if sl[64, r, c] > 0.5: events.append(f"索敌暴露@{lbl}")
                if sl[66, r, c] > 0.5: events.append(f"信号泄露@{lbl}")
        if events: p(f"    事件: {', '.join(events)}")
        p()

    p(f"===== 终局: {result['winner']}胜 ({result.get('victory_reason','?')}) =====")

    text = '\n'.join(lines)
    if out:
        with open(out, 'w') as f: f.write(text)
    return text

if __name__ == '__main__':
    import sys
    if len(sys.argv) < 2:
        print("用法: python read_log.py <game_dir> [output.txt]")
        sys.exit(1)
    game_dir = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    text = translate(game_dir, out)
    print(text)
