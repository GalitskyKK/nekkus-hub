//go:build windows

package process

import (
	"fmt"
	"net"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/GalitskyKK/nekkus-hub/internal/manifest"
	"github.com/arduino/go-windows-runas"
)

// setModuleProcessAttrs на Windows скрывает окно консоли дочернего процесса (HideWindow),
// кроме Gate: Gate запускается через tryStartGateElevated (runas), здесь не вызывается.
func setModuleProcessAttrs(cmd *exec.Cmd, moduleID string) {
	if cmd == nil {
		return
	}
	if moduleID == "com.nekkus.gate" || moduleID == "gate" {
		return
	}
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

func isGate(moduleID string) bool {
	return moduleID == "com.nekkus.gate" || moduleID == "gate"
}

// tryStartGateElevated запускает Gate через UAC (runas), чтобы процесс получил права администратора.
// Возвращает (true, nil) при успехе, (false, nil) для fallback на обычный start, (false, err) при ошибке.
func tryStartGateElevated(m manifest.ModuleManifest, exePath, dataDir, hubAddr string, showUI, autoConnect bool, workDir string) (bool, error) {
	if !isGate(m.ID) {
		return false, nil
	}
	args := []string{
		"--mode=hub",
		"--hub-addr=" + hubAddr,
		"--addr=" + m.GrpcAddr,
		"--data-dir=" + dataDir,
	}
	_, err := runas.RunElevated(exePath, workDir, args, false)
	if err != nil {
		return false, fmt.Errorf("запуск Gate с правами администратора (UAC): %w", err)
	}
	if err := waitForTCP(m.GrpcAddr, 15*time.Second); err != nil {
		return false, fmt.Errorf("Gate не ответил по gRPC: %w", err)
	}
	return true, nil
}

// stopProcessByAddr находит процесс по порту из grpcAddr (127.0.0.1:19003) и завершает его.
func stopProcessByAddr(grpcAddr string) error {
	_, portStr, err := net.SplitHostPort(grpcAddr)
	if err != nil {
		return err
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port <= 0 {
		return fmt.Errorf("invalid grpc addr: %s", grpcAddr)
	}
	pid := findPIDByTCPPort(port)
	if pid <= 0 {
		return nil
	}
	return killPID(pid)
}

func findPIDByTCPPort(port int) int {
	cmd := exec.Command("netstat", "-ano", "-p", "TCP")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	suffix := ":" + strconv.Itoa(port)
	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		if !strings.Contains(line, "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		localAddr := fields[1]
		if !strings.HasSuffix(localAddr, suffix) {
			continue
		}
		pidStr := fields[len(fields)-1]
		pid, err := strconv.Atoi(pidStr)
		if err != nil || pid <= 0 {
			continue
		}
		return pid
	}
	return 0
}

func killPID(pid int) error {
	cmd := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/F")
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Run()
}
