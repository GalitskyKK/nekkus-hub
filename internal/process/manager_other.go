//go:build !windows

package process

import (
	"os/exec"

	"github.com/GalitskyKK/nekkus-hub/internal/manifest"
)

func setModuleProcessAttrs(cmd *exec.Cmd, moduleID string) {}

func tryStartGateElevated(m manifest.ModuleManifest, exePath, dataDir, hubAddr string, showUI, autoConnect bool, workDir string) (bool, error) {
	return false, nil
}

func stopProcessByAddr(grpcAddr string) error {
	return nil
}
