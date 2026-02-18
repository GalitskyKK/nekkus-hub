package process

import (
	"context"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"github.com/GalitskyKK/nekkus-hub/internal/manifest"
	"github.com/GalitskyKK/nekkus-hub/internal/pathutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// Manager manages module process lifecycle.
type Manager struct {
	mu        sync.RWMutex
	processes map[string]*exec.Cmd
}

// NewManager creates a new process Manager.
func NewManager() *Manager {
	return &Manager{
		processes: make(map[string]*exec.Cmd),
	}
}

// IsRunning reports whether the module is currently running.
func (m *Manager) IsRunning(moduleID string) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	cmd := m.processes[moduleID]
	if cmd == nil || cmd.Process == nil {
		return false
	}
	return cmd.ProcessState == nil || !cmd.ProcessState.Exited()
}

// StartModule starts the module process; showUI opens standalone UI, autoConnect enables hub connection.
func (m *Manager) StartModule(manifest manifest.ModuleManifest, modulesDir, hubAddr string, showUI bool, autoConnect bool) error {
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

// StopModule stops the module process.
func (m *Manager) StopModule(manifest manifest.ModuleManifest) error {
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

func resolveExecutablePath(manifest manifest.ModuleManifest, modulesDir string, requireRelease bool) (string, error) {
	if manifest.Executable == nil {
		return "", fmt.Errorf("executable is not configured for %s", manifest.ID)
	}
	exeName := manifest.Executable[runtime.GOOS]
	if exeName == "" {
		return "", fmt.Errorf("executable for %s is not set for %s", manifest.ID, runtime.GOOS)
	}

	moduleDir := filepath.Join(modulesDir, manifest.ID)
	candidate := filepath.Join(moduleDir, exeName)
	if pathutil.FileExists(candidate) {
		return candidate, nil
	}

	if manifest.ID == "com.nekkus.net" {
		// nekkus-hub и nekkus-net — соседи в nekkus/; modulesDir = nekkus-hub/modules → ../.. = nekkus
		repoBase := filepath.Clean(filepath.Join(modulesDir, "..", "..", "nekkus-net"))
		rootCandidate := filepath.Join(repoBase, exeName)
		if pathutil.FileExists(rootCandidate) {
			return rootCandidate, nil
		}
		buildCandidate := filepath.Join(repoBase, "build", "bin", exeName)
		if pathutil.FileExists(buildCandidate) {
			return buildCandidate, nil
		}
		binCandidate := filepath.Join(repoBase, "bin", exeName)
		if pathutil.FileExists(binCandidate) {
			return binCandidate, nil
		}
		if requireRelease {
			return "", fmt.Errorf("release build not found for %s; run: cd nekkus-net && go build -o %s ./cmd", manifest.ID, exeName)
		}
	}

	return "", fmt.Errorf("executable not found for %s", manifest.ID)
}

// netModuleDataDir возвращает тот же каталог данных, что и nekkus-net при standalone
// (%APPDATA%/nekkus/net и т.п.), чтобы подписки и серверы были общими.
func netModuleDataDir() string {
	var base string
	switch runtime.GOOS {
	case "windows":
		base = os.Getenv("APPDATA")
	case "darwin":
		base = filepath.Join(os.Getenv("HOME"), "Library", "Application Support")
	default:
		base = filepath.Join(os.Getenv("HOME"), ".config")
	}
	dir := filepath.Join(base, "nekkus", "net")
	_ = os.MkdirAll(dir, 0o755)
	return dir
}

func resolveModuleDataDir(manifest manifest.ModuleManifest, modulesDir string) string {
	if manifest.ID == "com.nekkus.net" {
		return netModuleDataDir()
	}
	dataDir := filepath.Join(modulesDir, manifest.ID, "data")
	if manifest.Config != nil && manifest.Config.StoragePath != "" {
		dataDir = filepath.Join(modulesDir, manifest.ID, manifest.Config.StoragePath)
	}
	return dataDir
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
	if showUI {
		env = append(env, "NEKKUS_SINGBOX_LOG=file")
	} else {
		env = append(env, "NEKKUS_SINGBOX_LOG=none")
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

	client := pb.NewNekkusModuleClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	_, err = client.Execute(ctx, &pb.ExecuteRequest{ActionId: "disconnect"})
	return err
}
