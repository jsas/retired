#!/usr/bin/env python
# Live training monitor: tail train-run.log's progress bar + nvidia-smi GPU stats.
# Run:  python training/watch_train.py
import re
import subprocess
import time
from pathlib import Path

LOG = Path(__file__).parent / "train-run.log"


def gpu_stats() -> str:
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10,
        ).stdout.strip()
        util, used, total = [p.strip() for p in out.split(",")]
        return f"GPU {util}%  VRAM {used}/{total} MiB"
    except Exception:
        return "GPU ?"


def latest_progress(text: str) -> str:
    # tqdm writes CR-separated updates; take the last non-empty fragment
    frags = [f.strip() for f in re.split(r"[\r\n]+", text) if f.strip()]
    for frag in reversed(frags):
        if "%|" in frag and ("it/s" in frag or "s/it" in frag):
            return frag
    return ""


def last_losses(text: str, n: int = 3) -> list[str]:
    hits = re.findall(r"\{[^{}]*'loss'[^{}]*\}", text)
    return hits[-n:]


def main() -> None:
    print(f"Watching {LOG} — Ctrl+C to stop (training keeps running).\n")
    while True:
        text = LOG.read_text(encoding="utf-8", errors="replace") if LOG.exists() else ""
        prog = latest_progress(text)
        losses = last_losses(text)
        lines = [f"[{time.strftime('%H:%M:%S')}] {gpu_stats()}"]
        if prog:
            lines.append(prog)
        elif text:
            # still preprocessing — show last log line instead
            tail = [f.strip() for f in re.split(r"[\r\n]+", text) if f.strip()]
            if tail:
                lines.append(tail[-1][:160])
        lines.extend(losses)
        print("\n".join(lines) + "\n" + "-" * 100)
        time.sleep(10)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
