package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	w0 := widgets[0]
	widgetType := w0.GetId()
	if widgetType == "" {
		widgetType = w0.GetTitle()
	}

	// Подставляем payload из HTTP модуля (например /api/status для Net).
	infoResp, err := client.GetInfo(ctx, &pb.Empty{})
	if err != nil {
		return widgetType, nil, nil
	}
	baseURL := infoResp.GetUiUrl()
	if baseURL == "" {
		return widgetType, nil, nil
	}
	endpoint := w0.GetDataEndpoint()
	if endpoint == "" {
		return widgetType, nil, nil
	}
	url := baseURL + endpoint
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return widgetType, nil, nil
	}
	httpClient := &http.Client{Timeout: 2 * time.Second}
	res, err := httpClient.Do(req)
	if err != nil {
		return widgetType, nil, nil
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return widgetType, nil, nil
	}
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return widgetType, nil, nil
	}
	return widgetType, body, nil
}
