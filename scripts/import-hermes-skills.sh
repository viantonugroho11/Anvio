#!/usr/bin/env bash
# Import Hermes-tech skills into Anvio workspace (Phase J / A7)
# Usage: ./scripts/import-hermes-skills.sh [hermes-tech-repo-path] [workspace-skills-dir]

set -euo pipefail

HERMES_REPO="${1:-${HERMES_TECH_REPO:-$HOME/hermes-tech}}"
TARGET="${2:-${ANVIO_WORKSPACE:-./workspace}/skills}"

if [ ! -d "$HERMES_REPO/skills" ]; then
  echo "Hermes-tech skills not found at $HERMES_REPO/skills"
  echo "Clone: git clone https://github.com/viantonugroho11/hermes-tech.git"
  exit 1
fi

mkdir -p "$TARGET/imported"
count=0
while IFS= read -r skill; do
  base=$(basename "$skill" .md)
  dest="$TARGET/imported/${base}.md"
  cp "$skill" "$dest"
  count=$((count + 1))
done < <(find "$HERMES_REPO/skills" -name '*.md' -type f 2>/dev/null | head -200)

echo "Imported $count skills to $TARGET/imported/"
echo "Review and promote: anvio skills list && anvio learning promote <draft>"
