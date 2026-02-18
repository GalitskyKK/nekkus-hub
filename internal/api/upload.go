package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const multipartMaxBytes = 32 << 20

// AddModuleFromMultipart parses multipart form where each part key is a relative path (e.g. "manifest.json", "nekkus-net.exe").
// manifest.json must be present; its "id" is used as the module folder name under modulesDir.
func AddModuleFromMultipart(r *http.Request, modulesDir string) (string, error) {
	if err := r.ParseMultipartForm(multipartMaxBytes); err != nil {
		return "", fmt.Errorf("parse form: %w", err)
	}
	defer r.MultipartForm.RemoveAll()

	files := r.MultipartForm.File
	if files["manifest.json"] == nil || len(files["manifest.json"]) == 0 {
		return "", fmt.Errorf("manifest.json is required")
	}
	manifestFile, err := files["manifest.json"][0].Open()
	if err != nil {
		return "", fmt.Errorf("open manifest: %w", err)
	}
	defer manifestFile.Close()
	manifestData, err := io.ReadAll(manifestFile)
	if err != nil {
		return "", fmt.Errorf("read manifest: %w", err)
	}
	var manifest struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return "", fmt.Errorf("invalid manifest.json: %w", err)
	}
	if manifest.ID == "" {
		return "", fmt.Errorf("manifest.json must contain \"id\"")
	}
	moduleDir := filepath.Join(modulesDir, manifest.ID)
	if err := os.MkdirAll(moduleDir, 0755); err != nil {
		return "", fmt.Errorf("create module dir: %w", err)
	}

	for key, headers := range files {
		if key == "" {
			continue
		}
		rel := filepath.FromSlash(key)
		if filepath.IsAbs(rel) || strings.Contains(rel, "..") {
			continue
		}
		clean := filepath.Clean(rel)
		if strings.HasPrefix(clean, "..") {
			continue
		}
		target := filepath.Join(moduleDir, clean)
		relPath, relErr := filepath.Rel(moduleDir, target)
		if relErr != nil || strings.Contains(relPath, "..") {
			continue
		}
		for _, h := range headers {
			f, openErr := h.Open()
			if openErr != nil {
				return "", fmt.Errorf("open %s: %w", key, openErr)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				_ = f.Close()
				return "", fmt.Errorf("mkdir for %s: %w", key, err)
			}
			dst, createErr := os.Create(target)
			if createErr != nil {
				_ = f.Close()
				return "", fmt.Errorf("create %s: %w", key, createErr)
			}
			_, copyErr := io.Copy(dst, f)
			_ = f.Close()
			_ = dst.Close()
			if copyErr != nil {
				return "", fmt.Errorf("write %s: %w", key, copyErr)
			}
			break
		}
	}
	return manifest.ID, nil
}
