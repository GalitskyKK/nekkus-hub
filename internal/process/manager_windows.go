//go:build windows

package process

import (
	"os/exec"
	"syscall"
)

// setModuleProcessAttrs на Windows скрывает консоль дочернего процесса (HideWindow),
// кроме Gate: для Gate не выставляем флаги, чтобы процесс гарантированно наследовал
// повышенные права от Hub (иначе смена DNS не срабатывает даже при запуске Hub от админа).
func setModuleProcessAttrs(cmd *exec.Cmd, moduleID string) {
	if cmd == nil {
		return
	}
	if moduleID == "com.nekkus.gate" || moduleID == "gate" {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}
