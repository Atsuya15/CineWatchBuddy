# CineBuddy Extension Development Plan

## Project Overview
Build a browser extension that enables users to synchronize video playback across streaming services (Netflix, Hulu, etc.) and other sites, create/join virtual rooms, chat, and share controls in real-time.

---

## 1. Goals & Constraints

- Core objective: Synchronized watch parties (video, audio, chat) via a lightweight browser extension and Go-based backend.
- **No external database:** All state held in local browser cache and in-memory maps on backend.
- **Maximum user limit:** 15 users per room; up to 5 concurrent rooms (75 users total).
- **Minimal UI:** React popup and overlay only, no complex routing or state management.
- **Supported platforms:** Chrome/Firefox (Manifest V3), Compatible with Netflix, Hulu, YouTube, generic HTML5 video.
- **Legal compliance:** Do not attempt to circumvent DRM on protected players; leverage "companion mode" for those.
- **No persistent storage:** Backend can be restarted without data loss concerns.

---

## 2. Functional Requirements

**Browser Extension:**
- Detect supported `<video>` tags (site-specific and generic logic).
- Show a badge if video(s) detected.
- Provide popup for login (local cache), create/join room, list videos, invite/share.
- Overlay panel with chat, participant list, presence, and video call (WebRTC).
- Sync play/pause/seek actions, chat messages, and WebRTC signaling with backend.
- Peer-to-peer video calls via WebRTC.

**Rooms:**
- Create/join/up to 15 in a room, 5 rooms at once.
- Assign room owner; allow host/participant permissions.
- Presence and join/leave detection.
- Simple authentication (username stored locally).

**Backend (Go):**
- In-memory session map: room <-> participants.
- WebSocket endpoints for room sync, chat, presence, signaling.
- REST endpoints for create/join room, minimal metadata.
- WebRTC signaling handled by backend (no media relay).
- Stateless and restart-proof.

---

## 3. Non-Functional Requirements

- Latency: <500ms for playback or signaling, <1s for room join/sync.
- Scalability: Cap intentionally set low; code handles up to 75 users efficiently.
- Security: TLS required for extension ↔ backend, sanitize all incoming data, minimal personal data.
- Privacy: No central user registry; usernames ephemeral; chat not persisted.

---

## 4. Architecture Overview

- **Frontend**
  - React for popup/overlay (Tailwind for fast styling).
  - Content script for video detection/control.
  - LocalStorage for username/session, room cache.

- **Backend**
  - Go WebSocket server (Gorilla WebSocket or net/http).
  - REST endpoints for room management, local sessions only.
  - In-memory maps for rooms/users.
  - WebRTC signaling for peer connections.

- **Extension structure**
    - extension/
        ├─ popup/ # Room UI
        ├─ content/ # Video detection/sync
        ├─ background/ # Connection/state
        ├─ components/ # Chat/call overlay
        ├─ manifest.json



## 5. API & Data Flow

**Backend endpoints:**
- POST /create-room → Returns { roomId }
- POST /join-room → Receives { roomId, username }
- WebSocket events:
- video-sync
- chat-message
- webrtc-offer/answer
- presence-update

**Frontend->Backend data flow:**
- Room/session data flows over WS.
- Video call signaling via WS.
- UI state in local cache.

---

## 6. Security & Compliance

- No DRM circumvention; for protected streams, use companion mode only.
- All user state ephemeral, cleared on backend restart.
- TLS required, strict CORS on backend endpoints.

---

## 7. Testing & QA

- Manual room join/playback test across multiple Chrome/Firefox clients.
- Load test for 15 users/session (simulate video sync, chat, calls).
- Unit tests for content script (video/event detection); basic Go backend session logic.

---

## 8. Release & Deployment

- Extension: Manual load (unpacked) or Web Store/AMO.
- Backend: Single Go binary deployable to Render, Fly.io, or localhost.

---

## 9. Milestones

- Sprint 1: Repo setup, extension scaffold, Go backend base
- Sprint 2: Video detection & sync prototype, single-room testing
- Sprint 3: Chat overlay, room logic, signaling implementation
- Sprint 4: Video call integration, browser compatibility
- Sprint 5: Polish UI, limit enforcement, public release

---

## 10. Developer Todos

- [ ] Scaffold extension (React, MV3 manifest)
- [ ] Scaffold Go backend (WebSocket/REST)
- [ ] Video detection implementation (content script)
- [ ] Overlay UI (chat, participants, call)
- [ ] Sync/playback event protocol (WS)
- [ ] Room management REST endpoints
- [ ] WebRTC signaling (integration only)
- [ ] Test for max users/rooms in-memory scaling
- [ ] TLS config, deployment (Render/Fly.io, local)
- [ ] Update docs, finalize workflows

---

## 11. Appendix: Sequence Diagram

UserA (host) Server UserB (joiner)
|---create-room--->|
|<-roomId----------|
|---play/pause---->|
|<-broadcast-------|
|---chat/offer---->|
|<-forward---------|
|---join-room---------------->|
|<-presence-update------------|
|<---sync-------------------->|


