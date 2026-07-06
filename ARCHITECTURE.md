# CineWatchBuddy — System Architecture

CineWatchBuddy is a synchronized watch‑party app. A **Go backend** serves the
**React web client** from a single origin, relays real‑time events over
**WebSockets**, and stores room state in **SQLite**. Camera/mic uses
**peer‑to‑peer WebRTC** (the backend only relays signaling). An optional
**Chrome extension** brings sync to DRM streaming sites.

---

## Component architecture

```mermaid
flowchart TB
  subgraph A["🌐 Browser A — React Web Client (SPA)"]
    direction TB
    RP["RoomPage<br/>layout · presence · WebRTC"]
    VP["VideoPlayer<br/>YouTube / HTML5 sync"]
    CP["ChatPanel"]
    CG["CameraGrid<br/>resizable tiles"]
    FW["FloatingWindow<br/>drag/resize panels"]
    WSM(["websocketManager<br/>shared WS singleton"])
    RP --> VP
    RP --> CP
    RP --> CG
    RP --> FW
    VP --> WSM
    RP --> WSM
  end

  B["🌐 Browser B<br/>(same SPA)"]

  CF{{"☁️ Cloudflare Tunnel<br/>*.trycloudflare.com"}}

  subgraph GO["🟦 Go Backend — single origin :8080"]
    direction TB
    ST["Static server + SPA fallback<br/>serves the built React app"]
    REST["REST API<br/>/create-room · /join-room<br/>/rooms · /health · /ext-test"]
    WSH["WebSocket /ws<br/>rooms · participants · video-sync<br/>chat · WebRTC signaling relay"]
  end

  DB[("🗄️ SQLite<br/>rooms · participants<br/>chat history · video state")]
  ICE["STUN / TURN servers"]
  YT["YouTube IFrame API"]

  A -->|"HTTPS + WSS"| CF
  B -->|"HTTPS + WSS"| CF
  CF --> ST
  CF --> REST
  CF --> WSH
  ST -.->|"serves SPA"| A
  ST -.->|"serves SPA"| B
  REST --> DB
  WSH --> DB
  WSM <-->|"video-sync · chat · presence · signaling"| WSH

  A <-->|"WebRTC P2P — camera / mic"| B
  A -.->|"ICE"| ICE
  B -.->|"ICE"| ICE
  VP -.->|"loads player"| YT

  subgraph EXT["🧩 Chrome Extension (MV3) — optional, DRM sites"]
    direction TB
    CS["Content scripts<br/>detect + sync &lt;video&gt;"]
    PU["Popup UI"]
    BG["Background service worker<br/>WS client"]
    CS --> BG
    PU --> BG
  end
  BG -->|"WSS"| CF
```

**Key points**

- **Single origin.** The Go server serves the built SPA *and* the REST + WS API,
  so one Cloudflare Tunnel URL exposes everything. The client derives its API/WS
  URLs from `window.location.origin` (http→ws, https→wss) — no hardcoded host.
- **WebSocket is the real‑time bus.** One shared connection per browser
  (`websocketManager`) carries room join, presence, chat, video sync, and WebRTC
  signaling.
- **Media is peer‑to‑peer.** Camera/mic never touches the backend; the backend
  only relays offer/answer/ICE. STUN/TURN handle NAT traversal.
- **The extension is optional** and independent — a thin bridge for DRM sites; the
  web client alone covers YouTube/Vimeo/direct URLs.

---

## Watch‑party message flow

```mermaid
sequenceDiagram
  actor A as User A (browser)
  actor B as User B (browser)
  participant S as Go Backend (REST + WS)
  participant DB as SQLite

  Note over A,S: Create a room
  A->>S: POST /create-room {username, roomName}
  S->>DB: create room (friendly slug id)
  S-->>A: {roomId}
  A->>S: WS /ws?room&user  +  join-room
  S->>DB: add participant
  S-->>A: room-joined {participants, chatHistory, videoState}

  Note over A,B: A shares the invite link → B opens it
  B->>S: WS connect + join-room
  S-->>B: room-joined {...}
  S-->>A: participant-joined {B}

  Note over A,B: Synchronized playback
  A->>S: video-sync {url, currentTime, paused}
  S->>DB: update video state
  S-->>B: video-sync  (broadcast to room EXCEPT sender)
  B->>B: apply play / pause / seek

  Note over A,B: Chat
  A->>S: chat-message
  S->>DB: store (last 100)
  S-->>A: chat-message
  S-->>B: chat-message

  Note over A,B: Camera call (WebRTC)
  A->>S: webrtc-offer / webrtc-ice-candidate
  S-->>B: relay
  B->>S: webrtc-answer / webrtc-ice-candidate
  S-->>A: relay
  A-->>B: P2P media stream (camera/mic) via STUN/TURN

  Note over A,B: Leave / disconnect
  B-->>S: socket closes
  S->>S: grace period, then participant-left
  S-->>A: participant-left {B}
```

---

## WebSocket message types

| Type | Direction | Purpose |
|---|---|---|
| `join-room` | client → server | Register as a participant (sent on connect/reconnect) |
| `room-joined` | server → client | Initial state: participants, chat history, video state |
| `participant-joined` / `participant-left` | server → room | Presence (leave is delayed by a grace period) |
| `video-sync` | client → server → room* | Play / pause / seek / url (*broadcast to everyone **except the sender**) |
| `chat-message` | client → server → room | Chat + join/leave system notices |
| `webrtc-offer` / `webrtc-answer` / `webrtc-ice-candidate` | client → server → room | WebRTC signaling relay (media stays P2P) |
| `webrtc-call-started` / `webrtc-call-ended` | client → server → room | Camera on/off notifications |
| `ping` / `pong` | both | Keep‑alive |

---

## Components at a glance

| Component | Tech | Responsibility |
|---|---|---|
| **Web client** | React + Vite + Tailwind | UI: landing, room, resizable/floating Camera & Chat panels, `VideoPlayer`, `CameraGrid` |
| `websocketManager` | JS singleton | One shared WS per browser; reconnect with backoff; origin‑based URL |
| **Backend** | Go (`net/http`, gorilla/websocket) | REST rooms, WS hub, per‑connection serialized writes, static SPA serving |
| **Database** | SQLite (`mattn/go-sqlite3`) | Rooms, participants, chat history, video state |
| **WebRTC** | Browser RTCPeerConnection | P2P camera/mic; perfect‑negotiation; STUN + TURN |
| **Extension** | Chrome MV3 | Background WS client + content scripts to sync DRM `<video>` elements |
| **Tunnel** | Cloudflare `cloudflared` | Public HTTPS/WSS URL to the local backend |

---

## Deployment shape

```mermaid
flowchart LR
  Dev["Developer machine"]
  subgraph Local["localhost:8080"]
    GoBin["Go binary<br/>(serves SPA + API + WS)"]
    Sqlite[("cinewatchbuddy.db")]
    GoBin --- Sqlite
  end
  Friend["👥 Friend's browser"]

  Dev --> Local
  Local -->|"cloudflared tunnel --url"| Public{{"https://xxxx.trycloudflare.com"}}
  Friend -->|"opens public URL"| Public
```

Single lightweight Go binary + one SQLite file. For public testing, `cloudflared`
exposes it; for production it can sit behind any TLS reverse proxy (same single
origin).
