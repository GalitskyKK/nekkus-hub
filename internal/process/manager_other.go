//go:build !windows

package process

import "os/exec"

func setModuleProcessAttrs(cmd *exec.Cmd, moduleID string) {}
