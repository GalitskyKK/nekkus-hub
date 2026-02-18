package main

import (
	"context"
	"errors"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/GalitskyKK/nekkus-core/pkg/desktop"
	"github.com/GalitskyKK/nekkus-core/pkg/discovery"
	coreserver "github.com/GalitskyKK/nekkus-core/pkg/server"
	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"github.com/GalitskyKK/nekkus-hub/assets"
	"github.com/GalitskyKK/nekkus-hub/internal/hubgrpc"
	"github.com/GalitskyKK/nekkus-hub/internal/pathutil"
	"github.com/GalitskyKK/nekkus-hub/internal/process"
	"github.com/GalitskyKK/nekkus-hub/internal/registry"
	"github.com/GalitskyKK/nekkus-hub/internal/server"
	"github.com/GalitskyKK/nekkus-hub/internal/api"
	"github.com/GalitskyKK/nekkus-hub/ui"
	"google.golang.org/grpc"
)

var (
	httpPort  = flag.Int("port", 9000, "HTTP port")
	grpcPort  = flag.Int("grpc-port", 19000, "gRPC port")
	modulesDirFlag = flag.String("modules-dir", "", "Modules directory (default: next to executable)")
	headless  = flag.Bool("headless", false, "Run without GUI")
	trayOnly  = flag.Bool("tray-only", false, "Start minimized to tray")
)

func waitForServer(host string, port int, timeout time.Duration) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 200*time.Millisecond)
		if err == nil {
			conn.Close()
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
}

func main() {
	flag.Parse()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	modulesDir, err := pathutil.ResolveModulesDir(*modulesDirFlag)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.MkdirAll(modulesDir, 0o755); err != nil {
		log.Fatalf("create modules dir: %v", err)
	}

	reg := registry.New()
	if err := reg.ScanModules(modulesDir); err != nil {
		log.Printf("module scan: %v", err)
	}
	procMgr := process.NewManager()

	uiFS, err := fs.Sub(ui.Assets, "frontend/dist")
	if err != nil {
		log.Fatalf("ui embed: %v", err)
	}

	srv := coreserver.New(*httpPort, *grpcPort, uiFS)
	grpcAddr := net.JoinHostPort("127.0.0.1", strconv.Itoa(*grpcPort))
	server.RegisterRoutes(srv, api.ServerConfig{
		Registry:       reg,
		ProcessManager: procMgr,
		ModulesDir:     modulesDir,
		GRPCAddr:       grpcAddr,
	})

	go func() {
		if err := srv.Start(ctx); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("HTTP server: %v", err)
		}
	}()

	go func() {
		if err := srv.StartGRPC(func(s *grpc.Server) {
			pb.RegisterNekkusHubServer(s, hubgrpc.NewServer(reg))
		}); err != nil {
			log.Printf("gRPC server: %v", err)
		}
	}()

	disc, err := discovery.Announce(discovery.ModuleAnnouncement{
		ID:       "hub",
		Name:     "nekkus HUB",
		HTTPPort: *httpPort,
		GRPCPort: *grpcPort,
	})
	if err != nil {
		log.Printf("discovery: %v", err)
	} else {
		defer disc.Shutdown()
	}

	log.Printf("nekkus HUB → http://localhost:%d", *httpPort)

	if *headless {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
		<-sig
		cancel()
		return
	}

	waitForServer("127.0.0.1", *httpPort, 5*time.Second)

	rescan := func() {
		if err := reg.ScanModules(modulesDir); err != nil {
			log.Printf("rescan: %v", err)
		}
	}

	desktop.Launch(desktop.AppConfig{
		ModuleID:   "hub",
		ModuleName: "nekkus HUB",
		HTTPPort:   *httpPort,
		IconBytes:  assets.TrayIcon,
		Headless:   false,
		TrayOnly:   *trayOnly,
		TrayMenuItems: []desktop.TrayMenuItem{
			{Label: "Rescan", OnClick: rescan},
		},
		OnQuit: func() {
			cancel()
		},
	})
}
