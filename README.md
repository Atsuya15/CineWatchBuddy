# CineBuddy

![CineBuddy](assets/icons/CineBuddyLogo.png)

A browser extension that enables synchronized video playback across streaming services (YouTube,Vimeo etc.) with friends in real-time.

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

## Project Structure

```
CineBuddy/
├── src/
│   ├── extension/          # Chrome Extension (Manifest V3)
│   │   ├── background/     # Service Worker
│   │   ├── content/        # Content Scripts
│   │   ├── popup/          # Extension Popup UI
│   │   ├── components/     # Shared Components
│   │   └── manifest.json   # Extension Manifest
│   ├── web/               # React Web Client
│   │   ├── src/
│   │   │   ├── components/ # React Components
│   │   │   └── main.jsx    # App Entry Point
│   │   └── package.json    # Frontend Dependencies
│   └── server/            # Go Backend Server
│       ├── main.go        # WebSocket Server
│       └── go.mod         # Go Dependencies
├── assets/
│   └── icons/            # Logo and Assets
├── scripts/
│   └── build.js          # Build Script
└── dist/                 # Built Extension (Generated)
```

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CineBuddy Platform                                            │
│                              (Web Client + Extension + Backend)                                 │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
                                            │
         ┌──────────────────────────────────┼──────────────────────────────────┐
         │                                  │                                  │
         ▼                                  ▼                                  ▼
┌─────────────────────┐          ┌─────────────────────┐          ┌─────────────────────┐
│   Web Client        │          │  Chrome Extension   │          │   Go Backend        │
│   (React SPA)       │          │   (Manifest V3)     │          │   (WebSocket)       │
│                     │          │                     │          │                     │
│ src/web/            │          │ src/extension/      │          │ src/server/         │
│ ├── components/     │          │ ├── background/     │          │ ├── main.go         │
│ ├── App.jsx         │          │ ├── content/        │          │ └── go.mod          │
│ └── package.json    │          │ ├── popup/          │          │                     │
│                     │          │ ├── components/     │          │ - Room Management   │
│ - Video Player      │          │ └── manifest.json   │          │ - WebSocket Server  │
│ - Chat Panel        │          │                     │          │ - REST API          │
│ - Video Grid        │          │ - Service Worker    │          │ - WebRTC Signaling  │
│ - Room Management   │          │ - Content Scripts   │          │ - Chat History      │
│ - WebRTC Calls      │          │ - DRM Site Support  │          │                     │
└─────────────────────┘          │ - Video Sync        │          └─────────────────────┘
         │                       │ - Chat Overlay      │                     │
         │                       │ - WebRTC Signaling  │                     │
         │                       └─────────────────────┘                     │
         │                                │                                  │
         │                                │                                  │
         └────────────────────────────────┼──────────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │     Communication Layer     │
                              │─────────────────────────────│
                              │                             │
                              │ WebSocket (ws://localhost)  │
                              │ ├── video-sync              │
                              │ ├── chat-message            │
                              │ ├── webrtc-offer/answer     │
                              │ ├── participant-joined/left │
                              │ └── room-update             │
                              │                             │
                              │ REST API (http://localhost) │
                              │ ├── /create-room (POST)     │
                              │ ├── /join-room (POST)       │
                              │ ├── /rooms (GET)            │
                              │ └── /join?room=<id> (GET)   │
                              └─────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │      Data Management        │
                              │─────────────────────────────│
                              │                             │
                              │ In-Memory Storage:          │
                              │ ├── rooms map[string]*Room  │
                              │ ├── clients map[string]*WS  │
                              │ ├── rateLimiter             │
                              │ └── ping checkers           │
                              │                             │
                              │ Room State:                 │
                              │ ├── VideoState (current)    │
                              │ ├── ChatHistory (last 100)  │
                              │ ├── Participants[]          │
                              │ └── LastActivity            │
                              └─────────────────────────────┘
                                          │
                                          ▼
                              ┌─────────────────────────────┐
                              │    External Integrations    │
                              │─────────────────────────────│
                              │                             │
                              │ WebRTC:                     │
                              │ ├── STUN Servers (Google)   │
                              │ ├── TURN Servers (Optional) │
                              │ └── P2P Video Calls         │
                              │                             │
                              │ DRM Platforms:              │
                              │ ├── Netflix, Disney+        │
                              │ ├── Amazon Prime, Hulu      │
                              │ ├── HBO Max, Paramount+     │
                              │ └── PeacockTV               │
                              └─────────────────────────────┘
```

## Sequence Diagram

```
───────────────────────────────  CineBuddy Watch Party Flow  ───────────────────────────────

Actors:
───────
WebClientA (Host)   React SPA at localhost:8080 (User A)
WebClientB (Joiner) React SPA at localhost:8080 (User B)
ExtensionA          Chrome Extension on DRM site (User A)
ExtensionB          Chrome Extension on DRM site (User B)
Go Backend Server   WebSocket + REST API server

Legend:
────────
→  : HTTP or WS message sent
←  : Response / event received
...: Parallel action
★  : Key event in flow

────────────────────────────────────────────────────────────────────────────────────────────

★ 1. ROOM CREATION (Web Client)
────────────────────────────────────────────────────────────────────────────────────────────
WebClientA         → POST /create-room { username: "Alice" }
Go Backend Server  ← 200 OK { roomId: "room_12345", shareLink: "http://localhost:8080/join?room=room_12345" }

WebClientA         → WS: { type: "join-room", roomId: "room_12345", username: "Alice" }
Go Backend Server  ← Adds Alice as host, stores room state
                    → WS to Alice: { type: "room-joined", data: {room, participants, videoState, chatHistory} }

────────────────────────────────────────────────────────────────────────────────────────────

★ 2. JOINING THE ROOM (Web Client)
────────────────────────────────────────────────────────────────────────────────────────────
WebClientB         → GET /join?room=room_12345
Go Backend Server  ← 200 OK { roomId: "room_12345" }

WebClientB         → WS: { type: "join-room", roomId: "room_12345", username: "Bob" }
Go Backend Server  ← Validates room + username
                    → WS to Bob: { type: "room-joined", data: {room, participants, videoState, chatHistory} }
                    → WS Broadcast to all:
                        { type: "participant-joined", data: { participant: Bob } }

WebClientA         ← Updates participant list in UI
WebClientB         ← Loads room state, video, and chat history

────────────────────────────────────────────────────────────────────────────────────────────

★ 3. EXTENSION INTEGRATION (DRM Sites)
────────────────────────────────────────────────────────────────────────────────────────────
ExtensionA (Netflix) → Detects video element on page
ExtensionA         → WS: { type: "join-room", roomId: "room_12345", username: "Alice" }
Go Backend Server  ← Validates existing room membership
                    → WS to ExtensionA: { type: "room-joined", data: {room, participants} }

ExtensionA         → window.postMessage to WebClientA: { action: "extensionReady", roomId: "room_12345" }
WebClientA         ← Updates UI to show "Extension Connected"

────────────────────────────────────────────────────────────────────────────────────────────

★ 4. VIDEO SYNC (Web Client → Extension)
────────────────────────────────────────────────────────────────────────────────────────────
WebClientA VideoPlayer → User plays video
WebClientA         → WS: { type: "video-sync", data: { currentTime: 120, paused: false, videoUrl: "..." } }
Go Backend Server  ← Updates room.CurrentVideo
                    → WS Broadcast: { type: "video-sync", data: {...} }

WebClientB         ← Updates local video player
ExtensionA         ← Receives via background.js → content.js
ExtensionA         → Applies sync to Netflix <video> element

────────────────────────────────────────────────────────────────────────────────────────────

★ 5. VIDEO SYNC (Extension → Web Client)
────────────────────────────────────────────────────────────────────────────────────────────
ExtensionA (Netflix) → User seeks to 5:30
ExtensionA         → chrome.runtime.sendMessage({ action: "videoSync", data: {...} })
ExtensionA Background → WS: { type: "video-sync", data: { currentTime: 330, paused: false } }
Go Backend Server  ← Updates room.CurrentVideo
                    → WS Broadcast: { type: "video-sync", data: {...} }

WebClientA         ← Updates video player position
WebClientB         ← Updates video player position

────────────────────────────────────────────────────────────────────────────────────────────

★ 6. CHAT EXCHANGE
────────────────────────────────────────────────────────────────────────────────────────────
WebClientB ChatPanel → User types "Great movie!"
WebClientB         → WS: { type: "chat-message", data: { username: "Bob", content: "Great movie!", timestamp: "..." } }
Go Backend Server  ← Validates + sanitizes message, stores in room.ChatHistory
                    → WS Broadcast: { type: "chat-message", data: {...} }

WebClientA         ← Displays message in chat panel
ExtensionA         ← Receives via background.js → content.js → chat overlay
ExtensionB         ← Receives via background.js → content.js → chat overlay

────────────────────────────────────────────────────────────────────────────────────────────

★ 7. WEBRTC CALL SETUP
────────────────────────────────────────────────────────────────────────────────────────────
WebClientA VideoGrid → User clicks "Start Video Call"
WebClientA         → getUserMedia() → Creates localStream
WebClientA         → WS: { type: "webrtc-offer", data: { to: "Bob", offer: {...}, roomId: "room_12345" } }

Go Backend Server  ← Validates room access, forwards to Bob
WebClientB         ← Receives { type: "webrtc-offer" }
WebClientB         → Sets remoteDescription → createAnswer()
WebClientB         → WS: { type: "webrtc-answer", data: { to: "Alice", answer: {...}, roomId: "room_12345" } }

Go Backend Server  ← Forwards to Alice
WebClientA         ← Receives answer → sets remoteDescription
Both clients exchange ICE candidates via webrtc-ice-candidate messages

Peer-to-peer connection established
Local and remote video streams appear in VideoGrid component

────────────────────────────────────────────────────────────────────────────────────────────

★ 8. KEEP-ALIVE & RATE LIMITING
────────────────────────────────────────────────────────────────────────────────────────────
Every 30s:
WebClientA         → WS: { type: "ping" }
ExtensionA         → WS: { type: "ping" }
Go Backend Server  ← Updates lastPing[clientID]
If inactive >60s:
  → closes connection, removes from clients map

Video-sync events:
  → Limited to 5 per second per client via rateLimiter + content.js throttle

────────────────────────────────────────────────────────────────────────────────────────────

★ 9. DISCONNECTION / CLEANUP
────────────────────────────────────────────────────────────────────────────────────────────
WebClientB closes tab:
Go Backend Server  ← Detects closed socket, removes participant
                    → WS Broadcast: { type: "participant-left", data: { participantId: "Bob" } }

WebClientA         ← Updates participant list
ExtensionA         ← Updates participant list in overlay

If room empty → server deletes room entry from memory

────────────────────────────────────────────────────────────────────────────────────────────

★ 10. BACKEND RESTART
────────────────────────────────────────────────────────────────────────────────────────────
All data wiped (stateless by design)
WebClientA         → Detects WS disconnect → tries reconnect (with backoff)
ExtensionA         → Detects WS disconnect → tries reconnect (with backoff)
On reconnect:
  → WS: { type: "join-room", roomId: "room_12345", username: "Alice" }

Server rebuilds room state dynamically from reconnecting clients.
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

## Manual Testing Guide

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
