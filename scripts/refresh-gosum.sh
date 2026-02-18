#!/usr/bin/env sh
# Обновляет go.sum для сборки без go.work (как в CI).
# Запуск из корня nekkus-hub: ./scripts/refresh-gosum.sh
# После выполнения закоммитьте go.sum и go.mod.

set -e
cd "$(dirname "$0")/.."
echo "Running go mod tidy (GOWORK=off) in $(pwd)..."
GOWORK=off go mod tidy
echo "Done. Commit go.sum and go.mod if changed."
