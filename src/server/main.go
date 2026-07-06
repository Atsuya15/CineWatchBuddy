package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"cinewatchbuddy-backend/database"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// CineWatchBuddy Backend Server with Persistent Storage
// Handles room management, WebSocket connections, and video sync with SQLite persistence

type Server struct {
	rooms      map[string]*Room
	clients    map[string]*websocket.Conn
	rateLimiter map[string]time.Time
	mutex      sync.RWMutex
	db         *database.Database
	config     *Config
}

type Config struct {
	Port            string
	DatabasePath    string
	MaxRooms        int
	MaxParticipants int
	CleanupInterval time.Duration
	InactiveTimeout time.Duration
}

type Room struct {
	ID           string                 `json:"id"`
	Name         string                 `json:"name"`
	Participants []*database.Participant `json:"participants"`
	CreatedAt    time.Time              `json:"createdAt"`
	LastActivity time.Time              `json:"lastActivity"`
	IsActive     bool                   `json:"isActive"`
	HostID       string                 `json:"hostId"`
	VideoState   *database.VideoState   `json:"videoState,omitempty"`
	ChatHistory  []*database.ChatMessage `json:"chatHistory,omitempty"`
}

type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type CreateRoomRequest struct {
	Username string `json:"username"`
	RoomName string `json:"roomName,omitempty"`
}

type JoinRoomRequest struct {
	RoomID   string `json:"roomId"`
	Username string `json:"username"`
}

type VideoSyncData struct {
	CurrentTime  float64 `json:"currentTime"`
	Paused       bool    `json:"paused"`
	PlaybackRate float64 `json:"playbackRate"`
	VideoURL     string  `json:"videoUrl"`
	Duration     float64 `json:"duration"`
}

type ChatMessageData struct {
	Username  string `json:"username"`
	Content   string `json:"content"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
}

type WebRTCData struct {
	To       string `json:"to"`
	RoomID   string `json:"roomId"`
	Offer    string `json:"offer,omitempty"`
	Answer   string `json:"answer,omitempty"`
	IceCandidate string `json:"iceCandidate,omitempty"`
}

func NewServer(config *Config) (*Server, error) {
	db, err := database.NewDatabase(config.DatabasePath)
	if err != nil {
		return nil, fmt.Errorf("failed to initialize database: %w", err)
	}

	server := &Server{
		rooms:       make(map[string]*Room),
		clients:     make(map[string]*websocket.Conn),
		rateLimiter: make(map[string]time.Time),
		db:          db,
		config:      config,
	}

	// Load existing rooms from database
	if err := server.loadRoomsFromDatabase(); err != nil {
		log.Printf("Warning: Failed to load rooms from database: %v", err)
	}

	// Start cleanup goroutine
	go server.startCleanup()

	return server, nil
}

func (s *Server) loadRoomsFromDatabase() error {
	rooms, err := s.db.GetAllActiveRooms()
	if err != nil {
		return err
	}

	for _, dbRoom := range rooms {
		participants, err := s.db.GetParticipants(dbRoom.ID)
		if err != nil {
			log.Printf("Failed to load participants for room %s: %v", dbRoom.ID, err)
			continue
		}

		chatHistory, err := s.db.GetChatHistory(dbRoom.ID, 100)
		if err != nil {
			log.Printf("Failed to load chat history for room %s: %v", dbRoom.ID, err)
			chatHistory = []*database.ChatMessage{}
		}

		videoState, err := s.db.GetVideoState(dbRoom.ID)
		if err != nil {
			log.Printf("Failed to load video state for room %s: %v", dbRoom.ID, err)
			videoState = &database.VideoState{}
		}

		room := &Room{
			ID:           dbRoom.ID,
			Name:         dbRoom.Name,
			Participants: participants,
			CreatedAt:    dbRoom.CreatedAt,
			LastActivity: dbRoom.LastActivity,
			IsActive:     dbRoom.IsActive,
			HostID:       dbRoom.HostID,
			VideoState:   videoState,
			ChatHistory:  chatHistory,
		}

		s.rooms[room.ID] = room
		log.Printf("Restored room %s with %d participants", room.ID, len(participants))
	}

	return nil
}

func (s *Server) startCleanup() {
	ticker := time.NewTicker(s.config.CleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		s.cleanupInactiveRooms()
		s.cleanupInactiveParticipants()
	}
}

func (s *Server) cleanupInactiveRooms() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	cutoff := time.Now().Add(-s.config.InactiveTimeout)
	for roomID, room := range s.rooms {
		if room.LastActivity.Before(cutoff) {
			log.Printf("Cleaning up inactive room: %s", roomID)
			s.db.DeleteRoom(roomID)
			delete(s.rooms, roomID)
		}
	}
}

func (s *Server) cleanupInactiveParticipants() {
	s.mutex.Lock()
	defer s.mutex.Unlock()

	cutoff := time.Now().Add(-s.config.InactiveTimeout)
	for _, room := range s.rooms {
		for _, participant := range room.Participants {
			if participant.LastSeen.Before(cutoff) {
				s.db.RemoveParticipant(participant.ID)
				participant.IsActive = false
			}
		}
	}
}

func (s *Server) Close() error {
	return s.db.Close()
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CreateRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.Username == "" {
		http.Error(w, "Username is required", http.StatusBadRequest)
		return
	}

	roomID := generateRoomID()
	roomName := req.RoomName
	if roomName == "" {
		roomName = fmt.Sprintf("Room %s", roomID[:8])
	}

	now := time.Now()
	room := &Room{
		ID:           roomID,
		Name:         roomName,
		Participants: []*database.Participant{},
		CreatedAt:    now,
		LastActivity: now,
		IsActive:     true,
		HostID:       "",
		VideoState:   &database.VideoState{},
		ChatHistory:  []*database.ChatMessage{},
	}

	// Create room in database
	dbRoom := &database.Room{
		ID:           roomID,
		Name:         roomName,
		CreatedAt:    now,
		LastActivity: now,
		IsActive:     true,
		HostID:       "",
		VideoState:   "{}",
		ChatHistory:  "[]",
	}

	if err := s.db.CreateRoom(dbRoom); err != nil {
		log.Printf("Failed to create room in database: %v", err)
		http.Error(w, "Failed to create room", http.StatusInternalServerError)
		return
	}

	s.mutex.Lock()
	s.rooms[roomID] = room
	s.mutex.Unlock()

	response := map[string]interface{}{
		"success":   true,
		"roomId":    roomID,
		"room":      room,
		"shareLink": fmt.Sprintf("http://localhost:%s/join?room=%s", s.config.Port, roomID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("Room created: %s by %s", roomID, req.Username)
}

func (s *Server) handleJoinRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req JoinRoomRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	if req.RoomID == "" || req.Username == "" {
		http.Error(w, "Room ID and username are required", http.StatusBadRequest)
		return
	}

	s.mutex.RLock()
	room, exists := s.rooms[req.RoomID]
	s.mutex.RUnlock()

	if !exists {
		// Try to load from database
		dbRoom, err := s.db.GetRoom(req.RoomID)
		if err != nil {
			http.Error(w, "Room not found", http.StatusNotFound)
			return
		}

		// Restore room
		participants, err := s.db.GetParticipants(req.RoomID)
		if err != nil {
			http.Error(w, "Failed to load room participants", http.StatusInternalServerError)
			return
		}

		chatHistory, err := s.db.GetChatHistory(req.RoomID, 100)
		if err != nil {
			chatHistory = []*database.ChatMessage{}
		}

		videoState, err := s.db.GetVideoState(req.RoomID)
		if err != nil {
			videoState = &database.VideoState{}
		}

		room = &Room{
			ID:           dbRoom.ID,
			Name:         dbRoom.Name,
			Participants: participants,
			CreatedAt:    dbRoom.CreatedAt,
			LastActivity: dbRoom.LastActivity,
			IsActive:     dbRoom.IsActive,
			HostID:       dbRoom.HostID,
			VideoState:   videoState,
			ChatHistory:  chatHistory,
		}

		s.mutex.Lock()
		s.rooms[req.RoomID] = room
		s.mutex.Unlock()
	}

	if len(room.Participants) >= s.config.MaxParticipants {
		http.Error(w, "Room is full", http.StatusForbidden)
		return
	}

	participantID := generateParticipantID()
	now := time.Now()

	participant := &database.Participant{
		ID:                participantID,
		RoomID:            req.RoomID,
		Username:          req.Username,
		JoinedAt:          now,
		LastSeen:          now,
		IsActive:          true,
		BrowserFingerprint: generateBrowserFingerprint(r),
		DeviceType:        getDeviceType(r),
	}

	if err := s.db.AddParticipant(participant); err != nil {
		log.Printf("Failed to add participant to database: %v", err)
		http.Error(w, "Failed to join room", http.StatusInternalServerError)
		return
	}

	s.mutex.Lock()
	room.Participants = append(room.Participants, participant)
	room.LastActivity = now
	if room.HostID == "" {
		room.HostID = participantID
	}
	s.mutex.Unlock()

	// Update room in database
	s.updateRoomInDatabase(room)

	response := map[string]interface{}{
		"success":   true,
		"roomId":    req.RoomID,
		"room":      room,
		"participantId": participantID,
		"shareLink": fmt.Sprintf("http://localhost:%s/join?room=%s", s.config.Port, req.RoomID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	log.Printf("User %s joined room %s", req.Username, req.RoomID)
}

func (s *Server) updateRoomInDatabase(room *Room) {
	videoStateJSON, _ := json.Marshal(room.VideoState)
	chatHistoryJSON, _ := json.Marshal(room.ChatHistory)

	dbRoom := &database.Room{
		ID:           room.ID,
		Name:         room.Name,
		CreatedAt:    room.CreatedAt,
		LastActivity: room.LastActivity,
		IsActive:     room.IsActive,
		HostID:       room.HostID,
		VideoState:   string(videoStateJSON),
		ChatHistory:  string(chatHistoryJSON),
	}

	if err := s.db.UpdateRoom(dbRoom); err != nil {
		log.Printf("Failed to update room in database: %v", err)
	}
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true // Allow all origins for development
		},
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	clientID := generateClientID()
	s.mutex.Lock()
	s.clients[clientID] = conn
	s.mutex.Unlock()

	log.Printf("WebSocket client connected: %s", clientID)

	// Start ping/pong
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go s.startPingPong(ctx, clientID, conn)

	// Handle messages
	for {
		var msg WebSocketMessage
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		s.handleWebSocketMessage(clientID, msg)
	}

	// Cleanup
	s.mutex.Lock()
	delete(s.clients, clientID)
	s.mutex.Unlock()
	log.Printf("WebSocket client disconnected: %s", clientID)
}

func (s *Server) handleWebSocketMessage(clientID string, msg WebSocketMessage) {
	switch msg.Type {
	case "join-room":
		s.handleJoinRoomWS(clientID, msg.Data)
	case "video-sync":
		s.handleVideoSync(clientID, msg.Data)
	case "chat-message":
		s.handleChatMessage(clientID, msg.Data)
	case "webrtc-offer":
		s.handleWebRTCOffer(clientID, msg.Data)
	case "webrtc-answer":
		s.handleWebRTCAnswer(clientID, msg.Data)
	case "webrtc-ice-candidate":
		s.handleWebRTCIceCandidate(clientID, msg.Data)
	case "ping":
		s.handlePing(clientID)
	default:
		log.Printf("Unknown message type: %s", msg.Type)
	}
}

func (s *Server) handleJoinRoomWS(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	username, _ := dataMap["username"].(string)

	if roomID == "" || username == "" {
		return
	}

	s.mutex.RLock()
	room, exists := s.rooms[roomID]
	s.mutex.RUnlock()

	if !exists {
		return
	}

	// Find participant
	var participant *database.Participant
	for _, p := range room.Participants {
		if p.Username == username && p.IsActive {
			participant = p
			break
		}
	}

	if participant == nil {
		return
	}

	// Update last seen
	participant.LastSeen = time.Now()
	s.db.UpdateParticipantLastSeen(participant.ID)

	// Send room state
	response := WebSocketMessage{
		Type: "room-joined",
		Data: map[string]interface{}{
			"room":           room,
			"participantId":  participant.ID,
			"currentVideo":   room.VideoState,
			"chatHistory":    room.ChatHistory,
		},
	}

	s.sendToClient(clientID, response)

	// Broadcast participant joined
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "participant-joined",
		Data: map[string]interface{}{
			"participant": participant,
		},
	})
}

func (s *Server) handleVideoSync(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	if roomID == "" {
		return
	}

	s.mutex.RLock()
	room, exists := s.rooms[roomID]
	s.mutex.RUnlock()

	if !exists {
		return
	}

	// Update video state
	videoState := &database.VideoState{
		CurrentTime:  getFloat64(dataMap, "currentTime"),
		Paused:       getBool(dataMap, "paused"),
		PlaybackRate: getFloat64(dataMap, "playbackRate"),
		VideoURL:     getString(dataMap, "videoUrl"),
		Duration:     getFloat64(dataMap, "duration"),
		LastUpdated:  time.Now(),
	}

	s.mutex.Lock()
	room.VideoState = videoState
	room.LastActivity = time.Now()
	s.mutex.Unlock()

	// Update database
	s.db.UpdateVideoState(roomID, videoState)

	// Broadcast to room
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "video-sync",
		Data: videoState,
	})
}

func (s *Server) handleChatMessage(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	username, _ := dataMap["username"].(string)
	content, _ := dataMap["content"].(string)
	msgType, _ := dataMap["type"].(string)

	if roomID == "" || username == "" || content == "" {
		return
	}

	if msgType == "" {
		msgType = "user"
	}

	// Create chat message
	message := &database.ChatMessage{
		ID:        generateMessageID(),
		RoomID:    roomID,
		Username:  username,
		Content:   content,
		Type:      msgType,
		Timestamp: time.Now(),
	}

	// Add to database
	if err := s.db.AddChatMessage(message); err != nil {
		log.Printf("Failed to add chat message to database: %v", err)
		return
	}

	s.mutex.RLock()
	room, exists := s.rooms[roomID]
	s.mutex.RUnlock()

	if exists {
		s.mutex.Lock()
		room.ChatHistory = append(room.ChatHistory, message)
		// Keep only last 100 messages
		if len(room.ChatHistory) > 100 {
			room.ChatHistory = room.ChatHistory[len(room.ChatHistory)-100:]
		}
		room.LastActivity = time.Now()
		s.mutex.Unlock()

		// Update database
		s.updateRoomInDatabase(room)
	}

	// Broadcast to room
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "chat-message",
		Data: message,
	})
}

func (s *Server) handleWebRTCOffer(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := dataMap["to"].(string)
	roomID, _ := dataMap["roomId"].(string)
	offer, _ := dataMap["offer"].(string)

	if to == "" || roomID == "" || offer == "" {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

	// Forward to target client
	s.sendToClient(to, WebSocketMessage{
		Type: "webrtc-offer",
		Data: map[string]interface{}{
			"from":  clientID,
			"offer": offer,
			"roomId": roomID,
		},
	})
}

func (s *Server) handleWebRTCAnswer(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := dataMap["to"].(string)
	roomID, _ := dataMap["roomId"].(string)
	answer, _ := dataMap["answer"].(string)

	if to == "" || roomID == "" || answer == "" {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

	// Forward to target client
	s.sendToClient(to, WebSocketMessage{
		Type: "webrtc-answer",
		Data: map[string]interface{}{
			"from":   clientID,
			"answer": answer,
			"roomId": roomID,
		},
	})
}

func (s *Server) handleWebRTCIceCandidate(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := dataMap["to"].(string)
	roomID, _ := dataMap["roomId"].(string)
	iceCandidate, _ := dataMap["iceCandidate"].(string)

	if to == "" || roomID == "" || iceCandidate == "" {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

	// Forward to target client
	s.sendToClient(to, WebSocketMessage{
		Type: "webrtc-ice-candidate",
		Data: map[string]interface{}{
			"from":         clientID,
			"iceCandidate": iceCandidate,
			"roomId":       roomID,
		},
	})
}

func (s *Server) handlePing(clientID string) {
	s.sendToClient(clientID, WebSocketMessage{
		Type: "pong",
		Data: map[string]interface{}{
			"timestamp": time.Now().Unix(),
		},
	})
}

func (s *Server) validateRoomAccess(roomID, clientID string) bool {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return false
	}

	// Check if client is a participant in the room
	for _, participant := range room.Participants {
		if participant.IsActive {
			// This is a simplified check - in production, you'd want to track client-to-participant mapping
			return true
		}
	}

	return false
}

func (s *Server) sendToClient(clientID string, msg WebSocketMessage) {
	s.mutex.RLock()
	conn, exists := s.clients[clientID]
	s.mutex.RUnlock()

	if !exists {
		return
	}

	if err := conn.WriteJSON(msg); err != nil {
		log.Printf("Failed to send message to client %s: %v", clientID, err)
	}
}

func (s *Server) broadcastToRoom(roomID string, msg WebSocketMessage) {
	s.mutex.RLock()
	room, exists := s.rooms[roomID]
	if !exists {
		s.mutex.RUnlock()
		return
	}

	// Get all active participants
	var activeParticipants []*database.Participant
	for _, participant := range room.Participants {
		if participant.IsActive {
			activeParticipants = append(activeParticipants, participant)
		}
	}
	s.mutex.RUnlock()

	// Send to all clients (simplified - in production, you'd track client-to-participant mapping)
	s.mutex.RLock()
	for clientID, conn := range s.clients {
		if err := conn.WriteJSON(msg); err != nil {
			log.Printf("Failed to broadcast to client %s: %v", clientID, err)
			// Remove disconnected client
			delete(s.clients, clientID)
		}
	}
	s.mutex.RUnlock()
}

func (s *Server) startPingPong(ctx context.Context, clientID string, conn *websocket.Conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Ping failed for client %s: %v", clientID, err)
				return
			}
		}
	}
}

// HTTP handlers
func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	roomID := r.URL.Query().Get("room")
	if roomID == "" {
		http.Error(w, "Room ID is required", http.StatusBadRequest)
		return
	}

	response := map[string]interface{}{
		"roomId": roomID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	response := map[string]interface{}{
		"status": "healthy",
		"rooms":  len(s.rooms),
		"clients": len(s.clients),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// Utility functions
func generateRoomID() string {
	return fmt.Sprintf("room_%d", time.Now().UnixNano())
}

func generateParticipantID() string {
	return fmt.Sprintf("participant_%d", time.Now().UnixNano())
}

func generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}

func generateMessageID() string {
	return fmt.Sprintf("msg_%d", time.Now().UnixNano())
}

func generateBrowserFingerprint(r *http.Request) string {
	userAgent := r.Header.Get("User-Agent")
	acceptLanguage := r.Header.Get("Accept-Language")
	return fmt.Sprintf("%x", len(userAgent)+len(acceptLanguage))
}

func getDeviceType(r *http.Request) string {
	userAgent := r.Header.Get("User-Agent")
	if strings.Contains(userAgent, "Mobile") {
		return "mobile"
	}
	return "desktop"
}

func getString(data map[string]interface{}, key string) string {
	if val, ok := data[key].(string); ok {
		return val
	}
	return ""
}

func getFloat64(data map[string]interface{}, key string) float64 {
	if val, ok := data[key].(float64); ok {
		return val
	}
	return 0
}

func getBool(data map[string]interface{}, key string) bool {
	if val, ok := data[key].(bool); ok {
		return val
	}
	return false
}

func main() {
	config := &Config{
		Port:            getEnv("PORT", "8080"),
		DatabasePath:    getEnv("DATABASE_PATH", "./cinewatchbuddy.db"),
		MaxRooms:        100,
		MaxParticipants: 15,
		CleanupInterval: 5 * time.Minute,
		InactiveTimeout: 1 * time.Hour,
	}

	server, err := NewServer(config)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}
	defer server.Close()

	// CORS configuration
	c := cors.New(cors.Options{
		AllowedOrigins: []string{
			"http://localhost:3000",
			"http://localhost:8080",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:8080",
		},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
		AllowCredentials: true,
	})

	// HTTP routes
	http.HandleFunc("/create-room", server.handleCreateRoom)
	http.HandleFunc("/join-room", server.handleJoinRoom)
	http.HandleFunc("/join", server.handleJoin)
	http.HandleFunc("/ws", server.handleWebSocket)
	http.HandleFunc("/health", server.handleHealth)

	// Serve static files
	http.Handle("/", http.FileServer(http.Dir("../web/dist")))

	// Start server
    log.Printf("Starting CineWatchBuddy server on port %s", config.Port)
	log.Printf("Database: %s", config.DatabasePath)
	log.Printf("Loaded %d rooms from database", len(server.rooms))

	if err := http.ListenAndServe(":"+config.Port, c.Handler(http.DefaultServeMux)); err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}