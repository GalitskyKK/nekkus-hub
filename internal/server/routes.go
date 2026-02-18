package server

import (
	"log"
	"net/http"

	coreserver "github.com/GalitskyKK/nekkus-core/pkg/server"
	"github.com/GalitskyKK/nekkus-hub/internal/api"
)

// RegisterRoutes регистрирует Hub API на srv.Mux.
func RegisterRoutes(srv *coreserver.Server, cfg api.ServerConfig) {
	srv.Mux.HandleFunc("GET /api/modules", func(w http.ResponseWriter, r *http.Request) {
		api.WriteJSON(w, http.StatusOK, cfg.Registry.ListModules())
	})

	srv.Mux.HandleFunc("GET /api/summary", func(w http.ResponseWriter, r *http.Request) {
		summaries := api.BuildModuleSummaries(cfg.Registry.ListModules(), cfg.ProcessManager)
		api.WriteJSON(w, http.StatusOK, summaries)
	})

	srv.Mux.HandleFunc("POST /api/scan", func(w http.ResponseWriter, r *http.Request) {
		if err := cfg.Registry.ScanModules(cfg.ModulesDir); err != nil {
			api.WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		api.WriteJSON(w, http.StatusOK, cfg.Registry.ListModules())
	})

	srv.Mux.HandleFunc("POST /api/modules/add", func(w http.ResponseWriter, r *http.Request) {
		moduleID, err := api.AddModuleFromMultipart(r, cfg.ModulesDir)
		if err != nil {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if err := cfg.Registry.ScanModules(cfg.ModulesDir); err != nil {
			log.Printf("rescan after add: %v", err)
		}
		api.WriteJSON(w, http.StatusOK, map[string]string{"ok": "true", "module_id": moduleID})
	})

	srv.Mux.HandleFunc("POST /api/modules/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		moduleID := r.PathValue("id")
		if moduleID == "" {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "invalid module route"})
			return
		}
		modManifest, ok := cfg.Registry.GetManifest(moduleID)
		if !ok {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "module not found"})
			return
		}
		if err := cfg.ProcessManager.StartModule(modManifest, cfg.ModulesDir, cfg.GRPCAddr, false, true); err != nil {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		api.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	srv.Mux.HandleFunc("POST /api/modules/{id}/open-ui", func(w http.ResponseWriter, r *http.Request) {
		moduleID := r.PathValue("id")
		if moduleID == "" {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "invalid module route"})
			return
		}
		modManifest, ok := cfg.Registry.GetManifest(moduleID)
		if !ok {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "module not found"})
			return
		}
		_ = cfg.ProcessManager.StopModule(modManifest)
		if err := cfg.ProcessManager.StartModule(modManifest, cfg.ModulesDir, cfg.GRPCAddr, true, false); err != nil {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		api.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})

	srv.Mux.HandleFunc("POST /api/modules/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		moduleID := r.PathValue("id")
		if moduleID == "" {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "invalid module route"})
			return
		}
		modManifest, ok := cfg.Registry.GetManifest(moduleID)
		if !ok {
			api.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "module not found"})
			return
		}
		if err := cfg.ProcessManager.StopModule(modManifest); err != nil {
			api.WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		api.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
	})
}
