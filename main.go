package main

import (
	"embed"
	_ "embed"
	"flag"
	"log"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// Wails uses Go's `embed` package to embed the frontend files into the binary.
// Any files in the frontend/dist folder will be embedded into the binary and
// made available to the frontend.
// See https://pkg.go.dev/embed for more information.

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	grpcAddr := flag.String("grpc-addr", getEnv("NEKKUS_HUB_GRPC_ADDR", "127.0.0.1:50051"), "gRPC address")
	httpAddr := flag.String("http-addr", getEnv("NEKKUS_HUB_HTTP_ADDR", "127.0.0.1:8080"), "HTTP address")
	modulesDir := flag.String("modules-dir", getEnv("NEKKUS_MODULES_DIR", "../modules"), "Modules directory")
	flag.Parse()

	if _, err := RunHubBackend(BackendOptions{
		GRPCAddr:   *grpcAddr,
		HTTPAddr:   *httpAddr,
		ModulesDir: *modulesDir,
	}); err != nil {
		log.Fatal(err)
	}

	runWailsUI()
}

func runWailsUI() {
	app := application.New(application.Options{
		Name:        "nekkus HUB",
		Description: "nekkus hub manager",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Create a new window with the necessary options.
	// 'Title' is the title of the window.
	// 'Mac' options tailor the window when running on macOS.
	// 'BackgroundColour' is the background colour of the window.
	// 'URL' is the URL that will be loaded into the webview.
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "nekkus HUB",
		URL:   "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
