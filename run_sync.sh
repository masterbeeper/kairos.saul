#!/bin/bash
# run_sync.sh
# ──────────────────────────────────────────────────
# One command to sync all brokers and push to GitHub.
# Run: ./run_sync.sh
#
# To run automatically at 4:30 PM ET on weekdays,
# add this to your crontab (crontab -e):
#   30 16 * * 1-5 cd /path/to/kairos && ./run_sync.sh >> logs/sync.log 2>&1
# ──────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "══════════════════════════════════════"
echo "  KAIROS — run_sync.sh"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════"

# 1. Run Python sync
echo ""
echo "▶ Step 1: Fetching broker data..."
python3 sync/sync.py

# 2. Check if data.json was updated
if [ ! -f "data.json" ]; then
  echo "❌ data.json not found — sync may have failed"
  exit 1
fi

# 3. Git add + commit + push
echo ""
echo "▶ Step 2: Pushing to GitHub..."

git add data.json

# Only commit if there are changes
if git diff --staged --quiet; then
  echo "  No changes to data.json — skipping commit"
else
  git commit -m "sync: $(date -u '+%Y-%m-%d %H:%M UTC')"
  git push
  echo "  ✅ Pushed to GitHub"
fi

echo ""
echo "══════════════════════════════════════"
echo "  Done! Dashboard updated."
echo "══════════════════════════════════════"
echo ""
