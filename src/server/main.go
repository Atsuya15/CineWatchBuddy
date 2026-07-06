package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
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
    clientRooms map[string]string
    clientUsers map[string]string
    writeMu     map[string]*sync.Mutex
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
	Clients      []string               `json:"-"` // Track connected client IDs
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
        clientRooms: make(map[string]string),
        clientUsers: make(map[string]string),
        writeMu:     make(map[string]*sync.Mutex),
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
			Clients:      []string{},
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

	// If the creator supplies a room name, use a friendly slug of it as the
	// room ID so others can join by an easy-to-share name (e.g. "movie-night")
	// instead of the raw room_<nanos> id. Fall back to a random id.
	roomID := ""
	if req.RoomName != "" {
		if slug := slugify(req.RoomName); slug != "" {
			s.mutex.RLock()
			_, taken := s.rooms[slug]
			s.mutex.RUnlock()
			if taken {
				slug = fmt.Sprintf("%s-%d", slug, time.Now().UnixNano()%10000)
			}
			roomID = slug
		}
	}
	if roomID == "" {
		roomID = generateRoomID()
	}

	roomName := req.RoomName
	if roomName == "" {
		shortID := roomID
		if len(shortID) > 8 {
			shortID = shortID[:8]
		}
		roomName = fmt.Sprintf("Room %s", shortID)
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
		Clients:      []string{},
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

    clientID := generateClientID()
    // Track client room from query
    roomID := r.URL.Query().Get("room")
    if roomID == "" {
        roomID = "_"
    }
    s.mutex.Lock()
    s.clients[clientID] = conn
    s.clientRooms[clientID] = roomID
    s.writeMu[clientID] = &sync.Mutex{}
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
	conn.Close()
    s.mutex.Lock()
    delete(s.clients, clientID)
    roomID = s.clientRooms[clientID]
    username := s.clientUsers[clientID]
    delete(s.clientRooms, clientID)
    delete(s.clientUsers, clientID)
    delete(s.writeMu, clientID)

    // Remove this client from the room's client list immediately.
    if roomID != "" && roomID != "_" {
        if room, exists := s.rooms[roomID]; exists {
            for i, cid := range room.Clients {
                if cid == clientID {
                    room.Clients = append(room.Clients[:i], room.Clients[i+1:]...)
                    break
                }
            }
        }
    }
    s.mutex.Unlock()

    // Grace period before announcing a departure. Flaky connections (common over
    // tunnels) reconnect within a second or two; announcing "left" too eagerly
    // makes other participants see the user get kicked out of the room.
    if roomID != "" && roomID != "_" && username != "" {
        go s.handleParticipantDeparture(roomID, username)
    }
	log.Printf("WebSocket client disconnected: %s", clientID)
}

// handleParticipantDeparture waits out a grace period and only marks a user as
// left if they have not reconnected to the room in the meantime.
func (s *Server) handleParticipantDeparture(roomID, username string) {
	time.Sleep(3 * time.Second)

	s.mutex.Lock()
	for cid, uname := range s.clientUsers {
		if uname == username && s.clientRooms[cid] == roomID {
			// User reconnected during the grace window — nothing to announce.
			s.mutex.Unlock()
			return
		}
	}
	if room, exists := s.rooms[roomID]; exists {
		for _, p := range room.Participants {
			if p.Username == username && p.IsActive {
				p.IsActive = false
				s.db.RemoveParticipant(p.ID)
				break
			}
		}
	}
	s.mutex.Unlock()

	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "participant-left",
		Data: map[string]interface{}{"username": username},
	})
}

func (s *Server) handleWebSocketMessage(clientID string, msg WebSocketMessage) {
	log.Printf("Received WebSocket message from %s: %s", clientID, msg.Type)
	switch msg.Type {
	case "join-room":
		s.handleJoinRoomWS(clientID, msg.Data)
	case "leave-room":
		s.handleLeaveRoomWS(clientID, msg.Data)
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
	case "webrtc-call-started":
		s.handleWebRTCCallStarted(clientID, msg.Data)
	case "webrtc-call-ended":
		s.handleWebRTCCallEnded(clientID, msg.Data)
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

	// Find or create participant
	var participant *database.Participant
	for _, p := range room.Participants {
		if p.Username == username && p.IsActive {
			participant = p
			break
		}
	}

	if participant == nil {
		// Create new participant
		participant = &database.Participant{
			ID:        generateClientID(),
			RoomID:    roomID,
			Username:  username,
			IsActive:  true,
			JoinedAt:  time.Now(),
			LastSeen:  time.Now(),
		}

		// Add to database
		if err := s.db.AddParticipant(participant); err != nil {
			log.Printf("Failed to add participant to database: %v", err)
			return
		}

		// Add to room
		s.mutex.Lock()
		room.Participants = append(room.Participants, participant)
		// Set first participant as host
		if len(room.Participants) == 1 {
			room.HostID = participant.ID
		}
		s.mutex.Unlock()

		// Update room in database
		s.updateRoomInDatabase(room)
	}

	// Update last seen
	participant.LastSeen = time.Now()
	s.db.UpdateParticipantLastSeen(participant.ID)

	// Update client room + user mapping
	s.mutex.Lock()
	s.clientRooms[clientID] = roomID
	s.clientUsers[clientID] = username
	s.mutex.Unlock()

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

	// Only broadcast participant joined if this is a new connection
	// Check if this participant was already connected
	s.mutex.RLock()
	wasConnected := false
	for _, cid := range room.Clients {
		if cid == clientID {
			wasConnected = true
			break
		}
	}
	s.mutex.RUnlock()

	if !wasConnected {
		// Add client to room
		s.mutex.Lock()
		room.Clients = append(room.Clients, clientID)
		s.mutex.Unlock()

		// Broadcast participant joined only for new connections
		s.broadcastToRoom(roomID, WebSocketMessage{
			Type: "participant-joined",
			Data: map[string]interface{}{
				"participant": participant,
			},
		})
	}
}

func (s *Server) handleLeaveRoomWS(clientID string, data interface{}) {
	s.mutex.Lock()
	roomID := s.clientRooms[clientID]
	username := s.clientUsers[clientID]
	s.clientRooms[clientID] = "_"
	delete(s.clientUsers, clientID)

	if roomID != "" && roomID != "_" {
		if room, exists := s.rooms[roomID]; exists {
			for i, cid := range room.Clients {
				if cid == clientID {
					room.Clients = append(room.Clients[:i], room.Clients[i+1:]...)
					break
				}
			}
			for _, p := range room.Participants {
				if p.Username == username && p.IsActive {
					p.IsActive = false
					s.db.RemoveParticipant(p.ID)
					break
				}
			}
		}
	}
	s.mutex.Unlock()

	if roomID != "" && roomID != "_" && username != "" {
		s.broadcastToRoom(roomID, WebSocketMessage{
			Type: "participant-left",
			Data: map[string]interface{}{
				"username": username,
			},
		})
	}
}

func (s *Server) handleVideoSync(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		log.Printf("Invalid video sync data from client %s", clientID)
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	username, _ := dataMap["username"].(string)
	url, _ := dataMap["url"].(string)
	
	log.Printf("Received video sync from %s in room %s: url=%s", username, roomID, url)
	
	if roomID == "" {
		log.Printf("No room ID in video sync from client %s", clientID)
		return
	}

	s.mutex.RLock()
	room, exists := s.rooms[roomID]
	s.mutex.RUnlock()

	if !exists {
		log.Printf("Room %s not found for video sync", roomID)
		return
	}

	// Update video state
	videoState := &database.VideoState{
		CurrentTime:  getFloat64(dataMap, "currentTime"),
		Paused:       getBool(dataMap, "paused"),
		PlaybackRate: getFloat64(dataMap, "playbackRate"),
		VideoURL:     getString(dataMap, "url"), // Use "url" instead of "videoUrl"
		Duration:     getFloat64(dataMap, "duration"),
		LastUpdated:  time.Now(),
	}

	log.Printf("Updated video state for room %s: URL=%s, Time=%.2f, Paused=%v", roomID, videoState.VideoURL, videoState.CurrentTime, videoState.Paused)

	s.mutex.Lock()
	room.VideoState = videoState
	room.LastActivity = time.Now()
	s.mutex.Unlock()

	// Update database
	s.db.UpdateVideoState(roomID, videoState)

	// Broadcast to room
	log.Printf("Broadcasting video sync to room %s", roomID)
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "video-sync",
		Data: map[string]interface{}{
			"url":          videoState.VideoURL,
			"currentTime":  videoState.CurrentTime,
			"paused":       videoState.Paused,
			"playbackRate": videoState.PlaybackRate,
			"duration":     videoState.Duration,
		},
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

	roomID, _ := dataMap["roomId"].(string)
    offer := dataMap["offer"]
    from, _ := dataMap["from"].(string) // username of the sender (peer key on the client)

    if roomID == "" || offer == nil {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

    // Broadcast offer to all clients in the room
    s.broadcastToRoom(roomID, WebSocketMessage{
        Type: "webrtc-offer",
        Data: map[string]interface{}{
            "from":  from,
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

	roomID, _ := dataMap["roomId"].(string)
    answer := dataMap["answer"]
    from, _ := dataMap["from"].(string) // username of the sender (peer key on the client)

    if roomID == "" || answer == nil {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

    // Broadcast answer to all clients in the room
    s.broadcastToRoom(roomID, WebSocketMessage{
        Type: "webrtc-answer",
        Data: map[string]interface{}{
            "from":   from,
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

	roomID, _ := dataMap["roomId"].(string)
    // Client sends the candidate under the "candidate" key; accept "iceCandidate" too for safety.
    candidate := dataMap["candidate"]
    if candidate == nil {
        candidate = dataMap["iceCandidate"]
    }
    from, _ := dataMap["from"].(string)

    if roomID == "" || candidate == nil {
		return
	}

	// Validate room access
	if !s.validateRoomAccess(roomID, clientID) {
		return
	}

    // Broadcast candidate to all clients in the room
    s.broadcastToRoom(roomID, WebSocketMessage{
        Type: "webrtc-ice-candidate",
        Data: map[string]interface{}{
            "from":      from,
            "candidate": candidate,
            "roomId":    roomID,
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

// writeJSON serializes writes per connection (gorilla forbids concurrent
// writers) and never holds the server mutex during the network write, so one
// slow/dead client can't stall the whole server. A write deadline bounds it.
func (s *Server) writeJSON(clientID string, msg interface{}) bool {
	s.mutex.RLock()
	conn := s.clients[clientID]
	wm := s.writeMu[clientID]
	s.mutex.RUnlock()

	if conn == nil || wm == nil {
		return false
	}

	wm.Lock()
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	err := conn.WriteJSON(msg)
	wm.Unlock()

	if err != nil {
		log.Printf("write to client %s failed: %v", clientID, err)
		return false
	}
	return true
}

func (s *Server) sendToClient(clientID string, msg WebSocketMessage) {
	s.writeJSON(clientID, msg)
}

func (s *Server) broadcastToRoom(roomID string, msg WebSocketMessage) {
    // Snapshot the target client IDs under the lock, then write OUTSIDE the lock
    // so a blocked write to one client can't stall everyone else.
    s.mutex.RLock()
    if _, exists := s.rooms[roomID]; !exists {
        s.mutex.RUnlock()
        return
    }
    targets := make([]string, 0, len(s.clients))
    for clientID := range s.clients {
        if s.clientRooms[clientID] == roomID {
            targets = append(targets, clientID)
        }
    }
    s.mutex.RUnlock()

    for _, clientID := range targets {
        s.writeJSON(clientID, msg)
    }
}

func (s *Server) startPingPong(ctx context.Context, clientID string, conn *websocket.Conn) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// WriteControl is safe to call concurrently with other writers.
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(10*time.Second)); err != nil {
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

func (s *Server) handleRooms(w http.ResponseWriter, r *http.Request) {
	s.mutex.RLock()
	rooms := make([]map[string]interface{}, 0, len(s.rooms))
	for _, room := range s.rooms {
		activeCount := 0
		for _, p := range room.Participants {
			if p.IsActive {
				activeCount++
			}
		}
		rooms = append(rooms, map[string]interface{}{
			"id":           room.ID,
			"name":         room.Name,
			"participants": activeCount,
			"createdAt":    room.CreatedAt,
			"lastActivity": room.LastActivity,
		})
	}
	s.mutex.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"rooms":   rooms,
	})
}

// handleExtTest serves a minimal page with an HTML5 <video> so the Chrome
// extension's content script can be exercised locally (stand-in for a DRM site).
func (s *Server) handleExtTest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, extTestHTML)
}

const extTestHTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>CineWatchBuddy Extension Test Page</title>
<style>body{background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:24px}
video{width:480px;max-width:90vw;background:#000;border-radius:8px}</style></head>
<body>
<h2>CineWatchBuddy — Extension Test Video</h2>
<p>Stand-in for a DRM streaming page. The content script attaches to the &lt;video&gt; below.</p>
<video id="testVideo" playsinline></video>
<script>
  // Use a fake/real camera stream so play/pause reflect real element state.
  const v = document.getElementById('testVideo');
  navigator.mediaDevices.getUserMedia({ video: true, audio: false })
    .then(s => { v.srcObject = s; })
    .catch(() => { /* no camera: element still present for listener tests */ });
  // Expose simple controls for automated testing.
  window.cwbPlay = () => v.play();
  window.cwbPause = () => v.pause();
  window.cwbState = () => ({ paused: v.paused, currentTime: v.currentTime });
</script>
</body></html>`

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

// slugify turns a human room name into a URL/room-id friendly slug.
// "Movie Night!" -> "movie-night"
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
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

func (s *Server) handleWebRTCCallStarted(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	username, _ := dataMap["username"].(string)
	media, _ := dataMap["media"].(string)

	if roomID == "" || username == "" {
		return
	}

	// Broadcast to room that someone started sharing
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "webrtc-call-started",
		Data: map[string]interface{}{
			"username": username,
			"media":    media,
			"roomId":   roomID,
		},
	})
}

func (s *Server) handleWebRTCCallEnded(clientID string, data interface{}) {
	dataMap, ok := data.(map[string]interface{})
	if !ok {
		return
	}

	roomID, _ := dataMap["roomId"].(string)
	username, _ := dataMap["username"].(string)

	if roomID == "" || username == "" {
		return
	}

	// Broadcast to room that someone stopped sharing
	s.broadcastToRoom(roomID, WebSocketMessage{
		Type: "webrtc-call-ended",
		Data: map[string]interface{}{
			"username": username,
			"roomId":   roomID,
		},
	})
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
			"http://localhost:3001",
			"http://localhost:3002",
			"http://localhost:8080",
			"http://127.0.0.1:3000",
			"http://127.0.0.1:3001",
			"http://127.0.0.1:3002",
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
	http.HandleFunc("/rooms", server.handleRooms)
	http.HandleFunc("/ext-test", server.handleExtTest)
	http.HandleFunc("/ws", server.handleWebSocket)
	http.HandleFunc("/health", server.handleHealth)

	// [TUNNEL] Serve the built React app with SPA fallback so client-side routes
	// (e.g. /room/<id>) resolve to index.html instead of 404. This enables
	// single-origin serving behind Cloudflare Tunnel. Revert to the original
	// `http.Handle("/", http.FileServer(http.Dir("../web/dist")))` if not needed.
	webDir := getEnv("WEB_DIR", "../web/dist")
	fileServer := http.FileServer(http.Dir(webDir))
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		clean := filepath.Clean(r.URL.Path)
		full := filepath.Join(webDir, clean)
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			// Hashed asset filenames make these safe to cache long-term.
			fileServer.ServeHTTP(w, r)
			return
		}
		// index.html must never be cached, so clients always pick up the latest
		// hashed bundle after an update.
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		http.ServeFile(w, r, filepath.Join(webDir, "index.html"))
	})

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