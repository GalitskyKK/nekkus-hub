package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

// GetModuleBaseURL возвращает HTTP base URL модуля (UiUrl из GetInfo) по gRPC-адресу.
func GetModuleBaseURL(grpcAddr string) (string, error) {
	if grpcAddr == "" {
		return "", fmt.Errorf("grpc_addr is empty")
	}
	conn, err := grpc.Dial(grpcAddr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return "", err
	}
	defer conn.Close()
	client := pb.NewNekkusModuleClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	resp, err := client.GetInfo(ctx, &pb.Empty{})
	if err != nil {
		return "", err
	}
	baseURL := resp.GetUiUrl()
	if baseURL == "" {
		return "", fmt.Errorf("module UiUrl is empty")
	}
	return baseURL, nil
}

// NetConnect вызывает POST /api/connect у модуля net с указанным сервером.
func NetConnect(baseURL, server string) error {
	body := map[string]string{"server": server}
	if server == "" {
		return fmt.Errorf("server is required")
	}
	jsonBody, _ := json.Marshal(body)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/connect", bytes.NewReader(jsonBody))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("connect failed: %s", string(b))
	}
	return nil
}

// NetDisconnect вызывает POST /api/disconnect у модуля net.
func NetDisconnect(baseURL string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+"/api/disconnect", nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("disconnect failed: %s", string(b))
	}
	return nil
}
