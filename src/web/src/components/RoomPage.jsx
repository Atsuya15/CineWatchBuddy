import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { websocketManager } from '../utils/websocketManager'
import VideoPlayer from './VideoPlayer'
import ChatPanel from './ChatPanel'

const RoomPage = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState(null)
  const [username, setUsername] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // UI State - TwoSeven Style
  const [showChat, setShowChat] = useState(false) // Start with chat hidden
  const [isCallActive, setIsCallActive] = useState(false)
  const [participants, setParticipants] = useState([])
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState(new Map())
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)
  
  // Refs
  const localVideoRef = useRef(null)
  const remoteVideoRefs = useRef(new Map())
  const peerConnections = useRef(new Map())

  useEffect(() => {
    // Get username from localStorage or prompt
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

    // Connect to WebSocket
    websocketManager.connect(id, username).then(() => {
      setIsConnected(true)
      setIsLoading(false)
    }).catch(error => {
      console.error('Failed to connect WebSocket:', error)
      setError('Failed to connect to room')
      setIsLoading(false)
    })

    // Listen to shared WebSocket messages
    const handleMessage = (event) => {
      handleWebSocketMessage(event.detail)
    }

    window.addEventListener('cinewatchbuddy-message', handleMessage)

    return () => {
      window.removeEventListener('cinewatchbuddy-message', handleMessage)
      websocketManager.disconnect()
    }
  }, [id, username])

  // Ensure local video element gets the stream when localStream changes
  useEffect(() => {
    if (localStream && localVideoRef.current) {
      console.log('🎥 Setting local video stream to element')
      localVideoRef.current.srcObject = localStream
      localVideoRef.current.play().catch(e => console.log('Local video play error:', e))
    }
  }, [localStream])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'room-joined':
        if (data.data) {
          setRoom(data.data.room)
          // Load the existing participant list (excluding ourselves)
          const existing = data.data.room?.participants || []
          setParticipants(existing
            .filter(p => p.isActive !== false && p.username !== username)
            .map(p => ({
              id: p.username,
              username: p.username,
              isSharing: false,
              mediaType: null
            })))
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
    // Server sends { participant: { username, ... } }
    const joined = data?.participant || data
    const joinedName = joined?.username
    if (!joinedName || joinedName === username) return
    setParticipants(prev => {
      const existing = prev.find(p => p.username === joinedName)
      if (!existing) {
        return [...prev, {
          id: joinedName,
          username: joinedName,
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

  const handleCallStarted = (data) => {
    console.log('🔍 handleCallStarted called with:', data)
    console.log('🔍 Current username:', username)
    console.log('🔍 Is different user?', data.username !== username)
    
    if (data.username !== username) {
      console.log('Another participant started sharing:', data.username)
      // Update participant status
      setParticipants(prev => 
        prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: true, mediaType: data.media || 'camera' }
            : p
        )
      )
      
      // Create peer connection to receive their stream
      console.log('Creating peer connection to receive stream from:', data.username)
      const pc = createPeerConnection(data.username, localStream)
      
      // If we have a local stream, send an offer back
      if (localStream) {
        pc.createOffer().then(offer => {
          pc.setLocalDescription(offer)
          websocketManager.send('webrtc-offer', {
            to: data.username,
            from: username,
            offer: offer,
            roomId: id
          })
          console.log('📡 Sent WebRTC offer back to:', data.username)
        }).catch(error => {
          console.error('Error creating offer for', data.username, ':', error)
        })
      }
    } else {
      console.log('Ignoring call started message from self')
    }
  }

  const handleCallEnded = (data) => {
    if (data.username !== username) {
      setParticipants(prev => 
        prev.map(p => 
          p.username === data.username 
            ? { ...p, isSharing: false, mediaType: null }
            : p
        )
      )
    }
  }

  const handleWebRTCOffer = async (data) => {
    const { from, offer, roomId: offerRoomId } = data
    if (offerRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed offer

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
        roomId: id
      })
    } catch (error) {
      console.error('Error handling WebRTC offer:', error)
    }
  }

  const handleWebRTCAnswer = async (data) => {
    const { from, answer, roomId: answerRoomId } = data
    if (answerRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed answer

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
    if (candidateRoomId !== id) return
    if (!from || from === username) return // ignore our own echoed candidate

    try {
      const pc = peerConnections.current.get(from)
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate))
      }
    } catch (error) {
      console.error('Error handling ICE candidate:', error)
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

    const streamToUse = stream || localStream
    if (streamToUse) {
      streamToUse.getTracks().forEach(track => {
        pc.addTrack(track, streamToUse)
      })
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]
      setRemoteStreams(prev => new Map(prev.set(participantId, remoteStream)))
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        websocketManager.send('webrtc-ice-candidate', {
          to: participantId,
          from: username,
          candidate: event.candidate,
          roomId: id
        })
      }
    }

    return pc
  }

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      })
      
      console.log('🎥 Camera stream obtained:', stream)
      console.log('🎥 Video tracks:', stream.getVideoTracks())
      console.log('🎥 Audio tracks:', stream.getAudioTracks())
      
      setLocalStream(stream)
      setIsCallActive(true)

      // Create peer connections for existing participants and initiate offers
      for (const participant of participants) {
        if (participant.username !== username) {
          const pc = createPeerConnection(participant.username, stream)
          
          // Create and send offer
          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            
            websocketManager.send('webrtc-offer', {
              to: participant.username,
              from: username,
              offer: offer,
              roomId: id
            })
            
            console.log('📡 Sent WebRTC offer to:', participant.username)
          } catch (error) {
            console.error('Error creating offer for', participant.username, ':', error)
          }
        }
      }

      websocketManager.send('webrtc-call-started', {
        username,
        roomId: id,
        media: 'camera'
      })
    } catch (error) {
      console.error('Error starting camera:', error)
      alert('Could not access camera/microphone. Please check permissions.')
    }
  }

  const stopCamera = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop())
      setLocalStream(null)
    }

    peerConnections.current.forEach(pc => pc.close())
    peerConnections.current.clear()

    websocketManager.send('webrtc-call-ended', {
      username,
      roomId: id
    })

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

  const handleConnectionChange = (connected) => {
    setIsConnected(connected)
  }

  const leaveRoom = () => {
    websocketManager.disconnect()
    navigate('/')
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p className="text-lg">Loading room...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center text-white">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="mb-4">{error}</p>
          <button 
            onClick={() => navigate('/')}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Top Navigation Bar - TwoSeven Style */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-lg font-bold text-white">🎬 CineWatchBuddy</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-300">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-300">
              Room: <span className="font-mono text-blue-400">{id}</span>
            </div>
            <div className="text-sm text-gray-300">
              User: <span className="text-white">{username}</span>
            </div>
            <button
              onClick={leaveRoom}
              className="px-3 py-1 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
            >
              Leave Room
            </button>
          </div>
        </div>
      </div>

      {/* Platform Selection Buttons - TwoSeven Style */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-2">
        <div className="flex items-center space-x-2">
          <button className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700">
            YouTube
          </button>
          <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
            Netflix
          </button>
          <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
            Amazon
          </button>
          <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
            Vimeo
          </button>
          <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
            Personal
          </button>
          <button className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700">
            Web
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex h-[calc(100vh-120px)]">
        {/* Video Area - Maximized like TwoSeven */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ${
          showChat ? 'mr-80' : ''
        }`}>
          {/* Main Video Player */}
          <div className="flex-1 bg-black relative">
            <VideoPlayer 
              roomId={id} 
              username={username} 
              onConnectionChange={handleConnectionChange}
            />
            
            {/* Participant Videos - Floating in corner like TwoSeven */}
            <div className="absolute top-4 right-4 flex flex-col space-y-2">
              {/* Local Video */}
              {isCallActive && (
                <div className="relative w-32 h-24 bg-gray-800 rounded-lg overflow-hidden">
                  <video
                    ref={localVideoRef}
                    autoPlay
                    muted
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1 left-1 text-xs bg-black bg-opacity-50 text-white px-1 py-0.5 rounded">
                    You
                  </div>
                  <div className="absolute top-1 right-1 flex flex-col space-y-1">
                    <button 
                      onClick={toggleMute}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        isMuted ? 'bg-red-600' : 'bg-gray-600'
                      }`}
                    >
                      {isMuted ? '🔇' : '🎤'}
                    </button>
                    <button 
                      onClick={toggleVideo}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                        isVideoOff ? 'bg-red-600' : 'bg-gray-600'
                      }`}
                    >
                      {isVideoOff ? '📷' : '📹'}
                    </button>
                  </div>
                </div>
              )}

              {/* Remote Videos */}
              {Array.from(remoteStreams.entries()).map(([participantId, stream]) => (
                <div key={participantId} className="relative w-32 h-24 bg-gray-800 rounded-lg overflow-hidden">
                  <video
                    ref={el => {
                      if (el) {
                        remoteVideoRefs.current.set(participantId, el)
                        el.srcObject = stream
                      }
                    }}
                    autoPlay
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute bottom-1 left-1 text-xs bg-black bg-opacity-50 text-white px-1 py-0.5 rounded">
                    {participantId}
                  </div>
                </div>
              ))}
            </div>

            {/* Camera Controls - Bottom Left */}
            <div className="absolute bottom-4 left-4 flex items-center space-x-2">
              {!isCallActive ? (
                <button
                  onClick={startCamera}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2"
                >
                  📹 Start Camera
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-2"
                >
                  ⏹️ Stop Camera
                </button>
              )}
            </div>

            {/* Chat Toggle Button - Bottom Right */}
            <div className="absolute bottom-4 right-4">
              <button
                onClick={() => setShowChat(!showChat)}
                className="p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700"
                title={showChat ? 'Hide Chat' : 'Show Chat'}
              >
                💬
              </button>
            </div>
          </div>
        </div>

        {/* Chat Sidebar - Slides in from right like TwoSeven */}
        {showChat && (
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Messages</h3>
              <button
                onClick={() => setShowChat(false)}
                className="text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Chat Content */}
            <div className="flex-1 overflow-y-auto">
              <ChatPanel roomId={id} username={username} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default RoomPage
