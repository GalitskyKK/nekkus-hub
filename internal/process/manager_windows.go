//go:build windows

package process

import (
	"os/exec"
	"syscall"
)

// setModuleProcessAttrs скрывает окно консоли при запуске модуля из Hub (Windows).
func setModuleProcessAttrs(cmd *exec.Cmd) {
	if cmd != nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	}
}
