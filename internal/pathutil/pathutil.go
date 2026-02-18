package pathutil

import (
	"fmt"
	"os"
	"path/filepath"
)

// DirExists returns true if path exists and is a directory.
func DirExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// FileExists returns true if path exists and is a regular file.
func FileExists(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return !info.IsDir()
}

// ResolveModulesDir resolves the modules directory: uses input if non-empty and exists,
// otherwise uses "modules" next to the executable if available.
func ResolveModulesDir(input string) (string, error) {
	exe, exeErr := os.Executable()
	if exeErr != nil {
		exe = ""
	}
	exeDirModules := ""
	if exe != "" {
		exeDirModules = filepath.Join(filepath.Dir(exe), "modules")
	}

	if input == "" {
		if exeDirModules == "" {
			return "", fmt.Errorf("modules dir is empty and executable path unknown")
		}
		return exeDirModules, nil
	}
	abs, err := filepath.Abs(input)
	if err != nil {
		return "", err
	}
	if DirExists(abs) {
		return abs, nil
	}
	if exeDirModules != "" && DirExists(exeDirModules) {
		return exeDirModules, nil
	}
	return abs, nil
}
