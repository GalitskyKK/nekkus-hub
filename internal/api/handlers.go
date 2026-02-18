package api

import (
	"log"
	"net/http"
	"strings"

	"github.com/GalitskyKK/nekkus-hub/internal/process"
	"github.com/GalitskyKK/nekkus-hub/internal/registry"
)

// ServerConfig holds dependencies for HTTP handlers.
type ServerConfig struct {
	Registry       *registry.Registry
	ProcessManager *process.Manager
	ModulesDir     string
	GRPCAddr       string
}

// NewMux returns an http.ServeMux with all API routes registered.
func NewMux(cfg ServerConfig) *http.ServeMux {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/modules", func(w http.ResponseWriter, r *http.Request) {
		if ApplyCORS(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		WriteJSON(w, http.StatusOK, cfg.Registry.ListModules())
	})

	mux.HandleFunc("/api/summary", func(w http.ResponseWriter, r *http.Request) {
		if ApplyCORS(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		summaries := BuildModuleSummaries(cfg.Registry.ListModules(), cfg.ProcessManager)
		WriteJSON(w, http.StatusOK, summaries)
	})

	mux.HandleFunc("/api/scan", func(w http.ResponseWriter, r *http.Request) {
		if ApplyCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		if err := cfg.Registry.ScanModules(cfg.ModulesDir); err != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		WriteJSON(w, http.StatusOK, cfg.Registry.ListModules())
	})

	mux.HandleFunc("/api/modules/add", func(w http.ResponseWriter, r *http.Request) {
		if ApplyCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		moduleID, err := AddModuleFromMultipart(r, cfg.ModulesDir)
		if err != nil {
			WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := cfg.Registry.ScanModules(cfg.ModulesDir); err != nil {
			log.Printf("rescan after add: %v", err)
		}
		WriteJSON(w, http.StatusOK, map[string]string{"ok": "true", "module_id": moduleID})
	})

	mux.HandleFunc("/api/modules/", func(w http.ResponseWriter, r *http.Request) {
		if ApplyCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			WriteJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/api/modules/")
		parts := strings.Split(strings.Trim(path, "/"), "/")
		if len(parts) != 2 {
			WriteJSON(w, http.StatusNotFound, map[string]string{"error": "invalid module route"})
			return
		}
		moduleID := parts[0]
		action := parts[1]

		modManifest, ok := cfg.Registry.GetManifest(moduleID)
		if !ok {
			WriteJSON(w, http.StatusNotFound, map[string]string{"error": "module not found"})
			return
		}

		switch action {
		case "start":
			if err := cfg.ProcessManager.StartModule(modManifest, cfg.ModulesDir, cfg.GRPCAddr, false, true); err != nil {
				WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		case "open-ui":
			_ = cfg.ProcessManager.StopModule(modManifest)
			if err := cfg.ProcessManager.StartModule(modManifest, cfg.ModulesDir, cfg.GRPCAddr, true, false); err != nil {
				WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		case "stop":
			if err := cfg.ProcessManager.StopModule(modManifest); err != nil {
				WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
				return
			}
		default:
			WriteJSON(w, http.StatusNotFound, map[string]string{"error": "unknown action"})
			return
		}

		WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	return mux
}
