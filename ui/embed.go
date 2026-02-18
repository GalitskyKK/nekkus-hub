package ui

import "embed"

// Assets — содержимое frontend/dist для embed.
// Сборка: из frontend/ задать outDir ../ui/frontend/dist и выполнить npm run build.
//go:embed all:frontend/dist
var Assets embed.FS
