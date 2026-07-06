import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { websocketManager } from '../utils/websocketManager'
import VideoPlayer from './VideoPlayer'
import ChatPanel from './ChatPanel'
import FloatingWindow from './FloatingWindow'
import CameraGrid from './CameraGrid'

const MIN_SIDEBAR = 280
const MAX_SIDEBAR = 620
const MIN_WEBCAM = 120

// STUN for direct connections + free public TURN relays so peers on different
// networks (behind NAT) can still exchange media when a direct path fails.
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
]

const RoomPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState(null)
  const [username, setUsername] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // WebRTC / media state
  const [isCallActive, setIsCallActive] = useState(false)
  const [participants, setParticipants] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [copied, setCopied] = useState(false)
  // Chat history lives here (not in ChatPanel) so it survives toggling the
  // chat window on/off during a session.
  const [chatMessages, setChatMessages] = useState([])
  // Room permissions
  const [isHost, setIsHost] = useState(false)
  const [pendingApproval, setPendingApproval] = useState(false)
  const [joinRequests, setJoinRequests] = useState([]) // [{ username, clientId }]
  const [showPeople, setShowPeople] = useState(false)

  // Layout: right panel (separated from the video by a divider) that holds the
  // floating camera + chat windows
  const [showCamera, setShowCamera] = useState(true)
  const [showChat, setShowChat] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(360)

  // Refs
  const localVideoRef = useRef(null)
  const remoteVideoRefs = useRef(new Map())
  const peers = useRef(new Map()) // peerId -> { pc, makingOffer, polite, pendingCandidates }
  const localStreamRef = useRef(null)
  const participantsRef = useRef([])
  const sidebarRef = useRef(null)

  useEffect(() => {
    const savedUsername = localStorage.getItem('cinewatchbuddy_username')
    if (savedUsername) {
      setUsername(savedUsername)
    } else {
      const newUsername = prompt('Enter your username:')
      if (newUsername) {
        setUsername(newUsername)
        localStorage.setItem('cinewatchbuddy_username', newUsername)
      } else {
        navigate('/')
        return
      }
    }
  }, [navigate])

  useEffect(() => {
    if (!username) return

    websocketManager.connect(id, username).then(() => {
      setIsConnected(true)
      setIsLoading(false)
    }).catch(error => {
      console.error('Failed to connect WebSocket:', error)
      setError('Failed to connect to room')
      setIsLoading(false)
    })

    const handleMessage = (event) => {
      handleWebSocketMessage(event.detail)
    }
    window.addEventListener('cinewatchbuddy-message', handleMessage)

    return () => {
      window.removeEventListener('cinewatchbuddy-message', handleMessage)
      websocketManager.disconnect()
    }
  }, [id, username])

  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.play().catch(e => console.log('Local video play error:', e))
    }
  }, [localStream, showCamera])

  // Keep a ref of participants so WebRTC handlers (bound once) always see the
  // current list rather than a stale closure value.
  useEffect(() => { participantsRef.current = participants }, [participants])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'room-joined':
        if (data.data) {
          setRoom(data.data.room)
          setIsHost(!!data.data.isHost)
          setPendingApproval(false)
          const existing = data.data.room?.participants || []
          setParticipants(existing
            .filter(p => p.isActive !== false && p.username !== username)
            .map(p => ({ id: p.username, username: p.username, isSharing: false, mediaType: null })))
          // Load chat history once (subsequent messages append below)
          const history = data.data.chatHistory || data.data.room?.chatHistory || []
          if (history.length) {
            setChatMessages(history.map(m => ({
              id: m.id, username: m.username, content: m.content,
              timestamp: m.timestamp, type: m.type || 'message'
            })))
          }
        }
        break
      case 'chat-message':
        if (data.data) {
          setChatMessages(prev => prev.some(m => m.id === data.data.id) ? prev : [...prev, data.data])
        }
        break
      case 'participant-joined':
        handleParticipantJoined(data.data)
        break
      case 'participant-left':
        handleParticipantLeft(data.data)
        break
      case 'join-pending':
        setPendingApproval(true)
        break
      case 'join-request':
        if (data.data?.clientId) {
          setJoinRequests(prev => prev.some(r => r.clientId === data.data.clientId)
            ? prev
            : [...prev, { username: data.data.username, clientId: data.data.clientId }])
        }
        break
      case 'join-denied':
        exitRoom('The host declined your request to join.')
        break
      case 'kicked':
        exitRoom('You were removed from the room by the host.')
        break
      case 'room-closed':
        exitRoom(data.data?.reason || 'The room was closed by the host.')
        break
      case 'room-not-found':
        exitRoom('That room no longer exists.')
        break
      case 'room-full':
        exitRoom('This room is full.')
        break
      case 'webrtc-call-started':
        handleCallStarted(data.data)
        break
      case 'webrtc-call-ended':
        handleCallEnded(data.data)
        break
      case 'webrtc-offer':
        handleWebRTCOffer(data.data)
        break
      case 'webrtc-answer':
        handleWebRTCAnswer(data.data)
        break
      case 'webrtc-ice-candidate':
        handleWebRTCIceCandidate(data.data)
        break
      default:
        break
    }
  }

  const addSystemMessage = (text, id) => {
    setChatMessages(prev => prev.some(m => m.id === id) ? prev : [...prev, {
      id, username: 'System', content: text, timestamp: new Date().toISOString(), type: 'system'
    }])
  }

  const handleParticipantJoined = (data) => {
    const joined = data?.participant || data
    const joinedName = joined?.username
    if (!joinedName || joinedName === username) return
    setParticipants(prev => {
      const existing = prev.find(p => p.username === joinedName)
      if (!existing) {
        return [...prev, { id: joinedName, username: joinedName, isSharing: false, mediaType: null }]
      }
      return prev
    })
    addSystemMessage(`${joinedName} joined the room`, `sys-join-${joinedName}`)
    setJoinRequests(prev => prev.filter(r => r.username !== joinedName))
  }

  const handleParticipantLeft = (data) => {
    const leftName = data?.username || data?.participant?.username
    if (!leftName) return
    setParticipants(prev => prev.filter(p => p.username !== leftName))
    addSystemMessage(`${leftName} left the room`, `sys-left-${leftName}-${Date.now()}`)
    // Tear down any peer connection / remote tile for the departing user
    const entry = peers.current.get(leftName)
    if (entry) { entry.pc.close(); peers.current.delete(leftName) }
    setRemoteStreams(prev => {
      if (!prev.has(leftName)) return prev
      const next = new Map(prev)
      next.delete(leftName)
      return next
    })
  }

  const handleCallStarted = (data) => {
    if (!data || data.username === username) return
    setParticipants(prev =>
      prev.map(p => p.username === data.username
        ? { ...p, isSharing: true, mediaType: data.media || 'camera' }
        : p)
    )
    // Ensure a peer connection exists so we can receive their media. If we're
    // already sharing, ensurePeer adds our tracks and negotiation kicks off;
    // perfect negotiation resolves any glare with their offer.
    ensurePeer(data.username)
  }

  const handleCallEnded = (data) => {
    if (!data || data.username === username) return
    setParticipants(prev =>
      prev.map(p => p.username === data.username ? { ...p, isSharing: false, mediaType: null } : p)
    )
    const entry = peers.current.get(data.username)
    if (entry) { entry.pc.close(); peers.current.delete(data.username) }
    setRemoteStreams(prev => {
      if (!prev.has(data.username)) return prev
      const next = new Map(prev)
      next.delete(data.username)
      return next
    })
  }

  const handleWebRTCOffer = async (data) => {
    const { from, to, offer, roomId: offerRoomId } = data
    if (offerRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed offer
    if (to && to !== username) return      // not addressed to us
    const entry = ensurePeer(from)
    const pc = entry.pc
    // Perfect negotiation: on an offer collision, the impolite peer ignores it.
    const collision = entry.makingOffer || pc.signalingState !== 'stable'
    if (!entry.polite && collision) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer)) // implicit rollback if polite
      await flushCandidates(entry)
      await pc.setLocalDescription() // creates the answer
      websocketManager.send('webrtc-answer', { to: from, from: username, answer: pc.localDescription, roomId: id })
    } catch (error) {
      console.error('Error handling WebRTC offer:', error)
    }
  }

  const handleWebRTCAnswer = async (data) => {
    const { from, to, answer, roomId: answerRoomId } = data
    if (answerRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed answer
    if (to && to !== username) return
    const entry = peers.current.get(from)
    if (!entry) return
    try {
      // Only apply an answer when we actually have an outstanding local offer.
      if (entry.pc.signalingState === 'have-local-offer') {
        await entry.pc.setRemoteDescription(new RTCSessionDescription(answer))
        await flushCandidates(entry)
      }
    } catch (error) {
      console.error('Error handling WebRTC answer:', error)
    }
  }

  const handleWebRTCIceCandidate = async (data) => {
    const { from, to, candidate, roomId: candidateRoomId } = data
    if (candidateRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed candidate
    if (to && to !== username) return
    const entry = peers.current.get(from)
    if (!entry || !candidate) return
    const ice = new RTCIceCandidate(candidate)
    // Queue candidates that arrive before the remote description is set.
    if (entry.pc.remoteDescription && entry.pc.remoteDescription.type) {
      try { await entry.pc.addIceCandidate(ice) } catch (e) { console.error('addIceCandidate:', e) }
    } else {
      entry.pendingCandidates.push(ice)
    }
  }

  const flushCandidates = async (entry) => {
    for (const c of entry.pendingCandidates) {
      try { await entry.pc.addIceCandidate(c) } catch (e) { /* ignore */ }
    }
    entry.pendingCandidates = []
  }

  // Create (or reuse) a peer connection to `peerId` using perfect negotiation.
  const ensurePeer = (peerId) => {
    const existing = peers.current.get(peerId)
    if (existing) return existing

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    const entry = {
      pc,
      makingOffer: false,
      // Deterministic roles eliminate offer glare: exactly one side is "polite".
      polite: username < peerId,
      pendingCandidates: []
    }
    peers.current.set(peerId, entry)

    // If we're already sharing, add our tracks now (this triggers negotiation).
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current))
    }

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true
        await pc.setLocalDescription() // implicit offer
        websocketManager.send('webrtc-offer', { to: peerId, from: username, offer: pc.localDescription, roomId: id })
      } catch (e) {
        console.error('negotiationneeded error:', e)
      } finally {
        entry.makingOffer = false
      }
    }
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        websocketManager.send('webrtc-ice-candidate', { to: peerId, from: username, candidate, roomId: id })
      }
    }
    pc.ontrack = (event) => {
      const [stream] = event.streams
      if (stream) setRemoteStreams(prev => new Map(prev).set(peerId, stream))
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        try { pc.restartIce() } catch (e) { /* older browsers */ }
      }
    }
    return entry
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      localStreamRef.current = stream
      setLocalStream(stream)
      setIsCallActive(true)
      setShowCamera(true)

      // Attach our tracks to every peer (existing or new). Adding a track fires
      // onnegotiationneeded, which sends the offer via perfect negotiation.
      participantsRef.current.forEach(participant => {
        if (participant.username === username) return
        const entry = ensurePeer(participant.username)
        const senders = entry.pc.getSenders()
        stream.getTracks().forEach(track => {
          if (!senders.find(s => s.track === track)) {
            entry.pc.addTrack(track, stream)
          }
        })
      })

      websocketManager.send('webrtc-call-started', { username, roomId: id, media: 'camera' })
    } catch (error) {
      console.error('Error starting camera:', error)
      alert('Could not access camera/microphone. Please check permissions.')
    }
  }

  const stopCamera = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop())
      localStreamRef.current = null
    }
    setLocalStream(null)
    peers.current.forEach(entry => entry.pc.close())
    peers.current.clear()
    websocketManager.send('webrtc-call-ended', { username, roomId: id })
    setIsCallActive(false)
    setRemoteStreams(new Map())
  }

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0]
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled
        setIsMuted(!audioTrack.enabled)
      }
    }
  }

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled
        setIsVideoOff(!videoTrack.enabled)
      }
    }
  }

  const handleConnectionChange = (connected) => setIsConnected(connected)

  const leaveRoom = () => {
    websocketManager.send('leave-room', { roomId: id, username })
    websocketManager.disconnect()
    navigate('/')
  }

  // Terminal states (kicked / room closed / denied): stop reconnecting and show
  // a message with a way back home.
  const exitRoom = (message) => {
    websocketManager.disconnect()
    setPendingApproval(false)
    setError(message)
  }

  const approveJoin = (clientId) => {
    websocketManager.send('approve-join', { clientId })
    setJoinRequests(prev => prev.filter(r => r.clientId !== clientId))
  }
  const denyJoin = (clientId) => {
    websocketManager.send('deny-join', { clientId })
    setJoinRequests(prev => prev.filter(r => r.clientId !== clientId))
  }
  const kickParticipant = (name) => {
    websocketManager.send('kick-participant', { username: name })
    setParticipants(prev => prev.filter(p => p.username !== name))
  }

  const copyInvite = async () => {
    const link = `${window.location.origin}/room/${id}`
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      window.prompt('Copy this invite link:', link)
    }
  }

  // The windows float INSIDE the right panel, so their initial positions are
  // relative to that panel (stacked: camera on top, chat below).
  const camLayout = useRef(null)
  const chatLayout = useRef(null)
  if (!camLayout.current) {
    camLayout.current = { x: 10, y: 10, w: 336, h: 250 }
    chatLayout.current = { x: 10, y: 272, w: 336, h: 360 }
  }

  // Resize the right panel by dragging the divider between it and the video.
  const startResizeSidebar = useCallback((e) => {
    e.preventDefault()
    const onMove = (ev) => setSidebarWidth(Math.min(640, Math.max(260, window.innerWidth - ev.clientX)))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-lg">Loading room…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white max-w-sm px-6">
          <p className="text-lg mb-6">{error}</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500">
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (pendingApproval) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center text-white max-w-sm px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <h1 className="text-xl font-semibold mb-2">Waiting for the host…</h1>
          <p className="text-gray-400 mb-6">The room host needs to let you in. This will open automatically once they approve.</p>
          <button onClick={leaveRoom} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg">Cancel</button>
        </div>
      </div>
    )
  }

  const remoteEntries = Array.from(remoteStreams.entries())
  const webcamTileCount = (isCallActive ? 1 : 0) + remoteEntries.length

  // Build the participant camera tiles (local first, then remotes). Each is a
  // keyed element that fills its cell; CameraGrid handles the resizable layout.
  const camTiles = []
  if (isCallActive) {
    camTiles.push(
      <div key="__local" className="w-full h-full relative bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
        <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
        <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded">You</span>
        <div className="absolute top-1 right-1 flex gap-1">
          <button onClick={toggleMute}
            className={`w-6 h-6 rounded-full text-xs flex items-center justify-center ${isMuted ? 'bg-red-600' : 'bg-gray-700/80'}`}>
            {isMuted ? '🔇' : '🎤'}
          </button>
          <button onClick={toggleVideo}
            className={`w-6 h-6 rounded-full text-xs flex items-center justify-center ${isVideoOff ? 'bg-red-600' : 'bg-gray-700/80'}`}>
            {isVideoOff ? '📷' : '📹'}
          </button>
        </div>
      </div>
    )
  }
  remoteEntries.forEach(([participantId, stream]) => {
    camTiles.push(
      <div key={participantId} className="w-full h-full relative bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
        <video
          ref={el => { if (el) { remoteVideoRefs.current.set(participantId, el); el.srcObject = stream } }}
          autoPlay playsInline className="w-full h-full object-cover"
        />
        <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded">{participantId}</span>
      </div>
    )
  })

  return (
    <div className="h-screen flex flex-col bg-black text-white overflow-hidden">
      {/* Top bar */}
      <header className="h-14 shrink-0 bg-gray-950 border-b border-gray-800 flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold tracking-tight">
            <span className="text-blue-500">Cine</span>WatchBuddy
          </span>
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-gray-400 bg-gray-900 rounded-full px-2.5 py-1">
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button onClick={() => setShowPeople(v => !v)}
              className="text-sm bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
              👥 {participants.length + 1}{isHost ? ' · host' : ''}
            </button>
            {showPeople && (
              <div className="absolute right-0 mt-2 w-60 bg-gray-950 border border-gray-800 rounded-lg shadow-xl z-50 py-1 text-sm">
                <div className="px-3 py-1.5 border-b border-gray-800 text-gray-400 text-xs">In this room</div>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <span>{username} <span className="text-gray-500">(you{isHost ? ', host' : ''})</span></span>
                </div>
                {participants.map(p => (
                  <div key={p.username} className="flex items-center justify-between px-3 py-1.5 hover:bg-gray-900">
                    <span>{p.username}{room?.hostUsername === p.username ? ' 👑' : ''}</span>
                    {isHost && (
                      <button onClick={() => kickParticipant(p.username)} title="Remove from room"
                        className="text-xs text-gray-500 hover:text-red-400">Kick</button>
                    )}
                  </div>
                ))}
                {participants.length === 0 && (
                  <div className="px-3 py-1.5 text-gray-600">No one else yet</div>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setShowCamera(v => !v)}
            className={`text-sm rounded-lg px-3 py-1.5 hover:bg-gray-700 ${showCamera ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
            📹 Cameras
          </button>
          <button onClick={() => setShowChat(v => !v)}
            className={`text-sm rounded-lg px-3 py-1.5 hover:bg-gray-700 ${showChat ? 'bg-gray-700 text-white' : 'bg-gray-800 text-gray-400'}`}>
            💬 Chat
          </button>
          <button onClick={copyInvite}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 transition-colors">
            {copied ? '✓ Copied' : '🔗 Invite'}
          </button>
          <button onClick={leaveRoom}
            className="text-sm bg-gray-800 hover:bg-red-600 text-gray-200 hover:text-white rounded-lg px-3 py-1.5 transition-colors">
            Leave
          </button>
        </div>
      </header>

      {/* Host: pending join requests */}
      {isHost && joinRequests.length > 0 && (
        <div className="shrink-0 bg-blue-950/70 border-b border-blue-800">
          {joinRequests.map(req => (
            <div key={req.clientId} className="flex items-center justify-between px-4 py-2 text-sm">
              <span><span className="font-semibold">{req.username}</span> wants to join the room</span>
              <div className="flex gap-2">
                <button onClick={() => approveJoin(req.clientId)}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white">Admit</button>
                <button onClick={() => denyJoin(req.clientId)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white">Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Video with a docked, resizable/collapsible participant strip below it */}
        {/* Video area */}
        <div className="flex-1 min-w-0 flex flex-col bg-black">
          <div className="flex-1 min-h-0">
            <VideoPlayer roomId={id} username={username} onConnectionChange={handleConnectionChange} />
          </div>
        </div>

        {/* Right panel — camera + chat float WITHIN this, separated from the video */}
        {(showCamera || showChat) && (
          <>
            <div
              onMouseDown={startResizeSidebar}
              className="w-1.5 shrink-0 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors"
              title="Drag to resize panel"
            />
            <div ref={sidebarRef} style={{ width: sidebarWidth }} className="relative shrink-0 bg-gray-900/50 border-l border-gray-800 overflow-hidden">
              {/* Floating camera window (constrained to this panel) */}
              {showCamera && (
                <FloatingWindow
                  title={`Cameras${webcamTileCount ? ` (${webcamTileCount})` : ''}`} icon="📹"
                  initial={camLayout.current} minW={180} minH={140} boundsRef={sidebarRef}
                  onClose={() => setShowCamera(false)}
                  headerRight={
                    isCallActive
                      ? <button data-no-drag onClick={stopCamera} className="text-xs bg-red-600 hover:bg-red-500 rounded px-2 py-1">Stop</button>
                      : <button data-no-drag onClick={startCamera} className="text-xs bg-blue-600 hover:bg-blue-500 rounded px-2 py-1">Start</button>
                  }
                >
                  <div className="h-full p-2 bg-gray-950 flex flex-col">
                    {webcamTileCount === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-center text-gray-600 text-sm px-3">
                        Start your camera to appear here.
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0">
                        <CameraGrid tiles={camTiles} />
                      </div>
                    )}
                  </div>
                </FloatingWindow>
              )}

              {/* Floating chat window (constrained to this panel) */}
              {showChat && (
                <FloatingWindow
                  title="Chat" icon="💬" initial={chatLayout.current}
                  minW={220} minH={180} boundsRef={sidebarRef}
                  onClose={() => setShowChat(false)}
                >
                  <ChatPanel roomId={id} username={username} messages={chatMessages} showHeader={false} />
                </FloatingWindow>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default RoomPage
