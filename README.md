# CineWatchBuddy

![CineWatchBuddy](assets/icons/CineWatchBuddyLogo.png)

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
CineWatchBuddy/
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
│                                    CineWatchBuddy Platform                                            │
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
───────────────────────────────  CineWatchBuddy Watch Party Flow  ───────────────────────────────

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

## How to Use

Follow these steps to clone the repo and run a watch party locally.

### Prerequisites

- **Node.js 18+** and npm (developed on Node 20/26)
- **Go 1.21+** with a C compiler available — the backend stores state in SQLite via CGO:
  - macOS: `xcode-select --install`
  - Debian/Ubuntu: `sudo apt install build-essential`
  - Windows: a gcc toolchain such as [TDM-GCC](https://jmeubank.github.io/tdm-gcc/) or MinGW-w64
- **Google Chrome** (only required for the optional browser extension)

### 1. Clone and install dependencies

```bash
git clone <repository-url>
cd CineWatchBuddy
npm run install-deps        # installs root deps, Go modules, and web-client deps
```

> `install-deps` is a shortcut for: `npm install` &nbsp;+&nbsp; `cd src/server && go mod tidy` &nbsp;+&nbsp; `cd src/web && npm install`.
>
> On recent npm versions the web client's `esbuild`/`vite` install script may be blocked. If step 3 later fails with an esbuild error, run:
> ```bash
> cd src/web
> npm approve-scripts --allow-scripts-pending   # allow esbuild + fsevents
> npm rebuild esbuild
> ```

### 2. Start the backend (Terminal 1)

```bash
npm run start-backend
```

Runs the Go WebSocket + REST server on **http://localhost:8080** and creates a local `cinewatchbuddy.db` (SQLite, git-ignored). You should see `Starting CineWatchBuddy server on port 8080`.

### 3. Start the web client (Terminal 2)

```bash
npm run start-web
```

Runs the Vite dev server on **http://localhost:3000** and proxies API + WebSocket traffic to the backend. **Open http://localhost:3000 in your browser.**

### 4. Start a watch party

1. Enter a **username**.
2. **Create a room** — optionally give it a friendly name like `movie-night` so friends can join by that name instead of a long id. Or use **Join** with a room name or id.
3. Paste a **YouTube / Vimeo / direct video URL** and click **Load Video**. Play, pause, and seek stay in sync for everyone in the room.
4. Use the **Chat** panel, and **Start camera** for WebRTC webcam chat. The camera and chat panels are collapsible and resizable.
5. Click **🔗 Invite** to copy the room link — or just tell friends the room name.

To see it sync, open a second browser (or another device on your network) and join the same room.

### 5. (Optional) Chrome extension for DRM sites

The extension keeps playback in sync on streaming sites that block normal embedding (Netflix, Disney+, Prime Video, Hulu, HBO Max, Paramount+, Peacock).

1. **Build it:**
   ```bash
   npm run build      # outputs the unpacked extension to ./dist
   ```
2. **Load it in Chrome:**
   - Open `chrome://extensions/`
   - Enable **Developer mode** (top-right)
   - Click **Load unpacked** and select the `dist` folder
   - Pin the CineWatchBuddy icon — the badge shows **ON** when it's connected to the backend
3. Click the icon, enter a username, then **Create** or **Join** a room.
4. Open a supported streaming site and play a video — play/pause/seek sync with everyone in that room.

> **Try the extension sync locally (no subscription needed):** with the backend running, open **http://localhost:8080/ext-test** in two Chrome windows that both have the extension loaded and are joined to the same room. Play/pause the test video in one and it reflects in the other.
>
> After changing extension source, run `npm run build` again and click the **reload** icon on the extension's card in `chrome://extensions/`.

### Production build (serve everything from Go)

To serve the web client from the Go server instead of the Vite dev server:

```bash
npm run build-web        # builds the React app into src/web/dist
npm run start-backend    # Go serves it at http://localhost:8080
```

### Troubleshooting

- **Backend won't start / `address already in use`** — port 8080 is busy. Free it and retry: `lsof -ti :8080 | xargs kill` (macOS/Linux).
- **`go run` fails with cgo/sqlite errors** — install a C compiler (see Prerequisites).
- **Web client is blank or shows WebSocket errors** — make sure the backend is running on :8080 and you opened the app at **:3000** (not :8080).
- **`esbuild`/vite install error** — run the approve-scripts commands from step 1.

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

### Prerequisites Setup
1. **Install Go dependencies**
   ```bash
   cd src/server
   go mod tidy
   ```

2. **Install Node.js dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

### Step 1: Load Chrome Extension
1. **Open Chrome Extensions page**
   - Go to `chrome://extensions/`
   - Enable "Developer mode" (toggle in top-right)

2. **Load the extension**
   - Click "Load unpacked"
   - Navigate to `F:\RESUME\Assignments\CineWatchBuddy\dist` folder
   - Select the folder and click "Select Folder"

3. **Verify extension loaded**
   - You should see "CineWatchBuddy" extension in the list
   - Pin the extension to your toolbar (click the puzzle piece icon)
   - The CineWatchBuddy icon should appear in your toolbar

### Step 2: Start Backend Server
1. **Open PowerShell/Terminal**
   ```bash
   cd src/server
   go run main.go
   ```

2. **Verify server started**
   - You should see: "Starting CineWatchBuddy server on port 8080"
   - Database should be created: "Database: ./CineWatchBuddy.db"
   - Server should show: "Loaded X rooms from database"

### Step 3: Test Web Client
1. **Open web client**
   - Go to `http://localhost:8080` in Chrome
   - You should see the CineWatchBuddy landing page

2. **Create a room**
   - Enter username: "TestUser1"
   - Click "Create Room"
   - You should see a room page with video player and chat

3. **Test video playback**
   - Paste a YouTube URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`)
   - Click "Load" button
   - Video should start playing

### Step 4: Test Extension Integration
1. **Open a DRM site**
   - Go to Netflix, Disney+, or Prime Video
   - The extension should automatically detect the page

2. **Check extension status**
   - Click the CineWatchBuddy extension icon in toolbar
   - You should see "Extension Connected" or connection status
   - The popup should show room information

3. **Test video sync from extension**
   - Play a video on the DRM site
   - Check if the web client video syncs (if in same room)
   - The extension should show sync indicators

### Step 5: Test Cross-Platform Sync
1. **Open second browser tab**
   - Go to `http://localhost:8080` in a new tab
   - Join the same room with username "TestUser2"

2. **Test bidirectional sync**
   - Play video in web client → should sync to extension
   - Play video in extension → should sync to web client
   - Test play/pause/seek in both directions

### Step 6: Test Chat Functionality
1. **Web client chat**
   - Send messages from web client chat panel
   - Messages should appear in real-time

2. **Extension chat**
   - Click the chat button in extension popup
   - Send messages from extension
   - Messages should appear in web client

### Step 7: Test WebRTC Video Calls
1. **Start video call**
   - In web client, click "Start Video Call"
   - Allow camera/microphone permissions
   - Video call interface should appear

2. **Test call features**
   - Mute/unmute microphone
   - Turn video on/off
   - End call functionality

### Step 8: Test Room Persistence
1. **Restart backend server**
   - Stop the Go server (Ctrl+C)
   - Start it again: `go run main.go`
   - Server should restore previous rooms

2. **Rejoin room**
   - Refresh the web client page
   - Rejoin the same room
   - Chat history should be restored

### Step 9: Test Error Handling
1. **Network disconnection**
   - Disconnect internet briefly
   - Extension should show "Reconnecting..." status
   - Reconnect and verify sync resumes

2. **Invalid room ID**
   - Try joining a non-existent room
   - Should show appropriate error message

### Expected Results 
- **Extension loads successfully** in Chrome
- **Web client accessible** at localhost:8080
- **Video sync works** between web client and extension
- **Chat messages** appear in real-time across platforms
- **WebRTC calls** work with camera/microphone
- **Room persistence** survives server restarts
- **Error handling** works gracefully

### Troubleshooting
- **Extension not loading**: Check if `dist` folder exists and has manifest.json
- **Server won't start**: Ensure port 8080 is not in use
- **Video not syncing**: Check browser console for WebSocket errors
- **Chat not working**: Verify WebSocket connection is active
- **WebRTC not working**: Check camera/microphone permissions

### Debug Tips
- Open Chrome DevTools (F12) to see console logs
- Check extension popup for connection status
- Monitor network tab for WebSocket connections
- Use `chrome://extensions/` to reload extension after changes

## Support

For issues and questions:
- Check the troubleshooting section
- Open an issue on GitHub
- Review the project documentation

---

**Note**: This extension is for educational and personal use. Please respect the terms of service of streaming platforms and use responsibly.
