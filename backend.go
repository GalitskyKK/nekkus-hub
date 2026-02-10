package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Version     string            `json:"version"`
	Widget      widgetConfig      `json:"widget"`
	GrpcAddr    string            `json:"grpc_addr"`
	Executable  map[string]string `json:"executable"`
	Config      *struct {
		StoragePath string `json:"storage_path"`
	} `json:"config"`
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

func (r *moduleRegistry) getManifest(id string) (moduleManifest, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	manifest, ok := r.manifests[id]
	return manifest, ok
}

type moduleSummary struct {
	Manifest   moduleManifest  `json:"manifest"`
	WidgetType string          `json:"widget_type,omitempty"`
	Payload    json.RawMessage `json:"payload,omitempty"`
	Error      string          `json:"error,omitempty"`
	Running    bool            `json:"running"`
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

type BackendOptions struct {
	GRPCAddr   string
	HTTPAddr   string
	ModulesDir string
}

func RunHubBackend(options BackendOptions) (*grpc.Server, error) {
	modulesDir, err := filepath.Abs(options.ModulesDir)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve modules dir: %w", err)
	}

	registry := newRegistry()
	if err := registry.scanModules(modulesDir); err != nil {
		log.Printf("module scan error: %v", err)
	}
	processManager := newProcessManager()

	grpcListener, err := net.Listen("tcp", options.GRPCAddr)
	if err != nil {
		return nil, err
	}

	grpcServer := grpc.NewServer()
	pb.RegisterHubServiceServer(grpcServer, &hubServer{registry: registry})

	go func() {
		log.Printf("hub gRPC listening on %s", options.GRPCAddr)
		if serveErr := grpcServer.Serve(grpcListener); serveErr != nil {
			log.Fatalf("grpc server error: %v", serveErr)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/api/modules", func(w http.ResponseWriter, r *http.Request) {
		if applyCORS(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writeJSON(w, http.StatusOK, registry.listModules())
	})
	mux.HandleFunc("/api/summary", func(w http.ResponseWriter, r *http.Request) {
		if applyCORS(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		summaries := buildModuleSummaries(registry.listModules(), processManager)
		writeJSON(w, http.StatusOK, summaries)
	})
	mux.HandleFunc("/api/scan", func(w http.ResponseWriter, r *http.Request) {
		if applyCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if err := registry.scanModules(modulesDir); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, registry.listModules())
	})
	mux.HandleFunc("/api/modules/", func(w http.ResponseWriter, r *http.Request) {
		if applyCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/modules/")
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) != 2 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "invalid module route"})
			return
		}
		moduleID := parts[0]
		action := parts[1]

		manifest, ok := registry.getManifest(moduleID)
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "module not found"})
			return
		}

		switch action {
		case "start":
			if err := processManager.StartModule(manifest, modulesDir, options.GRPCAddr, false, true); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		case "open-ui":
			_ = processManager.StopModule(manifest)
			if err := processManager.StartModule(manifest, modulesDir, options.GRPCAddr, true, false); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		case "stop":
			if err := processManager.StopModule(manifest); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown action"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	go func() {
		log.Printf("hub http listening on %s", options.HTTPAddr)
		if err := http.ListenAndServe(options.HTTPAddr, mux); err != nil {
			log.Fatalf("http server error: %v", err)
		}
	}()

	return grpcServer, nil
}

func runtimeOS() string {
	return runtime.GOOS
}

func runtimeArch() string {
	return runtime.GOARCH
}

func buildModuleSummaries(modules []moduleManifest, manager *processManager) []moduleSummary {
	summaries := make([]moduleSummary, 0, len(modules))
	for _, module := range modules {
		summary := moduleSummary{Manifest: module}
		summary.Running = manager.IsRunning(module.ID)
		if summary.Running {
			widgetType, payload, err := fetchWidgetData(module.GrpcAddr)
			if err != nil {
				summary.Error = err.Error()
			} else {
				summary.WidgetType = widgetType
				summary.Payload = payload
			}
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

func fetchWidgetData(addr string) (string, json.RawMessage, error) {
	if addr == "" {
		return "", nil, fmt.Errorf("grpc_addr is not set in manifest")
	}

	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return "", nil, err
	}
	defer conn.Close()

	client := pb.NewModuleServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := client.GetWidgetData(ctx, &pb.WidgetRequest{WidgetId: "default"})
	if err != nil {
		return "", nil, err
	}

	return resp.WidgetType, json.RawMessage(resp.Data), nil
}

func writeJSON(w http.ResponseWriter, status int, payload interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func applyCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return true
	}

	return false
}

type processManager struct {
	mu        sync.RWMutex
	processes map[string]*exec.Cmd
}

func newProcessManager() *processManager {
	return &processManager{
		processes: make(map[string]*exec.Cmd),
	}
}

func (m *processManager) IsRunning(moduleID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cmd := m.processes[moduleID]
	if cmd == nil || cmd.Process == nil {
		return false
	}
	return cmd.ProcessState == nil || !cmd.ProcessState.Exited()
}

func (m *processManager) StartModule(manifest moduleManifest, modulesDir, hubAddr string, showUI bool, autoConnect bool) error {
	if manifest.ID == "" {
		return fmt.Errorf("module id is required")
	}
	if manifest.GrpcAddr == "" {
		return fmt.Errorf("grpc_addr is required for %s", manifest.ID)
	}

	m.mu.RLock()
	if cmd := m.processes[manifest.ID]; cmd != nil && cmd.Process != nil && (cmd.ProcessState == nil || !cmd.ProcessState.Exited()) {
		m.mu.RUnlock()
		return nil
	}
	m.mu.RUnlock()

	exePath, err := resolveExecutablePath(manifest, modulesDir, showUI)
	if err != nil {
		return err
	}

	dataDir := resolveModuleDataDir(manifest, modulesDir)

	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("failed to create data dir: %w", err)
	}

	cmd := exec.Command(
		exePath,
		"--mode=hub",
		"--hub-addr="+hubAddr,
		"--addr="+manifest.GrpcAddr,
		"--data-dir="+dataDir,
	)

	moduleDir := filepath.Join(modulesDir, manifest.ID)
	if stat, statErr := os.Stat(moduleDir); statErr == nil && stat.IsDir() {
		cmd.Dir = moduleDir
	} else {
		cmd.Dir = filepath.Dir(exePath)
	}
	cmd.Env = buildModuleEnv(hubAddr, showUI, autoConnect)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return err
	}

	m.mu.Lock()
	m.processes[manifest.ID] = cmd
	m.mu.Unlock()

	if err := waitForTCP(manifest.GrpcAddr, 5*time.Second); err != nil {
		_ = cmd.Process.Kill()
		return err
	}

	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		delete(m.processes, manifest.ID)
		m.mu.Unlock()
	}()

	return nil
}

func (m *processManager) StopModule(manifest moduleManifest) error {
	m.mu.Lock()
	cmd := m.processes[manifest.ID]
	if cmd == nil || cmd.Process == nil {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()

	_ = tryDisconnectModule(manifest.GrpcAddr)
	time.Sleep(500 * time.Millisecond)

	m.mu.Lock()
	defer m.mu.Unlock()
	cmd = m.processes[manifest.ID]
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	_ = cmd.Process.Kill()
	delete(m.processes, manifest.ID)
	return nil
}

func resolveExecutablePath(manifest moduleManifest, modulesDir string, requireRelease bool) (string, error) {
	if manifest.Executable == nil {
		return "", fmt.Errorf("executable is not configured for %s", manifest.ID)
	}
	exeName := manifest.Executable[runtime.GOOS]
	if exeName == "" {
		return "", fmt.Errorf("executable for %s is not set for %s", manifest.ID, runtime.GOOS)
	}

	moduleDir := filepath.Join(modulesDir, manifest.ID)
	candidate := filepath.Join(moduleDir, exeName)
	if fileExists(candidate) {
		return candidate, nil
	}

	if manifest.ID == "com.nekkus.vpn" {
		buildCandidate := filepath.Clean(filepath.Join(modulesDir, "..", "nekkus-vpn", "build", "bin", exeName))
		if fileExists(buildCandidate) {
			return buildCandidate, nil
		}
		releaseCandidate := filepath.Clean(filepath.Join(modulesDir, "..", "nekkus-vpn", "bin", exeName))
		if fileExists(releaseCandidate) {
			return releaseCandidate, nil
		}
		if requireRelease {
			return "", fmt.Errorf("release build not found for %s; run wails3 build in nekkus-vpn", manifest.ID)
		}
		devCandidate := filepath.Clean(filepath.Join(modulesDir, "..", "nekkus-vpn", "bin", exeName))
		if fileExists(devCandidate) {
			return devCandidate, nil
		}
	}

	return "", fmt.Errorf("executable not found for %s", manifest.ID)
}

func resolveModuleDataDir(manifest moduleManifest, modulesDir string) string {
	dataDir := filepath.Join(modulesDir, manifest.ID, "data")
	if manifest.Config != nil && manifest.Config.StoragePath != "" {
		dataDir = filepath.Join(modulesDir, manifest.ID, manifest.Config.StoragePath)
	}

	if manifest.ID == "com.nekkus.vpn" {
		repoData := filepath.Clean(filepath.Join(modulesDir, "..", "nekkus-vpn", "data"))
		if dirExists(repoData) {
			return repoData
		}
	}

	return dataDir
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

func waitForTCP(addr string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", addr, 300*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}
	return fmt.Errorf("grpc not ready at %s", addr)
}

func buildModuleEnv(hubAddr string, showUI bool, autoConnect bool) []string {
	env := make([]string, 0, len(os.Environ())+2)
	for _, item := range os.Environ() {
		key := strings.SplitN(item, "=", 2)[0]
		if strings.HasPrefix(key, "WAILS") || strings.HasPrefix(key, "VITE") {
			continue
		}
		env = append(env, item)
	}
	env = append(env, "NEKKUS_HUB_ADDR="+hubAddr)
	if showUI {
		env = append(env, "NEKKUS_SHOW_UI=1")
	} else {
		env = append(env, "NEKKUS_SHOW_UI=0")
	}
	if autoConnect {
		env = append(env, "NEKKUS_AUTO_CONNECT=1")
	} else {
		env = append(env, "NEKKUS_AUTO_CONNECT=0")
	}
	env = append(env, "WAILS_ENV=production")
	env = append(env, "WAILS_DEV_SERVER_URL=")
	env = append(env, "WAILS_VITE_DEV_SERVER_URL=")
	env = append(env, "WAILS_DEVSERVER_URL=")
	env = append(env, "VITE_DEV_SERVER_URL=")
	return env
}

func tryDisconnectModule(addr string) error {
	if addr == "" {
		return nil
	}
	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return err
	}
	defer conn.Close()

	client := pb.NewModuleServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err = client.ExecuteAction(ctx, &pb.ActionRequest{ActionId: "disconnect"})
	return err
}
