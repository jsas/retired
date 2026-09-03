#!/usr/bin/env bash
# Launch a LLaMA-Factory training run with the env vars this machine requires.
#
#   training/train.sh training/lf_lora.yaml
#   training/train.sh training/lf_sft.yaml
#
# DISABLE_VERSION_CHECK  — llamafactory 0.9.5 caps datasets<=4.0.0 but we run
#                          4.8.5 to dodge the Python 3.14 dill Pickler bug.
# PYTHONIOENCODING/UTF8  — Windows cp1252 console chokes on the '→' in the
#                          data-example print; force UTF-8.
set -euo pipefail

YAML="${1:?usage: train.sh <lf_recipe.yaml>}"

LF_CLI="${LF_CLI:-C:/Users/mrsas/AppData/Roaming/Python/Python314/Scripts/llamafactory-cli.exe}"
if [[ ! -f "$LF_CLI" ]]; then
  LF_CLI="$(command -v llamafactory-cli || true)"
fi
[[ -n "$LF_CLI" ]] || { echo "llamafactory-cli not found"; exit 1; }

export DISABLE_VERSION_CHECK=1
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

exec "$LF_CLI" train "$YAML"
