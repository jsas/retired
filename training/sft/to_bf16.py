#!/usr/bin/env python3
"""Convert a safetensors checkpoint to bf16 (and copy the tokenizer files
along), so the publishable weight is ~1.2 GB rather than fp32."""
import json
import shutil
import sys
from pathlib import Path
import torch
from safetensors.torch import load_file, save_file


def main(src_dir, dst_dir):
    src_dir = Path(src_dir)
    dst_dir = Path(dst_dir)
    dst_dir.mkdir(parents=True, exist_ok=True)

    ckpt = src_dir / 'model.safetensors'
    if not ckpt.exists():
        raise SystemExit(f'no model.safetensors in {src_dir}')

    sd = load_file(str(ckpt))
    bf16_sd = {k: v.to(torch.bfloat16) for k, v in sd.items()}
    save_file(bf16_sd, str(dst_dir / 'model.safetensors'), metadata={'format': 'pt'})

    for name in ('config.json', 'generation_config.json', 'tokenizer_config.json',
                 'tokenizer.json', 'added_tokens.json', 'special_tokens_map.json',
                 'merges.txt', 'vocab.json'):
        src = src_dir / name
        if src.exists():
            shutil.copy2(src, dst_dir / name)

    cfg_path = dst_dir / 'config.json'
    cfg = json.loads(cfg_path.read_text())
    cfg['torch_dtype'] = 'bfloat16'
    cfg_path.write_text(json.dumps(cfg, indent=2))

    size = (dst_dir / 'model.safetensors').stat().st_size / 1e9
    print(f'bf16 shard written: {dst_dir} (~{size:.2f} GB)')


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit('usage: to_bf16.py <src_dir> <dst_dir>')
    main(sys.argv[1], sys.argv[2])
