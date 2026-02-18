package hubgrpc

import (
	"context"

	pb "github.com/GalitskyKK/nekkus-core/pkg/protocol"
	"github.com/GalitskyKK/nekkus-hub/internal/registry"
	"google.golang.org/grpc"
)

// Server реализует pb.NekkusHubServer для вызовов модуль → hub.
type Server struct {
	pb.UnimplementedNekkusHubServer
	registry *registry.Registry
}

// NewServer создаёт gRPC-сервер Hub с данным registry.
func NewServer(reg *registry.Registry) *Server {
	return &Server{registry: reg}
}

// Register регистрирует модуль в registry.
func (s *Server) Register(ctx context.Context, req *pb.ModuleInfo) (*pb.RegisterResponse, error) {
	pid := int32(0)
	s.registry.RegisterModule(req.GetId(), req.GetVersion(), pid)
	return &pb.RegisterResponse{
		Success: true,
		HubId:   "hub",
		Config:  map[string]string{"logging": "true", "notifications": "true"},
	}, nil
}

// PublishEvent — заглушка.
func (s *Server) PublishEvent(ctx context.Context, req *pb.DataEvent) (*pb.PublishResponse, error) {
	return &pb.PublishResponse{Success: true}, nil
}

// SubscribeEvents — заглушка.
func (s *Server) SubscribeEvents(_ *pb.SubscribeRequest, _ grpc.ServerStreamingServer[pb.DataEvent]) error {
	return nil
}

// CrossQuery — заглушка.
func (s *Server) CrossQuery(ctx context.Context, req *pb.CrossQueryRequest) (*pb.QueryResponse, error) {
	return &pb.QueryResponse{}, nil
}

// CrossExecute — заглушка.
func (s *Server) CrossExecute(ctx context.Context, req *pb.CrossExecuteRequest) (*pb.ExecuteResponse, error) {
	return &pb.ExecuteResponse{Success: false, Error: "not implemented"}, nil
}
