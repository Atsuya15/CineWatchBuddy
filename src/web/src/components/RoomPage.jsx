import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { websocketManager } from '../utils/websocketManager'
import VideoPlayer from './VideoPlayer'
import ChatPanel from './ChatPanel'

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

  // Layout state — collapsible + resizable panels
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(360)
  const [webcamsOpen, setWebcamsOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(true)
  const [webcamHeight, setWebcamHeight] = useState(240)

  // Refs
  const localVideoRef = useRef(null)
  const remoteVideoRefs = useRef(new Map())
  const peers = useRef(new Map()) // peerId -> { pc, makingOffer, polite, pendingCandidates }
  const localStreamRef = useRef(null)
  const participantsRef = useRef([])
  const sidebarBodyRef = useRef(null)

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
  }, [localStream, webcamsOpen, sidebarOpen])

  // Keep a ref of participants so WebRTC handlers (bound once) always see the
  // current list rather than a stale closure value.
  useEffect(() => { participantsRef.current = participants }, [participants])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'room-joined':
        if (data.data) {
          setRoom(data.data.room)
          const existing = data.data.room?.participants || []
          setParticipants(existing
            .filter(p => p.isActive !== false && p.username !== username)
            .map(p => ({ id: p.username, username: p.username, isSharing: false, mediaType: null })))
        }
        break
      case 'participant-joined':
        handleParticipantJoined(data.data)
        break
      case 'participant-left':
        handleParticipantLeft(data.data)
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
  }

  const handleParticipantLeft = (data) => {
    const leftName = data?.username || data?.participant?.username
    if (!leftName) return
    setParticipants(prev => prev.filter(p => p.username !== leftName))
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
      setWebcamsOpen(true)
      setSidebarOpen(true)

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

  // ----- Resizing -----
  const startResizeSidebar = useCallback((e) => {
    e.preventDefault()
    const onMove = (ev) => {
      const w = window.innerWidth - ev.clientX
      setSidebarWidth(Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, w)))
    }
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

  const startResizeWebcam = useCallback((e) => {
    e.preventDefault()
    const rect = sidebarBodyRef.current?.getBoundingClientRect()
    if (!rect) return
    const onMove = (ev) => {
      const h = ev.clientY - rect.top
      setWebcamHeight(Math.min(rect.height - 160, Math.max(MIN_WEBCAM, h)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
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
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="mb-4 text-gray-400">{error}</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500">
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  const remoteEntries = Array.from(remoteStreams.entries())
  const webcamTileCount = (isCallActive ? 1 : 0) + remoteEntries.length

  const PanelHeader = ({ icon, title, open, onToggle, right }) => (
    <div className="flex items-center justify-between px-3 h-10 shrink-0 bg-gray-900/80 border-b border-gray-800 select-none">
      <button onClick={onToggle} className="flex items-center gap-2 text-sm font-semibold text-gray-200 hover:text-white">
        <span className={`text-gray-500 transition-transform ${open ? 'rotate-90' : ''}`}>▸</span>
        <span>{icon} {title}</span>
      </button>
      <div className="flex items-center gap-1">{right}</div>
    </div>
  )

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
          <span className="hidden md:inline text-xs text-gray-500">
            {participants.length + 1} watching
          </span>
          <button
            onClick={copyInvite}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            {copied ? '✓ Copied' : '🔗 Invite'}
          </button>
          {!sidebarOpen && (
            <button onClick={() => setSidebarOpen(true)} title="Show panel"
              className="text-sm bg-gray-800 hover:bg-gray-700 rounded-lg px-3 py-1.5">
              ☰
            </button>
          )}
          <button onClick={leaveRoom}
            className="text-sm bg-gray-800 hover:bg-red-600 text-gray-200 hover:text-white rounded-lg px-3 py-1.5 transition-colors">
            Leave
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="flex-1 flex min-h-0">
        {/* Video column (resizes as sidebar width changes) */}
        <div className="flex-1 min-w-0 flex flex-col bg-black">
          <div className="flex-1 min-h-0">
            <VideoPlayer roomId={id} username={username} onConnectionChange={handleConnectionChange} />
          </div>
        </div>

        {/* Vertical resize handle */}
        {sidebarOpen && (
          <div
            onMouseDown={startResizeSidebar}
            className="w-1.5 shrink-0 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors"
            title="Drag to resize"
          />
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <aside style={{ width: sidebarWidth }} className="shrink-0 flex flex-col bg-gray-950 border-l border-gray-800">
            <div ref={sidebarBodyRef} className="flex-1 flex flex-col min-h-0">
              {/* Webcams panel */}
              <div
                className="flex flex-col min-h-0"
                style={webcamsOpen && chatOpen ? { height: webcamHeight } : (webcamsOpen ? { flex: 1 } : undefined)}
              >
                <PanelHeader
                  icon="📹" title={`Cameras${webcamTileCount ? ` (${webcamTileCount})` : ''}`}
                  open={webcamsOpen} onToggle={() => setWebcamsOpen(o => !o)}
                  right={isCallActive ? (
                    <button onClick={stopCamera} className="text-xs bg-red-600 hover:bg-red-500 rounded px-2 py-1">Stop</button>
                  ) : (
                    <button onClick={startCamera} className="text-xs bg-blue-600 hover:bg-blue-500 rounded px-2 py-1">Start camera</button>
                  )}
                />
                {webcamsOpen && (
                  <div className="flex-1 min-h-0 overflow-y-auto p-2">
                    {webcamTileCount === 0 ? (
                      <div className="h-full flex items-center justify-center text-center text-gray-600 text-sm px-4">
                        Start your camera to video-chat while you watch.
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {isCallActive && (
                          <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
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
                        )}
                        {remoteEntries.map(([participantId, stream]) => (
                          <div key={participantId} className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden border border-gray-800">
                            <video
                              ref={el => { if (el) { remoteVideoRefs.current.set(participantId, el); el.srcObject = stream } }}
                              autoPlay playsInline className="w-full h-full object-cover"
                            />
                            <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1.5 py-0.5 rounded">{participantId}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Horizontal resize handle (only when both panels open) */}
              {webcamsOpen && chatOpen && (
                <div
                  onMouseDown={startResizeWebcam}
                  className="h-1.5 shrink-0 cursor-row-resize bg-gray-800 hover:bg-blue-500 transition-colors"
                  title="Drag to resize"
                />
              )}

              {/* Chat panel */}
              <div className={`flex flex-col min-h-0 ${chatOpen ? 'flex-1' : ''}`}>
                <PanelHeader
                  icon="💬" title="Chat"
                  open={chatOpen} onToggle={() => setChatOpen(o => !o)}
                />
                {chatOpen && (
                  <div className="flex-1 min-h-0">
                    <ChatPanel roomId={id} username={username} showHeader={false} />
                  </div>
                )}
              </div>
            </div>

            {/* Collapse-sidebar control */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="h-8 shrink-0 text-xs text-gray-500 hover:text-gray-300 border-t border-gray-800 bg-gray-950"
              title="Hide panel"
            >
              ⟩ Hide panel
            </button>
          </aside>
        )}
      </div>
    </div>
  )
}

export default RoomPage
