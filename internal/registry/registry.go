package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/GalitskyKK/nekkus-hub/internal/manifest"
)

type registeredEntry struct {
	ID           string
	Version      string
	PID          int32
	RegisteredAt time.Time
}

// Registry holds discovered module manifests and runtime registrations from modules.
type Registry struct {
	mu         sync.RWMutex
	manifests  map[string]manifest.ModuleManifest
	registered map[string]registeredEntry
}

// New creates a new Registry.
func New() *Registry {
	return &Registry{
		manifests:  make(map[string]manifest.ModuleManifest),
		registered: make(map[string]registeredEntry),
	}
}

// ScanModules discovers manifest.json in each subdirectory of modulesDir and updates manifests.
func (r *Registry) ScanModules(modulesDir string) error {
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

		var m manifest.ModuleManifest
		if unmarshalErr := json.Unmarshal(data, &m); unmarshalErr != nil {
			continue
		}

		if m.ID == "" {
			continue
		}

		r.mu.Lock()
		r.manifests[m.ID] = m
		r.mu.Unlock()
	}

	return nil
}

// RegisterModule records a module registration (called from gRPC HubService).
func (r *Registry) RegisterModule(moduleID, version string, pid int32) {
	r.mu.Lock()
	r.registered[moduleID] = registeredEntry{
		ID:           moduleID,
		Version:      version,
		PID:          pid,
		RegisteredAt: time.Now(),
	}
	r.mu.Unlock()
}

// ListModules returns a copy of all discovered manifests.
func (r *Registry) ListModules() []manifest.ModuleManifest {
	r.mu.RLock()
	defer r.mu.RUnlock()

	modules := make([]manifest.ModuleManifest, 0, len(r.manifests))
	for _, m := range r.manifests {
		modules = append(modules, m)
	}
	return modules
}

// GetManifest returns the manifest for the given module ID.
func (r *Registry) GetManifest(id string) (manifest.ModuleManifest, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.manifests[id]
	return m, ok
}
