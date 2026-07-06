# CineBuddy Extension

A browser extension that enables synchronized video playback across streaming services (Netflix, Hulu, YouTube, etc.) with friends in real-time.

## Features

-  **Synchronized Playback**: Watch videos together with friends across different streaming platforms
-  **Real-time Chat**: Chat with friends while watching
-  **Video Calls**: WebRTC-powered video calls during watch parties
-  **Room Management**: Create and join virtual rooms (up to 15 users per room)
-  **Cross-Platform**: Works with Netflix, Hulu, YouTube, Disney+, Amazon Prime, and more
-  **Low Latency**: Sub-500ms sync for smooth viewing experience

## Architecture

- **Web Client**: React-based SPA served by Go backend
- **Chrome Extension**: Manifest V3 extension for DRM content (Netflix, Disney+, etc.)
- **Backend**: Go WebSocket server with persistent room state and chat history
- **Sync Protocol**: Real-time video event synchronization via WebSocket
- **Video Calls**: Peer-to-peer WebRTC connections with STUN servers
- **Cross-Platform**: Seamless integration between web client and extension

### System Architecture Diagram

```
                              ┌────────────────────────────────────────────┐
                              │                 Browser                    │
                              │────────────────────────────────────────────│
                              │          Chrome / Firefox (MV3)            │
                              └────────────────────────────────────────────┘
                                            │
                                            │
                                            ▼
        ┌───────────────────────────────────────────────────────────────────────────┐
        │                        Browser Extension Components                       │
        └───────────────────────────────────────────────────────────────────────────┘
                                            │
                                            │
         ┌──────────────────────────┬──────────────────────────────┬───────────────────────────┐
         │                          │                              │                           │
         ▼                          ▼                              ▼                           ▼
┌──────────────────────┐   ┌────────────────────────┐     ┌──────────────────────┐    ┌──────────────────────┐
│ background.js        │   │ content.js             │     │ popup.js             │    │ components/          │
│ Service Worker       │   │ Injected into site     │     │ Extension popup UI   │    │   chat-overlay.js    │
│                      │   │ - Detects <video>      │     │ - Create/Join room   │    │   webrtc-signaling.js│
│ - Manages WS to Go   │   │ - Captures play/pause  │     │ - Handles login      │    │ - P2P media setup    │
│ - Handles reconnects │   │ - Sends sync via WS    │     │ - Shows room state   │    │ - TURN/STUN mgmt     │
│ - Broadcasts updates │   │ - Shows overlay & chat │     │ - Calls REST APIs    │    │ - Video call overlay │
└──────────────────────┘   └────────────────────────┘     └──────────────────────┘    └──────────────────────┘
         │                          │                               │                           │
         │                          │                               │                           │
         │                          │                               │                           │
         └──────────────────────────┴───────────────┬───────────────┴──────────────┬────────────┘
                                                    │                              │
                                                    ▼                              ▼
                                        ┌────────────────────────────┐  ┌────────────────────────────┐
                                        │   WebSocket Events         │  │      REST Endpoints        │
                                        │────────────────────────────│  │────────────────────────────│
                                        │  /ws                       │  │  /create-room (POST)       │
                                        │  ↕ video-sync              │  │  /join-room (POST)         │
                                        │  ↕ chat-message            │  │  /rooms (GET)              │
                                        │  ↕ webrtc-offer/answer     │  │  /health (GET)             │
                                        │  ↕ presence updates        │  │                            │
                                        └─────────────┬──────────────┘  └────────────┬────────────── ┘
                                                      │                              │
                                                      │                              │
                                                      ▼                              ▼
                            ┌─────────────────────────────────────────────────────────────┐
                            │                   Go Backend (main.go)                      │
                            │─────────────────────────────────────────────────────────────│
                            │ NewServer() initializes:                                    │
                            │  - rooms map[string]*Room                                   │
                            │  - clients map[string]*websocket.Conn                       │
                            │  - rateLimiter, ping checkers                               │
                            │                                                             │
                            │ handleWebSocket()  → upgrade & listen per client            │
                            │ handleCreateRoom() → returns roomId                         │
                            │ handleJoinRoom()   → joins + broadcasts participant         │
                            │ broadcastToRoom()  → sends to all WS clients                │
                            │ handleWebRTC*()    → forwards signaling messages            │
                            │ startPingPong()    → closes idle connections                │
                            └────────────┬──────────────────────────────────────────────  ┘
                                         │
                                         │   In-memory (no DB)
                                         ▼
                           ┌───────────────────────────────────────┐
                           │  Room Management Structures:          │
                           │                                       │
                           │  type Room {                          │
                           │     ID, Name, Participants[], ...     │
                           │  }                                    │
                           │  type Participant { ID, Username, ...}│
                           └───────────────────────────────────────┘
                                         │
                                         ▼
                              ┌──────────────────────────────────────┐
                              │  In-memory synchronization only      │
                              │  No persistent storage (stateless)   │
                              └──────────────────────────────────────┘
                                         │
                                         ▼
                             ┌─────────────────────────────────────────┐
                             │    External Deployment Layer (Optional) │
                             │─────────────────────────────────────────│
                             │  Nginx / Fly.io / Render proxy          │
                             │  - Enforces HTTPS / WSS                 │
                             │  - CORS filtering                       │
                             │  - Load balancer                        │
                             └─────────────────────────────────────────┘
```

## Sequence Diagram

```
───────────────────────────────  CineBuddy Watch Party Flow  ───────────────────────────────

Actors:
───────
UserA (Host)          Popup/Content Script on Browser A
UserB (Joiner)        Popup/Content Script on Browser B
Background.js         Shared service worker (1 per browser)
Go Backend Server     main.go (in-memory WebSocket server)

Legend:
────────
→  : HTTP or WS message sent
←  : Response / event received
...: Parallel action
★  : Key event in flow

────────────────────────────────────────────────────────────────────────────────────────────

★ 1. ROOM CREATION
────────────────────────────────────────────────────────────────────────────────────────────
UserA Popup        → POST /create-room { username: "Alice" }
Go Backend Server  ← 200 OK { roomId: "room_12345" }

UserA Popup        → WS: { type: "join-room", roomId: "room_12345", username: "Alice" }
Go Backend Server  ← Adds Alice as host, broadcasts:
                    → WS Broadcast: { type: "room-created", data: {room info} }

────────────────────────────────────────────────────────────────────────────────────────────

★ 2. JOINING THE ROOM
────────────────────────────────────────────────────────────────────────────────────────────
UserB Popup        → WS: { type: "join-room", roomId: "room_12345", username: "Bob" }
Go Backend Server  ← Validates room + username
                    → WS to Bob: { type: "room-joined", data: {...room details...} }
                    → WS Broadcast to all:
                        { type: "participant-joined", data: { participant: Bob } }

Both clients update local state via:
background.js      → chrome.storage.local.set({ currentRoom: room_12345 })
popup.js           ← Refreshes participant list in UI
content.js         ← Displays " CineBuddy Ready" overlay

────────────────────────────────────────────────────────────────────────────────────────────

★ 3. VIDEO SYNC LOOP (real-time collaboration)
────────────────────────────────────────────────────────────────────────────────────────────
UserA Content.js detects play/pause/seek:
UserA Content.js   → WS: { type: "video-sync", data: { currentTime, paused, ... } }

Go Backend Server  ← Validates clientInRoom()
                    → Broadcasts to room_12345:
                        { type: "video-sync", data: {...} }

UserB Background.js → Receives message → sends chrome.runtime message
UserB Content.js    ← Receives "videoSync"
                      └→ Applies playback change to <video> element

(Repeat for play, pause, seek, ratechange, etc. throttled ≤5/sec)

────────────────────────────────────────────────────────────────────────────────────────────

★ 4. CHAT EXCHANGE
────────────────────────────────────────────────────────────────────────────────────────────
UserB ChatOverlay   → WS: { type: "chat-message", data: { username: "Bob", content: "Hi!" } }

Go Backend Server   ← Validates + sanitizes message
                    → Broadcasts:
                        { type: "chat-message", data: {...} }

UserA Content.js    ← Displays new message in overlay
UserB Content.js    ← Mirrors message locally

────────────────────────────────────────────────────────────────────────────────────────────

★ 5. WEBRTC CALL SETUP
────────────────────────────────────────────────────────────────────────────────────────────
UserA WebRTC        → getUserMedia() → Creates localStream
UserA WebRTC        → WS: { type: "webrtc-offer", data: { to: Bob, offer: {...} } }

Go Backend Server   ← Forwards to target client (Bob)
UserB WebRTC        ← Receives { type: "webrtc-offer" }
UserB WebRTC        → Sets remoteDescription → createAnswer()
UserB WebRTC        → WS: { type: "webrtc-answer", data: { to: Alice, answer: {...} } }

Go Backend Server   ← Forwards to Alice
UserA WebRTC        ← Receives answer → sets remoteDescription
Both clients exchange ICE candidates via:
  webrtc-ice-candidate messages (forwarded through backend)

Peer-to-peer connection established 
Local and remote <video> elements appear inside overlay

────────────────────────────────────────────────────────────────────────────────────────────

★ 6. KEEP-ALIVE & RATE LIMITING
────────────────────────────────────────────────────────────────────────────────────────────
Every 30s:
Background.js       → WS: { type: "ping" }
Go Backend Server   ← Updates lastPing[clientID]
If inactive >60s:
  → closes connection, deletes from clients map

Video-sync events:
  → Limited to 5 per second per client via `isRateLimited()` + content.js throttle

────────────────────────────────────────────────────────────────────────────────────────────

★ 7. DISCONNECTION / CLEANUP
────────────────────────────────────────────────────────────────────────────────────────────
UserB closes tab / loses connection:
Go Backend Server   ← Detects closed socket, removes participant
                    → Broadcasts to remaining clients:
                        { type: "participant-left", data: { participantId: "Bob" } }

UserA Content.js    ← Receives participant-left → updates overlay UI

If room empty → server deletes room entry from memory:
  log.Printf("Room deleted: room_12345 (empty)")

────────────────────────────────────────────────────────────────────────────────────────────

★ 8. BACKEND RESTART
────────────────────────────────────────────────────────────────────────────────────────────
All data wiped (stateless by design)
background.js       → Detects WS disconnect → tries reconnect (with backoff)
popup.js            → On reconnect: auto-rejoin lastRoomId
→ WS: { type: "join-room", roomId: "room_12345", username: "Alice" }

Server rebuilds room state dynamically.
────────────────────────────────────────────────────────────────────────────────────────────
```

## Quick Start

### Prerequisites

- Node.js 18+ and npm
- Go 1.21+
- Chrome or Firefox browser

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd cinebuddy
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build-extension
   ```

4. **Start the backend server**
   ```bash
   npm run start-backend
   ```

5. **Load the extension in your browser**
   - Chrome: Go to `chrome://extensions/`, enable Developer mode, click "Load unpacked", select the `dist` folder
   - Firefox: Go to `about:debugging`, click "This Firefox", click "Load Temporary Add-on", select `dist/manifest.json`

### Development

1. **Start development mode**
   ```bash
   # Terminal 1: Watch for changes and rebuild
   npm run dev
   
   # Terminal 2: Start backend server
   npm run dev-backend
   ```

2. **Reload the extension** in your browser after making changes

## Usage

### Web Client (Primary Interface)
1. **Access the web client** at `http://localhost:8080`
2. **Create or join a room** with your username
3. **Paste video URLs** (YouTube, Vimeo, etc.) to watch together
4. **Use chat and video calls** to communicate with friends
5. **Share room links** with friends to invite them

### Chrome Extension (DRM Content)
1. **Install the extension** in Chrome
2. **Navigate to DRM sites** (Netflix, Disney+, Prime Video, etc.)
3. **The extension automatically connects** to active CineBuddy rooms
4. **Video sync and chat work seamlessly** between web client and extension

## Supported Platforms

- Netflix
- Hulu
- YouTube
- Disney+
- Amazon Prime Video
- HBO Max
- Generic HTML5 video players

## Technical Details

### Extension Structure
```
extension/
├── popup/           # React popup UI
├── content/         # Video detection and sync
├── background/      # Service worker
├── components/      # Shared UI components
└── manifest.json    # Extension manifest
```

### Backend API

**WebSocket Endpoints:**
- `ws://localhost:8080/ws` - Main WebSocket connection

**REST Endpoints:**
- `POST /create-room` - Create a new room
- `POST /join-room` - Join an existing room
- `GET /rooms` - List all rooms
- `GET /health` - Health check

### WebSocket Message Types

- `join-room` - Join a room
- `leave-room` - Leave a room
- `video-sync` - Video playback synchronization
- `chat-message` - Chat messages
- `participant-joined` - New participant notification
- `participant-left` - Participant left notification

## Configuration

### Backend Configuration
- **Port**: 8080 (configurable in `backend/main.go`)
- **Max Rooms**: 5 concurrent rooms
- **Max Users per Room**: 15 users
- **CORS**: Enabled for all origins (development)

### Extension Configuration
- **Supported Sites**: Configured in `manifest.json`
- **Permissions**: Active tab, storage, scripting
- **Host Permissions**: All supported streaming sites

## Security & Privacy

- **No DRM Circumvention**: Uses companion mode for protected content
- **Ephemeral Data**: No persistent storage, all data cleared on restart
- **TLS Required**: Secure WebSocket connections
- **Minimal Permissions**: Only necessary browser permissions

## Limitations

- Maximum 15 users per room
- Maximum 5 concurrent rooms (75 total users)
- No persistent data storage
- Requires active internet connection
- Some streaming services may have restrictions

## Troubleshooting

### Common Issues

1. **Extension not loading**
   - Check browser console for errors
   - Ensure all files are built correctly
   - Verify manifest.json is valid

2. **Backend connection failed**
   - Check if backend server is running on port 8080
   - Verify firewall settings
   - Check browser console for WebSocket errors

3. **Video sync not working**
   - Ensure all participants are in the same room
   - Check if video is detected on the page
   - Verify WebSocket connection is active

### Debug Mode

Enable debug logging by opening browser developer tools and checking the console for detailed logs.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## 🧪 Manual Testing Guide

### Phase 1: Web Client Testing
1. **Start the backend**
   ```bash
   cd backend && go run main.go
   ```

2. **Test room creation**
   - Open `http://localhost:8080` in two different browser tabs
   - Tab 1: Create a room with username "Alice"
   - Tab 2: Join the room with username "Bob"
   - Verify both users see each other in the participant list

3. **Test video synchronization**
   - In Tab 1: Paste a YouTube URL and start playing
   - In Tab 2: Verify the video starts playing automatically
   - Test play/pause/seek - both tabs should stay synchronized

4. **Test chat functionality**
   - Send messages from both tabs
   - Verify messages appear in both chat panels
   - Test system messages (join/leave notifications)

### Phase 2: WebRTC Video Calls
1. **Test video call initiation**
   - In Tab 1: Click "Start Call" and allow camera/microphone access
   - In Tab 2: Verify the call starts automatically
   - Check that both users can see each other's video

2. **Test call controls**
   - Test mute/unmute functionality
   - Test video on/off functionality
   - Test call end functionality

3. **Test multiple participants**
   - Open a third tab and join the room
   - Verify the third participant can join the video call
   - Test that all participants can see each other

### Phase 3: Extension Integration
1. **Load the Chrome extension**
   - Go to `chrome://extensions/`
   - Enable Developer mode
   - Load unpacked extension from the `extension` folder

2. **Test DRM site integration**
   - Open Netflix, Disney+, or Prime Video in Chrome
   - Create a room in the web client (`http://localhost:8080`)
   - Verify the extension shows "Extension Connected" status

3. **Test cross-platform sync**
   - Play a video on Netflix (with extension)
   - Play a different video on the web client
   - Verify both sync with each other

4. **Test chat integration**
   - Send messages from the web client
   - Verify they appear in the extension's chat overlay
   - Send messages from the extension
   - Verify they appear in the web client

### Phase 4: End-to-End Testing
1. **Complete watch party scenario**
   - User A: Creates room in web client, plays YouTube video
   - User B: Joins room in web client, starts video call
   - User C: Joins room via Chrome extension on Netflix
   - Verify all three users are synchronized and can communicate

2. **Test room persistence**
   - Create a room and add participants
   - Restart the backend server
   - Verify the room is recreated and participants can rejoin

3. **Test error handling**
   - Disconnect network and verify reconnection
   - Test with invalid room IDs
   - Test with missing permissions (camera/microphone)

### Expected Results
- ✅ Video synchronization works across all platforms
- ✅ Chat messages appear in real-time
- ✅ Video calls work with multiple participants
- ✅ Extension integrates seamlessly with web client
- ✅ Room state persists across server restarts
- ✅ Error handling works gracefully

## Support

For issues and questions:
- Check the troubleshooting section
- Open an issue on GitHub
- Review the project documentation

---

**Note**: This extension is for educational and personal use. Please respect the terms of service of streaming platforms and use responsibly.
