#!/usr/bin/env python3
"""Stage 1 naive RL baseline for RL Tensor v3.

This script implements the first offline step of Stage 1:

- load final-standard v3 tensors
- train a CNN+MLP policy/value model by behavior cloning
- save a checkpoint that can later be used for PPO fine-tuning

PPO online fine-tuning is intentionally not wired here yet because it needs a
Python/TypeScript environment bridge for self-play rollouts.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from tqdm import tqdm

T, C, H, W = 73, 128, 8, 6
UNIT_SLOTS = 16
ACTIONS = 128
TARGET_FIELDS = 10
STATE_MAGIC = 0x42534D42
TARGET_MAGIC = 0x524C5433


def require_torch():
    try:
        import torch
        import torch.nn as nn
        import torch.nn.functional as F
        from torch.utils.data import DataLoader, Dataset, random_split
    except ModuleNotFoundError as exc:
        raise SystemExit(
            "PyTorch is required for Stage 1 training.\n"
            "Install it in this environment, then rerun for example:\n"
            "  python3 -m pip install torch\n"
            "  python3 deeplearn/train_rl_baseline.py --data deeplearn/data/rl_tensor_v3/raw"
        ) from exc
    return torch, nn, F, DataLoader, Dataset, random_split


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


def iter_games(root: Path):
    if (root / "state.bin").exists():
        yield root
        return
    for child in sorted(root.iterdir()):
        if child.is_dir() and (child / "state.bin").exists():
            yield child


@dataclass(frozen=True)
class SampleRef:
    game_dir: Path
    t: int
    slot: int


def build_sample_index(root: Path, limit_games: int | None) -> list[SampleRef]:
    refs: list[SampleRef] = []
    games = list(iter_games(root))
    if limit_games:
        games = games[:limit_games]
    print(f"Indexing RL Tensor v3 games: games={len(games)} root={root}", flush=True)
    for game_dir in tqdm(games, desc="index", unit="game"):
        target = read_target(game_dir / "target.bin")
        mask = np.fromfile(game_dir / "mask.bin", dtype=np.uint8).reshape(T, UNIT_SLOTS, ACTIONS)
        valid_steps = np.where(target[:, 9] > 0.5)[0]
        for t in valid_steps:
            for slot in np.where(mask[t].sum(axis=1) > 0)[0]:
                refs.append(SampleRef(game_dir, int(t), int(slot)))
    if not refs:
        raise ValueError(f"No valid v3 samples found under {root}")
    print(f"Indexed behavior-cloning samples: {len(refs)}", flush=True)
    return refs


def make_dataset_class(torch, Dataset):
    class RlTensorV3Dataset(Dataset):
        def __init__(self, refs: list[SampleRef]):
            self.refs = refs
            self.cache: dict[Path, tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]] = {}

        def __len__(self):
            return len(self.refs)

        def _load_game(self, game_dir: Path):
            if game_dir not in self.cache:
                state = read_state(game_dir / "state.bin")
                mask = np.fromfile(game_dir / "mask.bin", dtype=np.uint8).reshape(T, UNIT_SLOTS, ACTIONS)
                action = np.fromfile(game_dir / "action.bin", dtype=np.uint8).reshape(T, UNIT_SLOTS, 8)
                target = read_target(game_dir / "target.bin")
                self.cache[game_dir] = state, mask, action, target
            return self.cache[game_dir]

        def __getitem__(self, idx: int):
            ref = self.refs[idx]
            state, mask, action, target = self._load_game(ref.game_dir)
            active_is_german = state[ref.t, 12, 0, 0] > 0.5
            value_target = target[ref.t, 5 if active_is_german else 6]
            return {
                "state": torch.from_numpy(state[ref.t].copy()).float(),
                "mask": torch.from_numpy(mask[ref.t, ref.slot].copy()).bool(),
                "action": torch.tensor(int(action[ref.t, ref.slot, 4]), dtype=torch.long),
                "value": torch.tensor(float(value_target), dtype=torch.float32),
            }

    return RlTensorV3Dataset


def make_model_class(nn, F):
    class NaiveRlBaseline(nn.Module):
        def __init__(self):
            super().__init__()
            self.conv1 = nn.Conv2d(C, 128, kernel_size=3, padding=1)
            self.conv2 = nn.Conv2d(128, 128, kernel_size=3, padding=1)
            self.conv3 = nn.Conv2d(128, 96, kernel_size=3, padding=1)
            self.body = nn.Sequential(
                nn.Flatten(),
                nn.Linear(96 * H * W, 512),
                nn.ReLU(),
                nn.Linear(512, 256),
                nn.ReLU(),
            )
            self.policy = nn.Linear(256, ACTIONS)
            self.value = nn.Linear(256, 1)

        def forward(self, x):
            x = F.relu(self.conv1(x))
            x = F.relu(self.conv2(x))
            x = F.relu(self.conv3(x))
            z = self.body(x)
            return self.policy(z), self.value(z).squeeze(-1)

    return NaiveRlBaseline


def masked_accuracy(logits, mask, action):
    masked = logits.masked_fill(~mask, -1e9)
    pred = masked.argmax(dim=-1)
    return (pred == action).float().mean().item()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="deeplearn/data/rl_tensor_v3/raw")
    parser.add_argument("--out", default="deeplearn/checkpoints/rl_baseline_stage1.pt")
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--value-loss-weight", type=float, default=0.25)
    parser.add_argument("--val-ratio", type=float, default=0.10)
    parser.add_argument("--limit-games", type=int, default=0)
    parser.add_argument("--seed", type=int, default=1779700000)
    args = parser.parse_args()

    torch, nn, F, DataLoader, Dataset, random_split = require_torch()
    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    refs = build_sample_index(Path(args.data), args.limit_games or None)
    DatasetCls = make_dataset_class(torch, Dataset)
    dataset = DatasetCls(refs)
    val_len = max(1, int(len(dataset) * args.val_ratio)) if len(dataset) > 10 else 0
    train_len = len(dataset) - val_len
    if val_len:
        train_set, val_set = random_split(dataset, [train_len, val_len], generator=torch.Generator().manual_seed(args.seed))
    else:
        train_set, val_set = dataset, None

    train_loader = DataLoader(train_set, batch_size=args.batch_size, shuffle=True, num_workers=0)
    val_loader = DataLoader(val_set, batch_size=args.batch_size, shuffle=False, num_workers=0) if val_set else None

    device = torch.device("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
    Model = make_model_class(nn, F)
    model = Model().to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    print(f"Stage 1 BC training: samples={len(dataset)} train={train_len} val={val_len} device={device}")
    for epoch in range(1, args.epochs + 1):
        model.train()
        train_loss = 0.0
        train_acc = 0.0
        seen = 0
        for step, batch in enumerate(train_loader, start=1):
            state = batch["state"].to(device)
            mask = batch["mask"].to(device)
            action = batch["action"].to(device)
            value = batch["value"].to(device)

            logits, pred_value = model(state)
            masked_logits = logits.masked_fill(~mask, -1e9)
            policy_loss = F.cross_entropy(masked_logits, action)
            value_loss = F.smooth_l1_loss(pred_value, value)
            loss = policy_loss + args.value_loss_weight * value_loss

            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()

            bs = state.shape[0]
            train_loss += loss.item() * bs
            train_acc += masked_accuracy(logits.detach(), mask, action) * bs
            seen += bs
            if step == 1 or step % 25 == 0 or step == len(train_loader):
                pct = step / max(1, len(train_loader)) * 100
                print(f"[epoch {epoch}] {step}/{len(train_loader)} ({pct:.1f}%) loss={train_loss/seen:.4f} acc={train_acc/seen:.3f}")

        metrics = {
            "epoch": epoch,
            "train_loss": train_loss / max(1, seen),
            "train_acc": train_acc / max(1, seen),
        }
        if val_loader:
            model.eval()
            val_loss = 0.0
            val_acc = 0.0
            val_seen = 0
            with torch.no_grad():
                for batch in val_loader:
                    state = batch["state"].to(device)
                    mask = batch["mask"].to(device)
                    action = batch["action"].to(device)
                    value = batch["value"].to(device)
                    logits, pred_value = model(state)
                    masked_logits = logits.masked_fill(~mask, -1e9)
                    loss = F.cross_entropy(masked_logits, action) + args.value_loss_weight * F.smooth_l1_loss(pred_value, value)
                    bs = state.shape[0]
                    val_loss += loss.item() * bs
                    val_acc += masked_accuracy(logits, mask, action) * bs
                    val_seen += bs
            metrics["val_loss"] = val_loss / max(1, val_seen)
            metrics["val_acc"] = val_acc / max(1, val_seen)
        print(json.dumps(metrics, ensure_ascii=False))

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "schema": "rl_tensor_v3",
        "model": "naive_cnn_mlp_stage1",
        "samples": len(dataset),
        "args": vars(args),
    }, out)
    print(f"Saved checkpoint: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
