#!/bin/bash
# Companion script for polybar/waybar/i3blocks
# Reads /tmp/brave-tasks.json written by the native messaging host
# Usage:
#   brave-tasks.sh          -> "3 pendientes"
#   brave-tasks.sh -c       -> "3" (just the count)
#   brave-tasks.sh -j       -> JSON output for waybar

FILE=/tmp/brave-tasks.json

if [ ! -f "$FILE" ]; then
  echo "---"
  exit 0
fi

PENDING=$(python3 -c "import json; d=json.load(open('$FILE')); print(d['pending'])" 2>/dev/null)
TOTAL=$(python3 -c "import json; d=json.load(open('$FILE')); print(d['total'])" 2>/dev/null)

case "${1:-}" in
  -c) echo "$PENDING" ;;
  -j) python3 -c "import json; d=json.load(open('$FILE')); print(json.dumps({'text': str(d['pending']) + ' pending', 'alt': str(d['pending'])}))" ;;
  *)  echo "$PENDING/$TOTAL pendientes" ;;
esac
