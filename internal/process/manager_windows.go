//go:build windows

package process

import (
	"os/exec"
	"syscall"
)

// setModuleProcessAttrs на Windows скрывает окно консоли дочернего процесса (HideWindow).
func setModuleProcessAttrs(cmd *exec.Cmd, moduleID string) {
	if cmd != nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
}
