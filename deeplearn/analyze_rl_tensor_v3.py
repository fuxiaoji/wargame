#!/usr/bin/env python3
"""Analyze RL Tensor v3 dataset quality.

This complements `check_rl_tensor_v3.py`: the checker validates file format and
visibility safety, while this analyzer reports whether a generated batch is
balanced and diverse enough to enter Stage 1 training.
"""

from __future__ import annotations

import argparse
import collections
import json
import struct
import sys
from pathlib import Path

import numpy as np

T = 73
TARGET_FIELDS = 10
TARGET_MAGIC = 0x524C5433


def read_target(path: Path) -> np.ndarray:
    with path.open("rb") as f:
        magic = struct.unpack("<I", f.read(4))[0]
        if magic != TARGET_MAGIC:
            raise ValueError(f"{path}: bad target magic {magic:#x}")
        dims = struct.unpack("<2i", f.read(8))
        if dims != (T, TARGET_FIELDS):
            raise ValueError(f"{path}: bad target dims {dims}")
        return np.frombuffer(f.read(), dtype=np.float32).reshape(dims)


def iter_games(root: Path):
    if (root / "result.json").exists():
        yield root
        return
    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / "result.json").exists():
            yield child


def norm_reason(reason: str | None) -> str:
    text = reason or "none"
    if "布雷斯特" in text or "F7" in text:
        return "f7_brest"
    if "6 分" in text or "6分" in text:
        return "six_vp"
    if "击沉" in text or "沉没" in text:
        return "sunk"
    if "18 回合" in text or "18回合" in text:
        return "turn18"
    return text


def source_bucket(source: str) -> str:
    return source.split(":", 1)[0]


def reward_stats(values: list[float]) -> dict:
    if not values:
        return {"count": 0}
    arr = np.array(values, dtype=np.float32)
    return {
        "count": int(arr.size),
        "mean": float(arr.mean()),
        "std": float(arr.std()),
        "min": float(arr.min()),
        "p05": float(np.quantile(arr, 0.05)),
        "p50": float(np.quantile(arr, 0.50)),
        "p95": float(np.quantile(arr, 0.95)),
        "max": float(arr.max()),
    }


def analyze(root: Path) -> dict:
    rows = []
    rewards_g: list[float] = []
    rewards_b: list[float] = []
    returns_g: list[float] = []
    returns_b: list[float] = []

    for game_dir in iter_games(root):
        result = json.loads((game_dir / "result.json").read_text())
        target_path = game_dir / "target.bin"
        if target_path.exists():
            target = read_target(target_path)
            valid = target[:, 9] > 0.5
            rewards_g.extend(float(v) for v in target[valid, 3])
            rewards_b.extend(float(v) for v in target[valid, 4])
            returns_g.extend(float(v) for v in target[valid, 5])
            returns_b.extend(float(v) for v in target[valid, 6])
        rows.append(result)

    winners = collections.Counter(r.get("winner") or "none" for r in rows)
    victory_types = collections.Counter(norm_reason(r.get("victory_reason")) for r in rows)
    german_sources = collections.Counter(source_bucket(r.get("policy_source_german", "unknown")) for r in rows)
    british_sources = collections.Counter(source_bucket(r.get("policy_source_british", "unknown")) for r in rows)
    games = len(rows)
    max_side_ratio = max(winners.values()) / games if games else 0.0

    return {
        "games": games,
        "winners": dict(winners),
        "max_side_ratio": max_side_ratio,
        "truncated": sum(1 for r in rows if r.get("truncated")),
        "truncated_ratio": sum(1 for r in rows if r.get("truncated")) / games if games else 0.0,
        "avg_turns": sum(float(r.get("turns", 0)) for r in rows) / games if games else 0.0,
        "avg_recorded_steps": sum(float(r.get("recorded_steps", 0)) for r in rows) / games if games else 0.0,
        "avg_action_records": sum(float(r.get("action_records", r.get("recorded_steps", 0))) for r in rows) / games if games else 0.0,
        "victory_types": dict(victory_types),
        "german_sources": dict(german_sources),
        "british_sources": dict(british_sources),
        "reward_german": reward_stats(rewards_g),
        "reward_british": reward_stats(rewards_b),
        "return_german": reward_stats(returns_g),
        "return_british": reward_stats(returns_b),
    }


def build_warnings(report: dict) -> list[str]:
    warnings: list[str] = []
    if report["games"] == 0:
        return ["no games found"]
    if report["max_side_ratio"] > 0.75:
        warnings.append("winner balance exceeds 75% for one side")
    required_victories = {"f7_brest", "six_vp", "sunk", "turn18"}
    missing_victories = sorted(required_victories - set(report["victory_types"].keys()))
    if missing_victories:
        warnings.append(f"missing victory types: {', '.join(missing_victories)}")
    required_sources = {
        "state_machine_vs_state_machine",
        "state_machine_vs_yanfu",
        "state_machine_vs_random",
        "default_weak_mix",
        "mutated_state_machine",
        "optional_high_quality_fallback",
    }
    sources = set(report["german_sources"].keys()) | set(report["british_sources"].keys())
    missing_sources = sorted(required_sources - sources)
    if missing_sources:
        warnings.append(f"missing policy source buckets: {', '.join(missing_sources)}")
    if report["truncated_ratio"] > 0.80:
        warnings.append("truncated ratio exceeds 80%; fixed 73-step window may be losing too much long-game signal")
    return warnings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    parser.add_argument("--out", default="")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when quality warnings are present.")
    args = parser.parse_args()

    report = analyze(Path(args.dataset))
    report["warnings"] = build_warnings(report)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text + "\n")
    return 1 if args.strict and report["warnings"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
