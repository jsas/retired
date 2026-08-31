#!/usr/bin/env bash
# Elective local-model triage — one command, fully visible. NOT part of the
# app or the deploy.
#
#   bash probe/run-triage.sh              # sweep all curated models
#   bash probe/run-triage.sh --models=Phi-4-mini-instruct-q4f16_1-MLC
#   bash probe/run-triage.sh --maxtokens=512 --profile=hot
#   bash probe/run-triage.sh --wipe       # delete the scratch profile first
#                                         # (frees ALL probe-downloaded weights)
#
# Opens the probe dashboard in its OWN Chrome window (separate profile +
# debug port), so it never touches the browsers you already have open and
# nothing of yours gets killed. The window shows every model load + score
# live; the driver mirrors it to the console and to
# probe/results/triage-<stamp>.jsonl. First run per model downloads its
# weights (multi-GB) into the scratch profile — slow but one-time; re-runs
# load from cache. The Chrome window is launched detached, so closing this
# script leaves the sweep running in the browser (re-run to re-attach).
set -uo pipefail   # NOT -e: the driver retry loop inspects exit codes

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PORT="${PROBE_PORT:-5174}"
CDP_PORT="${PROBE_CDP_PORT:-9224}"            # separate from any 9222/9223 you use
PROFILE_WIN="$LOCALAPPDATA\\reprobe-chrome"   # OUTSIDE the repo — vite watches the repo

find_chrome() {
  for c in \
    "/c/Program Files/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe" \
    "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
    "/c/Program Files/Microsoft/Edge/Application/msedge.exe"; do
    [ -x "$c" ] && { echo "$c"; return 0; }
  done
  echo "!! no Chrome/Edge found — install one or adjust find_chrome()" >&2; return 1
}

echo "# triage: port $PORT · CDP $CDP_PORT · profile $PROFILE_WIN"

# --wipe: throw away every weight the probe ever downloaded (the whole scratch
# profile is probe-only, so this is safe — it just means the next sweep
# re-downloads). Kill any running triage Chrome first so it can't re-write.
for a in "$@"; do
  if [ "$a" = "--wipe" ]; then
    powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*probe-chrome*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null
    sleep 1
    rm -rf "$LOCALAPPDATA/reprobe-chrome" "$(cd "$ROOT" 2>/dev/null && pwd)/.probe-chrome" 2>/dev/null
    echo "# wiped probe scratch profile (all cached weights gone)"
  fi
done

# --- translate driver-style flags into the page's ?auto= param syntax ---------
#   --models=a|b --maxtokens=512   ->   auto=1,models=a|b,maxtokens=512
#   --profile=hot                  ->   profile=hot   (separate param)
AUTO="1"; EXTRA=""
for a in "$@"; do
  case "$a" in
    --models=*)    AUTO="$AUTO,${a#--models=}" ;;
    --maxtokens=*) AUTO="$AUTO,maxtokens=${a#--maxtokens=}" ;;
    --profile=*)   EXTRA="&profile=${a#--profile=}" ;;
  esac
done
URL="http://localhost:$PORT/probe/?auto=$AUTO$EXTRA"

# --- 1. probe static server (repo root; page served at /probe/) --------------
# Free the port first: a stale probe server (e.g. from another checkout) would
# make vite silently move to 5175 while every health check passes against the
# old one. Only kills the LISTENING process on OUR port, nothing else.
STALE=$(powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort $PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess" 2>/dev/null | tr -d '\r' | head -1)
if [ -n "$STALE" ] && [ "$STALE" != "0" ]; then
  echo "# port $PORT held by pid $STALE — freeing it"
  powershell -NoProfile -Command "Stop-Process -Id $STALE -Force" 2>/dev/null
  sleep 1
fi
( cd "$ROOT" && npm run probe ) > /tmp/probe-vite.log 2>&1 &
VITE_PID=$!
trap 'echo "# shutting down vite ($VITE_PID)"; kill "$VITE_PID" 2>/dev/null' EXIT INT
for i in $(seq 1 30); do
  curl -s "http://localhost:$PORT/probe/" -o /dev/null && break
  sleep 1
done
curl -s "http://localhost:$PORT/probe/" -o /dev/null || { echo "!! probe server didn't come up"; tail -20 /tmp/probe-vite.log; exit 1; }
# Warm vite's dep optimizer: requesting the entry module triggers the
# esbuild pre-bundle of web-llm/zod/etc. — otherwise the browser's first
# load sits in "waiting" for minutes while vite optimizes on demand.
echo "# warming vite (dep pre-bundle)…"
curl -s "http://localhost:$PORT/probe/main.ts" -o /dev/null
for i in $(seq 1 90); do
  curl -s "http://localhost:$PORT/probe/main.ts" | grep -q "deps/" && break
  sleep 2
done
echo "# probe server up"

CHROME="$(find_chrome)"

# --- 2. launch a DETACHED visible Chrome window ------------------------------
# cmd start → Chrome is not a child of this script, so script/session cleanup
# can never take the sweep (or its downloaded cache) down with it.
launch_chrome() {
  # Only kill chrome.exe processes OUR scratch profile owns (a stale triage
  # instance would otherwise swallow the new window). Matches both the
  # AppData profile and any legacy repo-internal one — never the user's
  # own Chrome, whose profile path has no "probe-chrome" in it.
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*probe-chrome*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }" 2>/dev/null
  sleep 1
  # Start-Process = detached from this script's process tree, and PS array
  # quoting survives the URL's & and = (cmd start would eat them).
  powershell -NoProfile -Command "Start-Process -FilePath '$(cygpath -w "$CHROME")' -ArgumentList '--user-data-dir=$PROFILE_WIN','--remote-debugging-port=$CDP_PORT','--enable-unsafe-webgpu','--no-first-run','--no-default-browser-check','$URL'" > /dev/null
  for i in $(seq 1 30); do
    curl -s "http://127.0.0.1:$CDP_PORT/json/version" -o /dev/null && return 0
    sleep 1
  done
  return 1
}

if curl -s "http://127.0.0.1:$CDP_PORT/json/version" -o /dev/null; then
  echo "# a triage Chrome is already listening on $CDP_PORT — attaching to it"
  # Navigate it into auto mode in case it's an idle leftover window.
  curl -s "http://127.0.0.1:$CDP_PORT/json/list" -o /dev/null
else
  launch_chrome || { echo "!! Chrome didn't expose a debug port"; exit 1; }
fi
echo "# Chrome window up → $URL"

# --- 3. driver (retry if the window dies mid-sweep) ---------------------------
# exit 0 = sweep done · 1 = fatal · 2 = driver timeout · 3 = window vanished
# (relaunch + continue: weights stay cached in the scratch profile)
for attempt in 1 2 3; do
  echo "# driver attempt $attempt"
  node "$HERE/drive.mjs" --cdp="http://127.0.0.1:$CDP_PORT" --url="http://localhost:$PORT/probe/" "$@"
  RC=$?
  [ $RC -ne 3 ] && break
  echo "# (window died mid-sweep — relaunching, $attempt/3)"
  launch_chrome || { echo "!! relaunch failed"; break; }
  # The relaunched page starts the sweep from scratch; cached models load fast.
  sleep 3
done
echo "# triage script done (rc=$RC). Results in probe/results/, dashboard in the Chrome window."
