package manifest

// WidgetConfig describes the widget section of a module manifest.
type WidgetConfig struct {
	Type           string `json:"type"`
	Component      string `json:"component"`
	Height         int    `json:"height"`
	UpdateInterval string `json:"update_interval"`
	SupportsResize bool   `json:"supports_resize"`
}

// ModuleManifest is the parsed manifest.json of a module.
type ModuleManifest struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Version     string            `json:"version"`
	Widget      WidgetConfig      `json:"widget"`
	GrpcAddr    string            `json:"grpc_addr"`
	Executable  map[string]string `json:"executable"`
	Config      *struct {
		StoragePath string `json:"storage_path"`
	} `json:"config"`
}
