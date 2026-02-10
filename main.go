package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

type widgetConfig struct {
	Type           string `json:"type"`
	Component      string `json:"component"`
	Height         int    `json:"height"`
	UpdateInterval string `json:"update_interval"`
	SupportsResize bool   `json:"supports_resize"`
}

type moduleManifest struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Version     string       `json:"version"`
	Widget      widgetConfig `json:"widget"`
	GrpcAddr    string       `json:"grpc_addr"`
}

type registeredModule struct {
	ID           string
	Version      string
	PID          int32
	RegisteredAt time.Time
}

type moduleRegistry struct {
	mu         sync.RWMutex
	manifests  map[string]moduleManifest
	registered map[string]registeredModule
}

func newRegistry() *moduleRegistry {
	return &moduleRegistry{
		manifests:  make(map[string]moduleManifest),
		registered: make(map[string]registeredModule),
	}
}

func (r *moduleRegistry) scanModules(modulesDir string) error {
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		return err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		manifestPath := filepath.Join(modulesDir, entry.Name(), "manifest.json")
		data, readErr := os.ReadFile(manifestPath)
		if readErr != nil {
			continue
		}

		var manifest moduleManifest
		if unmarshalErr := json.Unmarshal(data, &manifest); unmarshalErr != nil {
			continue
		}

		if manifest.ID == "" {
			continue
		}

		r.mu.Lock()
		r.manifests[manifest.ID] = manifest
		r.mu.Unlock()
	}

	return nil
}

func (r *moduleRegistry) registerModule(module registeredModule) {
	r.mu.Lock()
	r.registered[module.ID] = module
	r.mu.Unlock()
}

func (r *moduleRegistry) listModules() []moduleManifest {
	r.mu.RLock()
	defer r.mu.RUnlock()

	modules := make([]moduleManifest, 0, len(r.manifests))
	for _, manifest := range r.manifests {
		modules = append(modules, manifest)
	}
	return modules
}

type hubServer struct {
	pb.UnimplementedHubServiceServer
	registry *moduleRegistry
}

func (s *hubServer) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	s.registry.registerModule(registeredModule{
		ID:           req.ModuleId,
		Version:      req.Version,
		PID:          req.Pid,
		RegisteredAt: time.Now(),
	})

	return &pb.RegisterResponse{
		Success:    true,
		HubVersion: "0.1.0",
		Capabilities: map[string]string{
			"logging":       "true",
			"notifications": "true",
		},
	}, nil
}

func (s *hubServer) Notify(ctx context.Context, req *pb.NotificationRequest) (*pb.NotificationResponse, error) {
	log.Printf("notify: %s - %s", req.Title, req.Message)
	return &pb.NotificationResponse{Delivered: true}, nil
}

func (s *hubServer) GetSystemInfo(ctx context.Context, req *pb.SystemInfoRequest) (*pb.SystemInfoResponse, error) {
	info := map[string]string{
		"os":   runtimeOS(),
		"arch": runtimeArch(),
	}

	return &pb.SystemInfoResponse{Info: info}, nil
}

func (s *hubServer) Log(ctx context.Context, req *pb.LogRequest) (*pb.LogResponse, error) {
	log.Printf("module log [%v]: %s", req.Level, req.Message)
	return &pb.LogResponse{Logged: true}, nil
}

func main() {
	grpcAddr := getEnv("NEKKUS_HUB_GRPC_ADDR", "127.0.0.1:50051")
	httpAddr := getEnv("NEKKUS_HUB_HTTP_ADDR", "127.0.0.1:8080")
	modulesDir := getEnv("NEKKUS_MODULES_DIR", "../modules")

	registry := newRegistry()
	if err := registry.scanModules(modulesDir); err != nil {
		log.Printf("module scan error: %v", err)
	}

	grpcListener, err := net.Listen("tcp", grpcAddr)
	if err != nil {
		log.Fatalf("failed to listen on %s: %v", grpcAddr, err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterHubServiceServer(grpcServer, &hubServer{registry: registry})

	go func() {
		log.Printf("hub gRPC listening on %s", grpcAddr)
		if serveErr := grpcServer.Serve(grpcListener); serveErr != nil {
			log.Fatalf("grpc server error: %v", serveErr)
		}
	}()

	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		modules := registry.listModules()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		fmt.Fprintln(w, "<html><head><title>nekkus hub</title></head><body>")
		fmt.Fprintln(w, "<h1>Modules</h1>")
		if len(modules) == 0 {
			fmt.Fprintln(w, "<p>No modules discovered.</p>")
		}
		for _, module := range modules {
			fmt.Fprintf(w, "<h2>%s (%s)</h2>", module.Name, module.ID)
			fmt.Fprintf(w, "<p>%s</p>", module.Description)
			fmt.Fprintf(w, "<p>Widget: %s</p>", module.Widget.Type)
			widgetData := fetchWidgetData(module.GrpcAddr)
			fmt.Fprintf(w, "<pre>%s</pre>", widgetData)
		}
		fmt.Fprintln(w, "</body></html>")
	})

	log.Printf("hub http listening on %s", httpAddr)
	if err := http.ListenAndServe(httpAddr, nil); err != nil {
		log.Fatalf("http server error: %v", err)
	}
}

func fetchWidgetData(addr string) string {
	if addr == "" {
		return "grpc_addr is not set in manifest"
	}

	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return fmt.Sprintf("dial error: %v", err)
	}
	defer conn.Close()

	client := pb.NewModuleServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := client.GetWidgetData(ctx, &pb.WidgetRequest{WidgetId: "default"})
	if err != nil {
		return fmt.Sprintf("GetWidgetData error: %v", err)
	}

	return fmt.Sprintf("type: %s\npayload: %s", resp.WidgetType, string(resp.Data))
}

func getEnv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func runtimeOS() string {
	return runtime.GOOS
}

func runtimeArch() string {
	return runtime.GOARCH
}
