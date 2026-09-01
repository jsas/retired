#!/usr/bin/env python3
"""Fetch the convert_hf_to_gguf.py + gguf-py helpers from llama.cpp's GitHub
so we don't have to clone the whole repo. Saves them under
`training/sft/llama.cpp/` so the convert script can find its gguf package.
"""
from pathlib import Path
import urllib.request

LLAMA_CPP_RAW = 'https://raw.githubusercontent.com/ggml-org/llama.cpp/master'
# These are the minimum file set convert_hf_to_gguf.py actually imports.
FILES = [
    'convert_hf_to_gguf.py',
    'convert_lora_to_gguf.py',
    'conversion/__init__.py',
    'conversion/base.py',
    'conversion/qwen.py',
    'gguf-py/gguf/__init__.py',
    'gguf-py/gguf/constants.py',
    'gguf-py/gguf/gguf_reader.py',
    'gguf-py/gguf/gguf_writer.py',
    'gguf-py/gguf/lazy.py',
    'gguf-py/gguf/metadata.py',
    'gguf-py/gguf/quants.py',
    'gguf-py/gguf/tensor_mapping.py',
    'gguf-py/gguf/utility.py',
    'gguf-py/gguf/vocab.py',
]


def main() -> None:
    base = Path('training/sft/llama.cpp')
    base.mkdir(parents=True, exist_ok=True)
    for rel in FILES:
        url = f'{LLAMA_CPP_RAW}/{rel}'
        dst = base / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        print(f'fetch {rel}')
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                dst.write_bytes(r.read())
        except Exception as e:
            print(f'  FAIL {e}')
            raise


if __name__ == '__main__':
    main()
