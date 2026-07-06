import React, { useState, useEffect, useRef } from 'react'
import { websocketManager } from '../utils/websocketManager'

const VideoGridNew = ({ roomId, username, onCallStarted, onCallEnded }) => {
  const [isCallActive, setIsCallActive] = useState(false)
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [participants, setParticipants] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  
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

  // Ensure local video gets the stream when available
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.play().catch(e => console.log('Local video play error:', e))
    }
  }, [localStream])

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
        handleParticipantJoined(data.data)
        break
      case 'participant-left':
        handleParticipantLeft(data.data)
        break
    }
  }

  const createPeerConnection = (participantId, stream = null) => {
    const configuration = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }

    const pc = new RTCPeerConnection(configuration)

    // Add local stream
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

    return pc
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
      console.log('Video tracks:', stream.getVideoTracks())
      console.log('Audio tracks:', stream.getAudioTracks())
      
      setLocalStream(stream)
      
      // Set video source immediately
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
        console.log('Set local video source object')
        
        // Force video to play
        localVideoRef.current.play().catch(e => console.log('Video play error:', e))
      }

      // Create peer connections for existing participants
      participants.forEach(participant => {
        if (participant.username !== username) {
          createPeerConnection(participant.username, stream)
        }
      })

      // Notify other participants
      websocketManager.send('webrtc-call-started', {
        username,
        roomId,
        media: 'camera'
      })

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
      alert('Could not access screen. Please check permissions.')
    }
  }

  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }

    // Close all peer connections
    peerConnections.current.forEach(pc => pc.close())
    peerConnections.current.clear()

    websocketManager.send('webrtc-call-ended', {
      username,
      roomId
    })

    setIsCallActive(false)
    setIsScreenSharing(false)
    setRemoteStreams(new Map())
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
      if (pc && candidate) {
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
      const participantId = data.username
      const pc = createPeerConnection(participantId)
      peerConnections.current.set(participantId, pc)

      // Create offer
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer)
        
        websocketManager.send('webrtc-offer', {
          to: participantId,
          from: username,
          offer: offer,
          roomId
        })
      }).catch(console.error)

      // Update participant status
      setParticipants(prev => {
        const updated = prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: true, mediaType: data.media || 'camera' }
            : p
        )
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
    }
  }

  const handleCallEnded = (data) => {
    if (data.username !== username) {
      const participantId = data.username
      const pc = peerConnections.current.get(participantId)
      if (pc) {
        pc.close()
        peerConnections.current.delete(participantId)
      }

      setRemoteStreams(prev => {
        const newMap = new Map(prev)
        newMap.delete(participantId)
        return newMap
      })

      setParticipants(prev => 
        prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: false, mediaType: null }
            : p
        )
      )
    }
  }

  const handleParticipantJoined = (data) => {
    setParticipants(prev => {
      const existing = prev.find(p => p.username === data.username)
      if (!existing) {
        return [...prev, {
          id: data.username,
          username: data.username,
          isSharing: false,
          mediaType: null
        }]
      }
      return prev
    })
  }

  const handleParticipantLeft = (data) => {
    setParticipants(prev => prev.filter(p => p.username !== data.username))
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Live Video</h3>
        <div className="flex gap-2">
          {!isCallActive && (
            <>
              <button 
                onClick={startCall} 
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
              >
                📹 Share Camera
              </button>
              <button 
                onClick={startScreenShare} 
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2"
              >
                🖥️ Share Screen
              </button>
            </>
          )}
          {isCallActive && (
            <button 
              onClick={endCall} 
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-2"
            >
              ⏹️ Stop
            </button>
          )}
        </div>
      </div>

      {/* Video Grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Local Video */}
        {isCallActive && (
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              className="w-full h-32 object-cover"
            />
            <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded flex items-center gap-1">
              <span>{isScreenSharing ? 'Your Screen' : 'You'}</span>
              <button 
                onClick={toggleMute}
                className={`p-1 rounded ${isMuted ? 'bg-red-600' : 'bg-gray-600'}`}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? '🔇' : '🎤'}
              </button>
              <button 
                onClick={toggleVideo}
                className={`p-1 rounded ${isVideoOff ? 'bg-red-600' : 'bg-gray-600'}`}
                title={isVideoOff ? 'Turn on video' : 'Turn off video'}
              >
                {isVideoOff ? '📷' : '📹'}
              </button>
            </div>
          </div>
        )}

        {/* Remote Videos */}
        {Array.from(remoteStreams.entries()).map(([participantId, stream]) => {
          return (
            <div key={participantId} className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={el => {
                  if (el) {
                    remoteVideoRefs.current.set(participantId, el)
                    el.srcObject = stream
                  }
                }}
                autoPlay
                className="w-full h-32 object-cover"
              />
              <div className="absolute bottom-2 left-2 text-xs bg-black bg-opacity-50 text-white px-2 py-1 rounded">
                {participantId}
              </div>
            </div>
          )
        })}

        {/* Placeholder for participants who are sharing but we don't have their stream yet */}
        {participants
          .filter(p => p.isSharing && p.username !== username && !remoteStreams.has(p.username))
          .map(participant => (
            <div key={participant.username} className="relative bg-gray-700 rounded-lg overflow-hidden flex items-center justify-center">
              <div className="text-center text-gray-400">
                <div className="text-2xl mb-2">📹</div>
                <div className="text-sm">{participant.username}</div>
                <div className="text-xs">Connecting...</div>
              </div>
            </div>
          ))}
      </div>

      {/* Show message when no one is sharing */}
      {!isCallActive && !participants.some(p => p.isSharing) && (
        <div className="text-center text-gray-400 py-8">
          <div className="text-4xl mb-4">📹</div>
          <p className="text-lg mb-2">Click "Share Camera" or "Share Screen" to begin</p>
          <p className="text-sm">All participants in the room will see your video</p>
        </div>
      )}
    </div>
  )
}

export default VideoGridNew
