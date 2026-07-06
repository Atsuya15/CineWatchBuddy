package database

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Database struct {
	db *sql.DB
}

type Room struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	CreatedAt    time.Time `json:"createdAt"`
	LastActivity time.Time `json:"lastActivity"`
	IsActive     bool      `json:"isActive"`
	HostID       string    `json:"hostId"`
	VideoState   string    `json:"videoState"` // JSON string
	ChatHistory  string    `json:"chatHistory"` // JSON string
}

type Participant struct {
	ID           string    `json:"id"`
	RoomID       string    `json:"roomId"`
	Username     string    `json:"username"`
	JoinedAt     time.Time `json:"joinedAt"`
	LastSeen     time.Time `json:"lastSeen"`
	IsActive     bool      `json:"isActive"`
	BrowserFingerprint string `json:"browserFingerprint"`
	DeviceType   string    `json:"deviceType"` // "web", "extension"
}

type ChatMessage struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"roomId"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	Type      string    `json:"type"` // "user", "system"
	Timestamp time.Time `json:"timestamp"`
}

type VideoState struct {
	CurrentTime  float64 `json:"currentTime"`
	Paused       bool    `json:"paused"`
	PlaybackRate float64 `json:"playbackRate"`
	VideoURL     string  `json:"videoUrl"`
	Duration     float64 `json:"duration"`
	LastUpdated  time.Time `json:"lastUpdated"`
}

func NewDatabase(dbPath string) (*Database, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	database := &Database{db: db}
	if err := database.createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	return database, nil
}

func (d *Database) createTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			last_activity DATETIME NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT 1,
			host_id TEXT NOT NULL,
			video_state TEXT,
			chat_history TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS participants (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			joined_at DATETIME NOT NULL,
			last_seen DATETIME NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT 1,
			browser_fingerprint TEXT,
			device_type TEXT NOT NULL,
			FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS chat_messages (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			username TEXT NOT NULL,
			content TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'user',
			timestamp DATETIME NOT NULL,
			FOREIGN KEY (room_id) REFERENCES rooms (id) ON DELETE CASCADE
		)`,
		`CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants (room_id)`,
		`CREATE INDEX IF NOT EXISTS idx_chat_messages_room_id ON chat_messages (room_id)`,
		`CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages (timestamp)`,
	}

	for _, query := range queries {
		if _, err := d.db.Exec(query); err != nil {
			return fmt.Errorf("failed to execute query %s: %w", query, err)
		}
	}

	return nil
}

func (d *Database) Close() error {
	return d.db.Close()
}

// Room operations
func (d *Database) CreateRoom(room *Room) error {
	query := `INSERT INTO rooms (id, name, created_at, last_activity, is_active, host_id, video_state, chat_history) 
			  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	
	_, err := d.db.Exec(query, room.ID, room.Name, room.CreatedAt, room.LastActivity, room.IsActive, room.HostID, room.VideoState, room.ChatHistory)
	return err
}

func (d *Database) GetRoom(roomID string) (*Room, error) {
	query := `SELECT id, name, created_at, last_activity, is_active, host_id, video_state, chat_history 
			  FROM rooms WHERE id = ? AND is_active = 1`
	
	row := d.db.QueryRow(query, roomID)
	room := &Room{}
	
	err := row.Scan(&room.ID, &room.Name, &room.CreatedAt, &room.LastActivity, &room.IsActive, &room.HostID, &room.VideoState, &room.ChatHistory)
	if err != nil {
		return nil, err
	}
	
	return room, nil
}

func (d *Database) UpdateRoom(room *Room) error {
	query := `UPDATE rooms SET name = ?, last_activity = ?, is_active = ?, host_id = ?, video_state = ?, chat_history = ? 
			  WHERE id = ?`
	
	_, err := d.db.Exec(query, room.Name, room.LastActivity, room.IsActive, room.HostID, room.VideoState, room.ChatHistory, room.ID)
	return err
}

func (d *Database) DeleteRoom(roomID string) error {
	query := `UPDATE rooms SET is_active = 0 WHERE id = ?`
	_, err := d.db.Exec(query, roomID)
	return err
}

func (d *Database) GetAllActiveRooms() ([]*Room, error) {
	query := `SELECT id, name, created_at, last_activity, is_active, host_id, video_state, chat_history 
			  FROM rooms WHERE is_active = 1 ORDER BY last_activity DESC`
	
	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var rooms []*Room
	for rows.Next() {
		room := &Room{}
		err := rows.Scan(&room.ID, &room.Name, &room.CreatedAt, &room.LastActivity, &room.IsActive, &room.HostID, &room.VideoState, &room.ChatHistory)
		if err != nil {
			return nil, err
		}
		rooms = append(rooms, room)
	}
	
	return rooms, nil
}

// Participant operations
func (d *Database) AddParticipant(participant *Participant) error {
	query := `INSERT INTO participants (id, room_id, username, joined_at, last_seen, is_active, browser_fingerprint, device_type) 
			  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
	
	_, err := d.db.Exec(query, participant.ID, participant.RoomID, participant.Username, participant.JoinedAt, participant.LastSeen, participant.IsActive, participant.BrowserFingerprint, participant.DeviceType)
	return err
}

func (d *Database) GetParticipants(roomID string) ([]*Participant, error) {
	query := `SELECT id, room_id, username, joined_at, last_seen, is_active, browser_fingerprint, device_type 
			  FROM participants WHERE room_id = ? AND is_active = 1 ORDER BY joined_at ASC`
	
	rows, err := d.db.Query(query, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var participants []*Participant
	for rows.Next() {
		participant := &Participant{}
		err := rows.Scan(&participant.ID, &participant.RoomID, &participant.Username, &participant.JoinedAt, &participant.LastSeen, &participant.IsActive, &participant.BrowserFingerprint, &participant.DeviceType)
		if err != nil {
			return nil, err
		}
		participants = append(participants, participant)
	}
	
	return participants, nil
}

func (d *Database) UpdateParticipantLastSeen(participantID string) error {
	query := `UPDATE participants SET last_seen = ? WHERE id = ?`
	_, err := d.db.Exec(query, time.Now(), participantID)
	return err
}

func (d *Database) RemoveParticipant(participantID string) error {
	query := `UPDATE participants SET is_active = 0 WHERE id = ?`
	_, err := d.db.Exec(query, participantID)
	return err
}

// Chat operations
func (d *Database) AddChatMessage(message *ChatMessage) error {
	query := `INSERT INTO chat_messages (id, room_id, username, content, type, timestamp) 
			  VALUES (?, ?, ?, ?, ?, ?)`
	
	_, err := d.db.Exec(query, message.ID, message.RoomID, message.Username, message.Content, message.Type, message.Timestamp)
	return err
}

func (d *Database) GetChatHistory(roomID string, limit int) ([]*ChatMessage, error) {
	query := `SELECT id, room_id, username, content, type, timestamp 
			  FROM chat_messages WHERE room_id = ? ORDER BY timestamp DESC LIMIT ?`
	
	rows, err := d.db.Query(query, roomID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	
	var messages []*ChatMessage
	for rows.Next() {
		message := &ChatMessage{}
		err := rows.Scan(&message.ID, &message.RoomID, &message.Username, &message.Content, &message.Type, &message.Timestamp)
		if err != nil {
			return nil, err
		}
		messages = append(messages, message)
	}
	
	// Reverse to get chronological order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}
	
	return messages, nil
}

// Helper functions for JSON serialization
func (d *Database) GetVideoState(roomID string) (*VideoState, error) {
	room, err := d.GetRoom(roomID)
	if err != nil {
		return nil, err
	}
	
	if room.VideoState == "" {
		return &VideoState{}, nil
	}
	
	var videoState VideoState
	err = json.Unmarshal([]byte(room.VideoState), &videoState)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal video state: %w", err)
	}
	
	return &videoState, nil
}

func (d *Database) UpdateVideoState(roomID string, videoState *VideoState) error {
	videoStateJSON, err := json.Marshal(videoState)
	if err != nil {
		return fmt.Errorf("failed to marshal video state: %w", err)
	}
	
	query := `UPDATE rooms SET video_state = ?, last_activity = ? WHERE id = ?`
	_, err = d.db.Exec(query, string(videoStateJSON), time.Now(), roomID)
	return err
}

func (d *Database) GetChatHistoryJSON(roomID string, limit int) (string, error) {
	messages, err := d.GetChatHistory(roomID, limit)
	if err != nil {
		return "", err
	}
	
	chatHistoryJSON, err := json.Marshal(messages)
	if err != nil {
		return "", fmt.Errorf("failed to marshal chat history: %w", err)
	}
	
	return string(chatHistoryJSON), nil
}

func (d *Database) UpdateChatHistory(roomID string, messages []*ChatMessage) error {
	chatHistoryJSON, err := json.Marshal(messages)
	if err != nil {
		return fmt.Errorf("failed to marshal chat history: %w", err)
	}
	
	query := `UPDATE rooms SET chat_history = ?, last_activity = ? WHERE id = ?`
	_, err = d.db.Exec(query, string(chatHistoryJSON), time.Now(), roomID)
	return err
}

// Cleanup operations
func (d *Database) CleanupInactiveRooms(maxAge time.Duration) error {
	cutoff := time.Now().Add(-maxAge)
	query := `UPDATE rooms SET is_active = 0 WHERE last_activity < ? AND is_active = 1`
	_, err := d.db.Exec(query, cutoff)
	return err
}

func (d *Database) CleanupInactiveParticipants(maxAge time.Duration) error {
	cutoff := time.Now().Add(-maxAge)
	query := `UPDATE participants SET is_active = 0 WHERE last_seen < ? AND is_active = 1`
	_, err := d.db.Exec(query, cutoff)
	return err
}

// Load room state for restoration
func (d *Database) LoadRoomState(roomID string) (*Room, []*Participant, []*ChatMessage, *VideoState, error) {
	room, err := d.GetRoom(roomID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	
	participants, err := d.GetParticipants(roomID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	
	chatHistory, err := d.GetChatHistory(roomID, 100)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	
	videoState, err := d.GetVideoState(roomID)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	
	return room, participants, chatHistory, videoState, nil
}
