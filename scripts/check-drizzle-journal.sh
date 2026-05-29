#!/bin/bash
set -euo pipefail

JOURNAL="drizzle/meta/_journal.json"

if [ ! -f "$JOURNAL" ]; then
	echo "No drizzle journal found at $JOURNAL — skip check."
	exit 0
fi

MISSING=()
for f in drizzle/*.sql; do
	[ -f "$f" ] || continue
	BASENAME=$(basename "$f")
	if ! grep -q "\"$BASENAME\"" "$JOURNAL"; then
		MISSING+=("$BASENAME")
	fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
	echo "ERROR: The following migration files are not registered in $JOURNAL:"
	for m in "${MISSING[@]}"; do
		echo "  - $m"
	done
	exit 1
fi

echo "All drizzle migration files are registered in journal."
