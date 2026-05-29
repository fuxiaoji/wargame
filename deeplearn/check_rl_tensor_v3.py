#!/usr/bin/env python3
"""Validate RL Tensor v3 game directories."""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

import numpy as np

T, C, H, W = 73, 128, 8, 6
UNIT_SLOTS = 16
ACTIONS = 128
TARGET_FIELDS = 10
STATE_MAGIC = 0x42534D42
TARGET_MAGIC = 0x524C5433


def read_state(path: Path) -> np.ndarray:
    with path.open("rb") as f:
        magic = struct.unpack("<I", f.read(4))[0]
        if magic != STATE_MAGIC:
            raise ValueError(f"{path}: bad state magic {magic:#x}")
        dims = struct.unpack("<4i", f.read(16))
        if dims != (T, C, H, W):
            raise ValueError(f"{path}: bad state dims {dims}")
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)


def read_target(path: Path) -> np.ndarray:
    with path.open("rb") as f:
        magic = struct.unpack("<I", f.read(4))[0]
        if magic != TARGET_MAGIC:
            raise ValueError(f"{path}: bad target magic {magic:#x}")
        dims = struct.unpack("<2i", f.read(8))
        if dims != (T, TARGET_FIELDS):
            raise ValueError(f"{path}: bad target dims {dims}")
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)


def check_game(game_dir: Path) -> dict:
    state = read_state(game_dir / "state.bin")
    mask = np.fromfile(game_dir / "mask.bin", dtype=np.uint8)
    action = np.fromfile(game_dir / "action.bin", dtype=np.uint8)
    target = read_target(game_dir / "target.bin")

    if mask.size != T * UNIT_SLOTS * ACTIONS:
        raise ValueError(f"{game_dir}: bad mask size {mask.size}")
    if action.size != T * UNIT_SLOTS * 8:
        raise ValueError(f"{game_dir}: bad action size {action.size}")
    mask = mask.reshape(T, UNIT_SLOTS, ACTIONS)
    action = action.reshape(T, UNIT_SLOTS, 8)

    valid = target[:, 9] > 0.5
    bad_actions = []
    for i in np.where(valid)[0]:
        active_slots = np.where(mask[i].sum(axis=1) > 0)[0]
        for slot in active_slots:
            action_idx = int(action[i, slot, 4])
            if not (0 <= action_idx < ACTIONS) or mask[i, slot, action_idx] == 0:
                bad_actions.append((int(i), int(slot), action_idx))
    if bad_actions:
        raise ValueError(f"{game_dir}: action not in legal mask: {bad_actions[:5]}")

    # Basic visibility smoke checks. These are conservative: hidden channels should
    # be zero for the opposite side unless public/event channels mark exposure.
    german_turns = state[:, 12, 0, 0] > 0.5
    british_turns = valid & ~german_turns
    public_german = (state[:, 14, 0, 0] > 0.5) | (state[:, 64].max(axis=(1, 2)) > 0.5) | (state[:, 65].max(axis=(1, 2)) > 0.5)
    hidden_german_identity = state[british_turns & ~public_german, 48:56].sum()
    if hidden_german_identity > 1e-3:
        raise ValueError(f"{game_dir}: British observation leaks hidden German identity")

    german_view = valid & german_turns
    reveal_mask = (
        (state[:, 39] > 0.5)
        | (state[:, 42] > 0.5)
        | (state[:, 43] > 0.5)
    )
    sensitive_british_channels = list(range(16, 40)) + [44, 45, 46]
    for ch in sensitive_british_channels:
        leaked = (state[:, ch] > 1e-6) & german_view[:, None, None] & ~reveal_mask
        if leaked.any():
            first = np.argwhere(leaked)[0]
            raise ValueError(
                f"{game_dir}: German observation leaks unrevealed British identity "
                f"at t={int(first[0])}, channel={ch}, row={int(first[1])}, col={int(first[2])}"
            )

    ark_visible = state[:, 24].max(axis=(1, 2)) > 1e-6
    leaked_ark_cover = (state[:, 47].max(axis=(1, 2)) > 1e-6) & german_view & ~ark_visible
    if leaked_ark_cover.any():
        first_t = int(np.where(leaked_ark_cover)[0][0])
        raise ValueError(f"{game_dir}: German observation leaks Ark Royal air cover at t={first_t}")

    result = json.loads((game_dir / "result.json").read_text())
    return {
        "game": game_dir.name,
        "winner": result.get("winner"),
        "valid_steps": int(valid.sum()),
        "truncated": bool(result.get("truncated")),
    }


def iter_games(root: Path):
    if (root / "state.bin").exists():
        yield root
    else:
        for child in sorted(root.iterdir()):
            if child.is_dir() and (child / "state.bin").exists():
                yield child


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python3 deeplearn/check_rl_tensor_v3.py <game_dir_or_dataset>")
        return 2
    root = Path(sys.argv[1])
    rows = [check_game(game) for game in iter_games(root)]
    winners = {}
    for row in rows:
        winners[row["winner"]] = winners.get(row["winner"], 0) + 1
    print(json.dumps({
        "checked_games": len(rows),
        "winners": winners,
        "truncated": sum(1 for r in rows if r["truncated"]),
        "avg_valid_steps": sum(r["valid_steps"] for r in rows) / max(1, len(rows)),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
