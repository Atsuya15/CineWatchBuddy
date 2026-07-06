import React, { useState, useEffect, useRef } from 'react'
import { websocketManager } from '../utils/websocketManager'

const VideoGrid = ({ roomId, username, onCallStarted, onCallEnded }) => {
  const [isCallActive, setIsCallActive] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
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
    // Listen to shared WebSocket messages
    const handleMessage = (event) => {
      handleWebSocketMessage(event.detail)
    }

    window.addEventListener('cinewatchbuddy-message', handleMessage)

    return () => {
      window.removeEventListener('cinewatchbuddy-message', handleMessage)
      // Cleanup peer connections
      peerConnections.current.forEach(pc => pc.close())
    }
  }, [roomId, username])

  // Update video elements when remote streams change
  useEffect(() => {
    remoteStreams.forEach((stream, participantId) => {
      const videoRef = remoteVideoRefs.current.get(participantId)
      if (videoRef && videoRef.srcObject !== stream) {
        videoRef.srcObject = stream
      }
    })
  }, [remoteStreams])

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
          setParticipants(prev => {
            const exists = prev.some(p => p.id === data.data.participant.id)
            return exists ? prev : [...prev, data.data.participant]
          })
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
      console.log('Starting camera call for user:', username, 'in room:', roomId)
      
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      })
      
      console.log('Got user media stream:', stream)
      
      setLocalStream(stream)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        console.log('Set local video source')
      }

      // Create peer connections for existing participants
      participants.forEach(participant => {
        if (participant.username !== username) {
          createPeerConnection(participant.username, stream)
        }
      })

      // Notify other participants
      const success = websocketManager.send('webrtc-call-started', {
        username,
        roomId,
        media: 'camera'
      })
      
      console.log('Sent webrtc-call-started message, success:', success)

      setIsCallActive(true)
      onCallStarted && onCallStarted()
    } catch (error) {
      console.error('Error starting call:', error)
      alert('Could not access camera/microphone. Please check permissions.')
    }
  }

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      setLocalStream(stream)
      setIsScreenSharing(true)
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      websocketManager.send('webrtc-call-started', {
        username,
        roomId,
        media: 'screen'
      })

      setIsCallActive(true)
      onCallStarted && onCallStarted()
    } catch (error) {
      console.error('Error starting screen share:', error)
      alert('Could not start screen sharing. Please check permissions.')
    }
  }

  const endCall = () => {
    // Stop local stream
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }
    setIsScreenSharing(false)

    // Close all peer connections
    peerConnections.current.forEach(pc => pc.close())
    peerConnections.current.clear()

    // Clear remote streams
    setRemoteStreams(new Map())

    // Notify other participants
    websocketManager.send('webrtc-call-ended', {
      username,
      roomId
    })

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

  const createPeerConnection = (participantId, stream = null) => {
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

    // Add local stream (use provided stream or current localStream)
    const streamToUse = stream || localStream
    if (streamToUse) {
      streamToUse.getTracks().forEach(track => {
        pc.addTrack(track, streamToUse)
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
      if (event.candidate) {
        websocketManager.send('webrtc-ice-candidate', {
          to: participantId,
          from: username,
          candidate: event.candidate,
          roomId
        })
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

      websocketManager.send('webrtc-answer', {
        to: from,
        from: username,
        answer: answer,
        roomId
      })
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
    console.log('Received webrtc-call-started:', data)
    if (data.username !== username) {
      console.log('Another participant started sharing:', data.username)
      // Another participant started publishing media; create peer connection to subscribe
      const participantId = data.username
      const pc = createPeerConnection(participantId)
      peerConnections.current.set(participantId, pc)

      // Update participant status
      setParticipants(prev => {
        const updated = prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: true, mediaType: data.media || 'camera' }
            : p
        )
        // If participant not in list, add them
        if (!prev.some(p => p.username === data.username)) {
          updated.push({
            id: data.username,
            username: data.username,
            isSharing: true,
            mediaType: data.media || 'camera'
          })
        }
        return updated
      })

      // Create offer
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer)
        
        const success = websocketManager.send('webrtc-offer', {
          to: participantId,
          from: username,
          offer: offer,
          roomId
        })
        console.log('Sent webrtc-offer, success:', success)
      }).catch(console.error)
    }
  }

  const handleCallEnded = (data) => {
    if (data.username !== username) {
      // Another participant ended their call
      const participantId = data.username

      // Update participant status
      setParticipants(prev => {
        const updated = prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: false, mediaType: null }
            : p
        )
        return updated
      })

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
        <h3 className="text-lg font-semibold">Live Video</h3>
        <div className="flex gap-2">
          {!isCallActive && (
            <>
              <button onClick={startCall} className="btn btn-primary">📹 Share Camera</button>
              <button onClick={startScreenShare} className="btn btn-secondary">🖥️ Share Screen</button>
            </>
          )}
          {isCallActive && (
            <button onClick={endCall} className="btn btn-secondary">⏹️ Stop</button>
          )}
        </div>
      </div>

      {/* Show all participants who are sharing */}
      {(isCallActive || participants.some(p => p.isSharing)) && (
        <div className="space-y-4">
          {/* Video Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Local Video - only show if we're sharing */}
            {isCallActive && (
              <div className="relative">
                <video
                  ref={localVideoRef}
                  autoPlay
                  muted
                  className="w-full h-32 bg-black rounded-lg"
                />
                <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                  {isScreenSharing ? 'Your Screen' : 'You'} {isMuted ? '🔇' : '🎤'} {isVideoOff ? '📷' : '📹'}
                </div>
              </div>
            )}

            {/* Remote Videos - show all participants who are sharing */}
            {Array.from(remoteStreams.entries()).map(([participantId, stream]) => {
              // Set the video source when the ref is available
              const videoRef = remoteVideoRefs.current.get(participantId)
              if (videoRef && videoRef.srcObject !== stream) {
                videoRef.srcObject = stream
              }
              
              return (
                <div key={participantId} className="relative">
                  <video
                    ref={el => {
                      if (el) {
                        remoteVideoRefs.current.set(participantId, el)
                        el.srcObject = stream
                      }
                    }}
                    autoPlay
                    className="w-full h-32 bg-black rounded-lg"
                  />
                  <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                    {participantId}
                  </div>
                </div>
              )
            })}

            {/* Show participants who are sharing but we don't have their stream yet */}
            {participants
              .filter(p => p.isSharing && p.username !== username && !remoteStreams.has(p.username))
              .map(participant => (
                <div key={participant.username} className="relative">
                  <div className="w-full h-32 bg-gray-700 rounded-lg flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="text-2xl mb-2">📹</div>
                      <div className="text-sm">{participant.username}</div>
                      <div className="text-xs">Connecting...</div>
                    </div>
                  </div>
                </div>
              ))}
          </div>

          {/* Controls - only show when we're sharing */}
          {isCallActive && (
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
          )}
        </div>
      )}

      {/* Show message when no one is sharing */}
      {!isCallActive && !participants.some(p => p.isSharing) && (
        <div className="text-center text-gray-400 py-8">
          <p>Click "Share Camera" or "Share Screen" to begin</p>
          <p className="text-sm mt-2">All participants in the room will see your video</p>
        </div>
      )}
    </div>
  )
}

export default VideoGrid
