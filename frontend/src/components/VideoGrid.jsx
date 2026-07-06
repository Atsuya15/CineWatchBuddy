import React, { useState, useEffect, useRef } from 'react'

const VideoGrid = ({ roomId, username, onCallStarted, onCallEnded }) => {
  const [isCallActive, setIsCallActive] = useState(false)
  const [participants, setParticipants] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  const [ws, setWs] = useState(null)
  
  const peerConnections = useRef(new Map())
  const localVideoRef = useRef(null)
  const remoteVideoRefs = useRef(new Map())

  useEffect(() => {
    // Initialize WebSocket connection for WebRTC signaling
    const connectWebSocket = () => {
      const wsUrl = `ws://localhost:8080/ws?room=${roomId}&user=${encodeURIComponent(username)}`
      const websocket = new WebSocket(wsUrl)

      websocket.onopen = () => {
        console.log('WebRTC WebSocket connected')
      }

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleWebSocketMessage(data)
        } catch (err) {
          console.error('Error parsing WebRTC message:', err)
        }
      }

      websocket.onclose = () => {
        console.log('WebRTC WebSocket disconnected')
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      websocket.onerror = (error) => {
        console.error('WebRTC WebSocket error:', error)
      }

      setWs(websocket)
    }

    connectWebSocket()

    return () => {
      if (ws) {
        ws.close()
      }
      // Cleanup peer connections
      peerConnections.current.forEach(pc => pc.close())
    }
  }, [roomId, username])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'webrtc-offer':
        handleWebRTCOffer(data.data)
        break
      case 'webrtc-answer':
        handleWebRTCAnswer(data.data)
        break
      case 'webrtc-ice-candidate':
        handleWebRTCIceCandidate(data.data)
        break
      case 'webrtc-call-started':
        handleCallStarted(data.data)
        break
      case 'webrtc-call-ended':
        handleCallEnded(data.data)
        break
      case 'participant-joined':
        if (data.data && data.data.participant) {
          setParticipants(prev => [...prev, data.data.participant])
        }
        break
      case 'participant-left':
        if (data.data && data.data.participantId) {
          setParticipants(prev => prev.filter(p => p.id !== data.data.participantId))
          // Clean up peer connection
          if (peerConnections.current.has(data.data.participantId)) {
            peerConnections.current.get(data.data.participantId).close()
            peerConnections.current.delete(data.data.participantId)
          }
          // Remove remote video
          setRemoteStreams(prev => {
            const newMap = new Map(prev)
            newMap.delete(data.data.participantId)
            return newMap
          })
        }
        break
    }
  }

  const startCall = async () => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      })
      
      setLocalStream(stream)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Notify other participants
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc-call-started',
          data: {
            username,
            roomId
          }
        }))
      }

      setIsCallActive(true)
      onCallStarted && onCallStarted()
    } catch (error) {
      console.error('Error starting call:', error)
      alert('Could not access camera/microphone. Please check permissions.')
    }
  }

  const endCall = () => {
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }

    // Close all peer connections
    peerConnections.current.forEach(pc => pc.close())
    peerConnections.current.clear()

    // Clear remote streams
    setRemoteStreams(new Map())

    // Notify other participants
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'webrtc-call-ended',
        data: {
          username,
          roomId
        }
      }))
    }

    setIsCallActive(false)
    onCallEnded && onCallEnded()
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

  const createPeerConnection = (participantId) => {
    // TURN configuration can be provided via localStorage 'cinebuddy_turn'
    let turnServers = []
    try {
      const stored = localStorage.getItem('cinebuddy_turn')
      if (stored) turnServers = JSON.parse(stored)
    } catch {}
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        ...turnServers
      ]
    }

    const pc = new RTCPeerConnection(configuration)

    // Add local stream
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream)
      })
    }

    // Handle remote stream
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]
      setRemoteStreams(prev => new Map(prev.set(participantId, remoteStream)))
      
      // Set up video element
      const videoElement = remoteVideoRefs.current.get(participantId)
      if (videoElement) {
        videoElement.srcObject = remoteStream
      }
    }

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc-ice-candidate',
          data: {
            to: participantId,
            from: username,
            candidate: event.candidate,
            roomId
          }
        }))
      }
    }

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`Peer connection state with ${participantId}:`, pc.connectionState)
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        // Clean up
        pc.close()
        peerConnections.current.delete(participantId)
      }
    }

    return pc
  }

  const handleWebRTCOffer = async (data) => {
    const { from, offer, roomId: offerRoomId } = data
    
    if (offerRoomId !== roomId) return

    try {
      const pc = createPeerConnection(from)
      peerConnections.current.set(from, pc)

      await pc.setRemoteDescription(new RTCSessionDescription(offer))
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'webrtc-answer',
          data: {
            to: from,
            from: username,
            answer: answer,
            roomId
          }
        }))
      }
    } catch (error) {
      console.error('Error handling WebRTC offer:', error)
    }
  }

  const handleWebRTCAnswer = async (data) => {
    const { from, answer, roomId: answerRoomId } = data
    
    if (answerRoomId !== roomId) return

    try {
      const pc = peerConnections.current.get(from)
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer))
      }
    } catch (error) {
      console.error('Error handling WebRTC answer:', error)
    }
  }

  const handleWebRTCIceCandidate = async (data) => {
    const { from, candidate, roomId: candidateRoomId } = data
    
    if (candidateRoomId !== roomId) return

    try {
      const pc = peerConnections.current.get(from)
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error)
    }
  }

  const handleCallStarted = (data) => {
    if (data.username !== username && isCallActive) {
      // Another participant started a call, create peer connection
      const participantId = data.username
      const pc = createPeerConnection(participantId)
      peerConnections.current.set(participantId, pc)

      // Create offer
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer)
        
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'webrtc-offer',
            data: {
              to: participantId,
              from: username,
              offer: offer,
              roomId
            }
          }))
        }
      }).catch(console.error)
    }
  }

  const handleCallEnded = (data) => {
    if (data.username !== username) {
      // Another participant ended their call
      const participantId = data.username
      if (peerConnections.current.has(participantId)) {
        peerConnections.current.get(participantId).close()
        peerConnections.current.delete(participantId)
      }
      
      // Remove remote video
      setRemoteStreams(prev => {
        const newMap = new Map(prev)
        newMap.delete(participantId)
        return newMap
      })
    }
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Video Call</h3>
        <div className="flex gap-2">
          {!isCallActive ? (
            <button
              onClick={startCall}
              className="btn btn-primary"
            >
              📹 Start Call
            </button>
          ) : (
            <button
              onClick={endCall}
              className="btn btn-secondary"
            >
              📞 End Call
            </button>
          )}
        </div>
      </div>

      {isCallActive && (
        <div className="space-y-4">
          {/* Video Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Local Video */}
            <div className="relative">
              <video
                ref={localVideoRef}
                autoPlay
                muted
                className="w-full h-32 bg-black rounded-lg"
              />
              <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                You {isMuted ? '🔇' : '🎤'} {isVideoOff ? '📷' : '📹'}
              </div>
            </div>

            {/* Remote Videos */}
            {Array.from(remoteStreams.entries()).map(([participantId, stream]) => (
              <div key={participantId} className="relative">
                <video
                  ref={el => remoteVideoRefs.current.set(participantId, el)}
                  autoPlay
                  className="w-full h-32 bg-black rounded-lg"
                />
                <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                  {participantId}
                </div>
              </div>
            ))}
          </div>

          {/* Controls */}
          <div className="flex justify-center gap-4">
            <button
              onClick={toggleMute}
              className={`btn ${isMuted ? 'btn-secondary' : 'btn-primary'}`}
            >
              {isMuted ? '🔇 Unmute' : '🎤 Mute'}
            </button>
            <button
              onClick={toggleVideo}
              className={`btn ${isVideoOff ? 'btn-secondary' : 'btn-primary'}`}
            >
              {isVideoOff ? '📷 Turn On' : '📹 Turn Off'}
            </button>
          </div>
        </div>
      )}

      {!isCallActive && (
        <div className="text-center text-gray-400 py-8">
          <p>Click "Start Call" to begin video chat</p>
          <p className="text-sm mt-2">All participants in the room will be able to join</p>
        </div>
      )}
    </div>
  )
}

export default VideoGrid
