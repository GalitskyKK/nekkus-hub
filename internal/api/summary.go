package api

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"github.com/GalitskyKK/nekkus-hub/internal/manifest"
	"github.com/GalitskyKK/nekkus-hub/internal/process"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// ModuleSummary — ответ API по модулю с опциональными данными виджета.
type ModuleSummary struct {
	Manifest   manifest.ModuleManifest `json:"manifest"`
	WidgetType string                 `json:"widget_type,omitempty"`
	Payload    json.RawMessage         `json:"payload,omitempty"`
	Error      string                  `json:"error,omitempty"`
	Running    bool                    `json:"running"`
}

// BuildModuleSummaries строит summary по всем модулям, для запущенных запрашивает виджеты.
func BuildModuleSummaries(modules []manifest.ModuleManifest, manager *process.Manager) []ModuleSummary {
	summaries := make([]ModuleSummary, 0, len(modules))
	for _, module := range modules {
		summary := ModuleSummary{Manifest: module}
		summary.Running = manager.IsRunning(module.ID)
		if summary.Running {
			widgetType, payload, err := fetchWidgetData(module.GrpcAddr)
			if err != nil {
				summary.Error = err.Error()
			} else {
				summary.WidgetType = widgetType
				summary.Payload = payload
			}
		}
		summaries = append(summaries, summary)
	}
	return summaries
}

func fetchWidgetData(addr string) (string, json.RawMessage, error) {
	if addr == "" {
		return "", nil, fmt.Errorf("grpc_addr is not set in manifest")
	}

	conn, err := grpc.Dial(addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return "", nil, err
	}
	defer conn.Close()

	client := pb.NewNekkusModuleClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := client.GetWidgets(ctx, &pb.Empty{})
	if err != nil {
		return "", nil, err
	}

	widgets := resp.GetWidgets()
	if len(widgets) == 0 {
		return "", nil, nil
	}
	widgetType := widgets[0].GetId()
	if widgetType == "" {
		widgetType = widgets[0].GetTitle()
	}
	return widgetType, nil, nil
}
