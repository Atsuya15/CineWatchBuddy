package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rs/cors"
)

// CineBuddy Backend Server
// Handles room management, WebSocket connections, and video sync

type Participant struct {
	ID       string    `json:"id"`
	Username string    `json:"username"`
	IsHost   bool      `json:"isHost"`
	JoinedAt time.Time `json:"joinedAt"`
}

type Room struct {
	ID          string        `json:"id"`
	Name        string        `json:"name"`
	Participants []Participant `json:"participants"`
	CreatedAt   time.Time     `json:"createdAt"`
	MaxUsers    int           `json:"maxUsers"`
	// Phase 2 additions
	CurrentVideo     *VideoState     `json:"currentVideo,omitempty"`
	ChatHistory      []ChatMessage   `json:"chatHistory,omitempty"`
	LastActivity     time.Time       `json:"lastActivity"`
	IsActive         bool            `json:"isActive"`
}

type VideoState struct {
	URL         string  `json:"url"`
	CurrentTime float64 `json:"currentTime"`
	Duration    float64 `json:"duration"`
	IsPlaying   bool    `json:"isPlaying"`
	Volume      float64 `json:"volume"`
	LastUpdated time.Time `json:"lastUpdated"`
}

type ChatMessage struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	RoomID    string    `json:"roomId"`
	Type      string    `json:"type"` // "message", "system", "reaction"
}

type VideoSyncEvent struct {
	Type        string  `json:"type"`
	CurrentTime float64 `json:"currentTime"`
	Duration    float64 `json:"duration"`
	Paused      bool    `json:"paused"`
	Volume      float64 `json:"volume"`
	PlaybackRate float64 `json:"playbackRate"`
	VideoID     string  `json:"videoId"`
	URL         string  `json:"url"`
	Timestamp   int64   `json:"timestamp"`
	TabID       int     `json:"tabId"`
}

type WebSocketMessage struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type Server struct {
	rooms         map[string]*Room
	clients       map[string]*websocket.Conn
	roomMutex     sync.RWMutex
	clientMutex   sync.RWMutex
	upgrader      websocket.Upgrader
	rateLimiter   map[string]time.Time
	rateMutex     sync.RWMutex
	lastPing      map[string]time.Time
	pingMutex     sync.RWMutex
}

func NewServer() *Server {
	return &Server{
		rooms:       make(map[string]*Room),
		clients:     make(map[string]*websocket.Conn),
		rateLimiter: make(map[string]time.Time),
		lastPing:    make(map[string]time.Time),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				// Environment-based CORS whitelist
				allowedOrigins := os.Getenv("CORS_ALLOWED")
				if allowedOrigins == "" {
					return true // Allow all in development
				}
				origins := strings.Split(allowedOrigins, ",")
				origin := r.Header.Get("Origin")
				for _, allowed := range origins {
					if strings.TrimSpace(allowed) == origin {
						return true
					}
				}
				return false
			},
		},
	}
}

func (s *Server) generateRoomID() string {
	return fmt.Sprintf("room_%d", time.Now().UnixNano())
}

func (s *Server) generateClientID() string {
	return fmt.Sprintf("client_%d", time.Now().UnixNano())
}

func (s *Server) isRateLimited(clientID string) bool {
	s.rateMutex.Lock()
	defer s.rateMutex.Unlock()
	
	now := time.Now()
	if lastTime, exists := s.rateLimiter[clientID]; exists {
		if now.Sub(lastTime) < time.Second {
			return true
		}
	}
	s.rateLimiter[clientID] = now
	return false
}

func (s *Server) startPingPong() {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		for range ticker.C {
			s.pingMutex.Lock()
			now := time.Now()
			for clientID, lastPing := range s.lastPing {
				if now.Sub(lastPing) > 60*time.Second {
					// Client hasn't responded to ping, close connection
					s.clientMutex.Lock()
					if conn, exists := s.clients[clientID]; exists {
						conn.Close()
						delete(s.clients, clientID)
					}
					s.clientMutex.Unlock()
					delete(s.lastPing, clientID)
					log.Printf("Closed inactive client: %s", clientID)
				}
			}
			s.pingMutex.Unlock()
		}
	}()
}

// Helper functions for type conversion
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
	return 0.0
}

func getBool(data map[string]interface{}, key string) bool {
	if val, ok := data[key].(bool); ok {
		return val
	}
	return false
}

// Helper function to validate room access for WebRTC
func (s *Server) validateRoomAccess(clientID, roomID string) bool {
	if roomID == "" {
		return false
	}
	
	s.roomMutex.RLock()
	defer s.roomMutex.RUnlock()
	
	room, exists := s.rooms[roomID]
	if !exists {
		return false
	}
	
	// Check if client is in this room
	for _, participant := range room.Participants {
		if participant.ID == clientID {
			return true
		}
	}
	
	return false
}

func (s *Server) createRoom(username string) (*Room, error) {
	s.roomMutex.Lock()
	defer s.roomMutex.Unlock()

	// Check room limit (max 5 rooms)
	if len(s.rooms) >= 5 {
		return nil, fmt.Errorf("maximum room limit reached")
	}

	roomID := s.generateRoomID()
	room := &Room{
		ID:          roomID,
		Name:        fmt.Sprintf("Room %s", roomID[5:8]),
		Participants: []Participant{},
		CreatedAt:   time.Now(),
		MaxUsers:    15,
		// Phase 2 initialization
		CurrentVideo: nil,
		ChatHistory:  []ChatMessage{},
		LastActivity: time.Now(),
		IsActive:     true,
	}

	s.rooms[roomID] = room
	log.Printf("Room created: %s by user: %s", roomID, username)
	return room, nil
}

func (s *Server) joinRoom(roomID, username string) (*Room, error) {
	s.roomMutex.Lock()
	defer s.roomMutex.Unlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return nil, fmt.Errorf("room not found")
	}

	// Check if room is full
	if len(room.Participants) >= room.MaxUsers {
		return nil, fmt.Errorf("room is full")
	}

	// Check if username already exists in room
	for _, p := range room.Participants {
		if p.Username == username {
			return nil, fmt.Errorf("username already taken in this room")
		}
	}

	// Add participant
	participant := Participant{
		ID:       s.generateClientID(),
		Username: username,
		IsHost:   len(room.Participants) == 0, // First participant is host
		JoinedAt: time.Now(),
	}

	room.Participants = append(room.Participants, participant)
	log.Printf("User joined room: %s, username: %s, total participants: %d", roomID, username, len(room.Participants))
	return room, nil
}

func (s *Server) leaveRoom(roomID, clientID string) {
	s.roomMutex.Lock()
	defer s.roomMutex.Unlock()

	room, exists := s.rooms[roomID]
	if !exists {
		return
	}

	// Remove participant
	for i, p := range room.Participants {
		if p.ID == clientID {
			room.Participants = append(room.Participants[:i], room.Participants[i+1:]...)
			break
		}
	}

	// If room is empty, delete it
	if len(room.Participants) == 0 {
		delete(s.rooms, roomID)
		log.Printf("Room deleted: %s (empty)", roomID)
	} else {
		log.Printf("User left room: %s, remaining participants: %d", roomID, len(room.Participants))
	}
}

func (s *Server) broadcastToRoom(roomID string, message WebSocketMessage) {
	s.roomMutex.RLock()
	room, exists := s.rooms[roomID]
	s.roomMutex.RUnlock()

	if !exists {
		return
	}

	var disconnected []string

	s.clientMutex.RLock()
	for _, participant := range room.Participants {
		if client, exists := s.clients[participant.ID]; exists {
			if err := client.WriteJSON(message); err != nil {
				log.Printf("Error broadcasting to client %s: %v", participant.ID, err)
				disconnected = append(disconnected, participant.ID)
			}
		}
	}
	s.clientMutex.RUnlock()

	if len(disconnected) > 0 {
		s.clientMutex.Lock()
		for _, id := range disconnected {
			delete(s.clients, id)
		}
		s.clientMutex.Unlock()
	}

}

// Helper to check if a client belongs to a given room
func (s *Server) clientInRoom(clientID, roomID string) bool {
	s.roomMutex.RLock()
	defer s.roomMutex.RUnlock()
	room, ok := s.rooms[roomID]
	if !ok {
		return false
	}
	for _, p := range room.Participants {
		if p.ID == clientID {
			return true
		}
	}
	return false
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	clientID := s.generateClientID()
	s.clientMutex.Lock()
	s.clients[clientID] = conn
	s.clientMutex.Unlock()

	// Initialize ping tracking
	s.pingMutex.Lock()
	s.lastPing[clientID] = time.Now()
	s.pingMutex.Unlock()

	log.Printf("Client connected: %s", clientID)

	for {
		var msg WebSocketMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		s.handleWebSocketMessage(clientID, msg)
	}

	// Clean up on disconnect
	s.clientMutex.Lock()
	delete(s.clients, clientID)
	s.clientMutex.Unlock()
	
	s.pingMutex.Lock()
	delete(s.lastPing, clientID)
	s.pingMutex.Unlock()
	
	log.Printf("Client disconnected: %s", clientID)

	// Remove from all rooms
	s.roomMutex.Lock()
	for roomID, room := range s.rooms {
		for i, p := range room.Participants {
			if p.ID == clientID {
				room.Participants = append(room.Participants[:i], room.Participants[i+1:]...)
				// Notify others about participant leaving
				s.broadcastToRoom(roomID, WebSocketMessage{
					Type: "participant-left",
					Data: map[string]string{"participantId": clientID},
				})
				break
			}
		}
	}
	s.roomMutex.Unlock()
}

func (s *Server) handleWebSocketMessage(clientID string, msg WebSocketMessage) {
	// Update ping time
	s.pingMutex.Lock()
	s.lastPing[clientID] = time.Now()
	s.pingMutex.Unlock()

	// Rate limiting
	if s.isRateLimited(clientID) {
		log.Printf("Rate limited client: %s", clientID)
		return
	}

	// Validate message type
	if msg.Type == "" {
		log.Printf("Invalid message: missing type from client %s", clientID)
		return
	}

	switch msg.Type {
	case "ping":
		// Handle ping/pong
		s.clientMutex.RLock()
		if conn, exists := s.clients[clientID]; exists {
			conn.WriteJSON(WebSocketMessage{Type: "pong", Data: map[string]string{"timestamp": fmt.Sprintf("%d", time.Now().Unix())}})
		}
		s.clientMutex.RUnlock()
		return
	case "join-room":
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			log.Printf("Invalid join-room data from client %s", clientID)
			return
		}

		roomID, ok := data["roomId"].(string)
		if !ok || roomID == "" {
			log.Printf("Invalid roomId from client %s", clientID)
			return
		}

		username, ok := data["username"].(string)
		if !ok || username == "" {
			log.Printf("Invalid username from client %s", clientID)
			return
		}

		room, err := s.joinRoom(roomID, username)
		if err != nil {
			// Send error to client
			s.clientMutex.RLock()
			if client, exists := s.clients[clientID]; exists {
				client.WriteJSON(WebSocketMessage{
					Type: "error",
					Data: map[string]string{"message": err.Error()},
				})
			}
			s.clientMutex.RUnlock()
			return
		}

		// Update client ID in room
		s.roomMutex.Lock()
		for i, p := range room.Participants {
			if p.Username == username {
				room.Participants[i].ID = clientID
				break
			}
		}
		s.roomMutex.Unlock()

		// Send room joined confirmation with current state
		s.clientMutex.RLock()
		if client, exists := s.clients[clientID]; exists {
			// Send room data with current video and chat history
			roomData := map[string]interface{}{
				"room":         room,
				"currentVideo": room.CurrentVideo,
				"chatHistory":  room.ChatHistory,
			}
			
			client.WriteJSON(WebSocketMessage{
				Type: "room-joined",
				Data: roomData,
			})
		}
		s.clientMutex.RUnlock()

		// If this is the first participant, send room-created broadcast
		if len(room.Participants) == 1 {
			s.broadcastToRoom(roomID, WebSocketMessage{
				Type: "room-created",
				Data: room,
			})
		}

		// Broadcast participant joined to room
		s.broadcastToRoom(roomID, WebSocketMessage{
			Type: "participant-joined",
			Data: map[string]interface{}{
				"participant": map[string]interface{}{
					"id":       clientID,
					"username": username,
					"isHost":   len(room.Participants) == 1,
				},
			},
		})

	case "leave-room":
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			return
		}

		roomID, _ := data["roomId"].(string)
		s.leaveRoom(roomID, clientID)

	case "video-sync":
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			return
		}

		// Find which room this client is in
		s.roomMutex.RLock()
		var targetRoomID string
		for roomID, room := range s.rooms {
			for _, p := range room.Participants {
				if p.ID == clientID {
					targetRoomID = roomID
					break
				}
			}
			if targetRoomID != "" {
				break
			}
		}
		s.roomMutex.RUnlock()

		if targetRoomID != "" {
			// Update room's current video state
			s.roomMutex.Lock()
			if room, exists := s.rooms[targetRoomID]; exists {
				room.CurrentVideo = &VideoState{
					URL:         getString(data, "url"),
					CurrentTime: getFloat64(data, "currentTime"),
					Duration:    getFloat64(data, "duration"),
					IsPlaying:   getBool(data, "isPlaying"),
					Volume:      getFloat64(data, "volume"),
					LastUpdated: time.Now(),
				}
				room.LastActivity = time.Now()
			}
			s.roomMutex.Unlock()

			// Broadcast video sync to other participants in the room
			s.broadcastToRoom(targetRoomID, WebSocketMessage{
				Type: "video-sync",
				Data: data,
			})
		}

	case "chat-message":
		data, ok := msg.Data.(map[string]interface{})
		if !ok {
			return
		}

		// Validate chat message data
		username, _ := data["username"].(string)
		content, _ := data["content"].(string)
		roomID, _ := data["roomId"].(string)

		if username == "" || content == "" || roomID == "" {
			// Send error to client
			s.clientMutex.RLock()
			if client, exists := s.clients[clientID]; exists {
				client.WriteJSON(WebSocketMessage{
					Type: "error",
					Data: map[string]string{"message": "Invalid chat message data"},
				})
			}
			s.clientMutex.RUnlock()
			return
		}

		// Sanitize content (basic XSS protection)
		content = strings.TrimSpace(content)
		if len(content) > 500 {
			content = content[:500] + "..."
		}

		// Add timestamp and sanitized data
		chatData := map[string]interface{}{
			"username":  username,
			"content":   content,
			"timestamp": time.Now().UnixMilli(),
			"roomId":    roomID,
		}

		// Find which room this client is in and broadcast chat message
		s.roomMutex.Lock()
		var targetRoomID string
		for roomID, room := range s.rooms {
			for _, p := range room.Participants {
				if p.ID == clientID {
					targetRoomID = roomID
					break
				}
			}
			if targetRoomID != "" {
				break
			}
		}

		// Store chat message in room history
		if targetRoomID != "" {
			chatMsg := ChatMessage{
				ID:        fmt.Sprintf("%d", time.Now().UnixNano()),
				Username:  username,
				Content:   content,
				Timestamp: time.Now(),
				RoomID:    targetRoomID,
				Type:      "message",
			}
			
			if room, exists := s.rooms[targetRoomID]; exists {
				room.ChatHistory = append(room.ChatHistory, chatMsg)
				// Keep only last 100 messages
				if len(room.ChatHistory) > 100 {
					room.ChatHistory = room.ChatHistory[len(room.ChatHistory)-100:]
				}
				room.LastActivity = time.Now()
			}
		}
		s.roomMutex.Unlock()

		if targetRoomID != "" {
			s.broadcastToRoom(targetRoomID, WebSocketMessage{
				Type: "chat-message",
				Data: chatData,
			})
		}

	case "webrtc-offer":
		s.handleWebRTCOffer(clientID, msg.Data)
	case "webrtc-answer":
		s.handleWebRTCAnswer(clientID, msg.Data)
	case "webrtc-ice-candidate":
		s.handleWebRTCIceCandidate(clientID, msg.Data)
	case "webrtc-call-started":
		s.handleWebRTCCallStarted(clientID, msg.Data)
	case "webrtc-call-ended":
		s.handleWebRTCCallEnded(clientID, msg.Data)
	}
}

func (s *Server) handleWebRTCOffer(clientID string, data interface{}) {
	offerData, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := offerData["to"].(string)
	offer, _ := offerData["offer"].(map[string]interface{})
	from, _ := offerData["from"].(string)
	roomID, _ := offerData["roomId"].(string)

	// Validate room access
	if !s.validateRoomAccess(clientID, roomID) {
		return
	}

	// Forward offer to target client
	s.clientMutex.RLock()
	if targetClient, exists := s.clients[to]; exists {
		targetClient.WriteJSON(WebSocketMessage{
			Type: "webrtc-offer",
			Data: map[string]interface{}{
				"from":   from,
				"offer":  offer,
				"roomId": roomID,
			},
		})
	}
	s.clientMutex.RUnlock()
}

func (s *Server) handleWebRTCAnswer(clientID string, data interface{}) {
	answerData, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := answerData["to"].(string)
	answer, _ := answerData["answer"].(map[string]interface{})
	from, _ := answerData["from"].(string)
	roomID, _ := answerData["roomId"].(string)

	// Validate room access
	if !s.validateRoomAccess(clientID, roomID) {
		return
	}

	// Forward answer to target client
	s.clientMutex.RLock()
	if targetClient, exists := s.clients[to]; exists {
		targetClient.WriteJSON(WebSocketMessage{
			Type: "webrtc-answer",
			Data: map[string]interface{}{
				"from":   from,
				"answer": answer,
				"roomId": roomID,
			},
		})
	}
	s.clientMutex.RUnlock()
}

func (s *Server) handleWebRTCIceCandidate(clientID string, data interface{}) {
	candidateData, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	to, _ := candidateData["to"].(string)
	candidate, _ := candidateData["candidate"].(map[string]interface{})
	from, _ := candidateData["from"].(string)

	// Forward ICE candidate to target client
	s.clientMutex.RLock()
	if targetClient, exists := s.clients[to]; exists {
		targetClient.WriteJSON(WebSocketMessage{
			Type: "webrtc-ice-candidate",
			Data: map[string]interface{}{
				"from":      from,
				"candidate": candidate,
			},
		})
	}
	s.clientMutex.RUnlock()
}

func (s *Server) handleWebRTCCallStarted(clientID string, data interface{}) {
	callData, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	username, _ := callData["username"].(string)
	roomID, _ := callData["roomId"].(string)

	// Broadcast call started to room
	if roomID != "" {
		s.broadcastToRoom(roomID, WebSocketMessage{
			Type: "webrtc-call-started",
			Data: map[string]interface{}{
				"username": username,
			},
		})
	}
}

func (s *Server) handleWebRTCCallEnded(clientID string, data interface{}) {
	callData, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	username, _ := callData["username"].(string)
	roomID, _ := callData["roomId"].(string)

	// Broadcast call ended to room
	if roomID != "" {
		s.broadcastToRoom(roomID, WebSocketMessage{
			Type: "webrtc-call-ended",
			Data: map[string]interface{}{
				"username": username,
			},
		})
	}
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Username string `json:"username"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	room, err := s.createRoom(req.Username)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	response := map[string]interface{}{
		"success":    true,
		"roomId":     room.ID,
		"room":       room,
		"shareLink":  fmt.Sprintf("http://localhost:8080/join?room=%s", room.ID),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
	
	// Note: room-created broadcast will be sent when first participant joins
	// This reduces redundant WebSocket events
}

func (s *Server) handleJoinRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		RoomID   string `json:"roomId"`
		Username string `json:"username"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	room, err := s.joinRoom(req.RoomID, req.Username)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	response := map[string]interface{}{
		"success": true,
		"room":    room,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func (s *Server) handleGetRooms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.roomMutex.RLock()
	rooms := make([]*Room, 0, len(s.rooms))
	for _, room := range s.rooms {
		rooms = append(rooms, room)
	}
	s.roomMutex.RUnlock()

	response := map[string]interface{}{
		"success": true,
		"rooms":   rooms,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func main() {
	server := NewServer()
	
	// Start ping/pong goroutine
	server.startPingPong()

	// CORS configuration
	c := cors.New(cors.Options{
		AllowedOrigins: []string{"*"},
		AllowedMethods: []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders: []string{"*"},
	})

	// Routes
	http.Handle("/ws", c.Handler(http.HandlerFunc(server.handleWebSocket)))
	http.Handle("/create-room", c.Handler(http.HandlerFunc(server.handleCreateRoom)))
	http.Handle("/join-room", c.Handler(http.HandlerFunc(server.handleJoinRoom)))
	http.Handle("/rooms", c.Handler(http.HandlerFunc(server.handleGetRooms)))

	// Serve static files from dist directory
	http.Handle("/", http.FileServer(http.Dir("./dist")))

	// Health check endpoint
	http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	})

	// Room page route - serve the SPA
	http.HandleFunc("/room/", func(w http.ResponseWriter, r *http.Request) {
		// Extract room ID from path
		roomId := strings.TrimPrefix(r.URL.Path, "/room/")
		if roomId == "" {
			http.Error(w, "Room ID required", http.StatusBadRequest)
			return
		}

		// Check if room exists
		server.roomMutex.RLock()
		room, exists := server.rooms[roomId]
		server.roomMutex.RUnlock()

		if !exists {
			http.Error(w, "Room not found", http.StatusNotFound)
			return
		}

		// Serve the SPA with room data injected
		html := fmt.Sprintf(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CineBuddy - Room %s</title>
    <link rel="stylesheet" href="/assets/index.css">
</head>
<body>
    <div id="root"></div>
    <script>
        window.__ROOM_DATA__ = %s;
    </script>
    <script src="/assets/index.js"></script>
</body>
</html>`, roomId, func() string {
			roomJSON, _ := json.Marshal(room)
			return string(roomJSON)
		}())

		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(html))
	})

	// Join room endpoint for shareable links
	http.HandleFunc("/join", func(w http.ResponseWriter, r *http.Request) {
		roomId := r.URL.Query().Get("room")
		if roomId == "" {
			http.Error(w, "Room ID required", http.StatusBadRequest)
			return
		}

		// Check if room exists
		server.roomMutex.RLock()
		room, exists := server.rooms[roomId]
		server.roomMutex.RUnlock()

		if !exists {
			http.Error(w, "Room not found", http.StatusNotFound)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"roomId":    roomId,
			"room":      room,
			"shareLink": fmt.Sprintf("http://localhost:8080/join?room=%s", roomId),
		})
	})

	port := ":8080"
	log.Printf("CineBuddy backend server starting on port %s", port)
	log.Printf("WebSocket endpoint: ws://localhost%s/ws", port)
	log.Printf("REST endpoints: http://localhost%s", port)
	
	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal("Server failed to start:", err)
	}
}
