# Replay the eval set against an Ollama model via /api/chat and write a
# replies.json aligned to the eval records' order, for runGate.ts scoring.
#
#   python training/sft/ollama_eval.py --model retire-0.6b --out training/sft/out/replies-ollama.json [--limit N]
#
# Uses the production system prompt from extractEvalSet.ts output
# (training/sft/out/evalset.json) so the model sees exactly what the shipped
# assistant sees. Low temperature keeps scoring deterministic-ish.

import argparse
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--model', default='retire-0.6b')
    p.add_argument('--evalset', default=str(HERE / 'out' / 'evalset.json'))
    p.add_argument('--out', default=str(HERE / 'out' / 'replies-ollama.json'))
    p.add_argument('--limit', type=int, default=None)
    p.add_argument('--temperature', type=float, default=0.2)
    args = p.parse_args()

    blob = json.loads(Path(args.evalset).read_text(encoding='utf-8'))
    system = blob['systemPrompt']
    records = blob['records'][: args.limit] if args.limit else blob['records']
    print(f'model={args.model} records={len(records)} system={len(system)} chars', flush=True)

    replies: list[str] = []
    for i, rec in enumerate(records):
        payload = {
            'model': args.model,
            'messages': [
                {'role': 'system', 'content': system},
                {'role': 'user', 'content': rec['question']},
            ],
            'stream': False,
            'options': {'temperature': args.temperature, 'num_predict': 256},
        }
        req = urllib.request.Request(
            'http://localhost:11434/api/chat',
            data=json.dumps(payload).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
        )
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode('utf-8'))
        reply = body.get('message', {}).get('content', '')
        replies.append(reply)
        if (i + 1) % 25 == 0 or i == 0:
            print(f'  {i + 1}/{len(records)}', flush=True)

    Path(args.out).write_text(json.dumps(replies), encoding='utf-8')
    print(f'wrote {len(replies)} replies -> {args.out}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
