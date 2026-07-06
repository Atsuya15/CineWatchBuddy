import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { websocketManager } from '../utils/websocketManager'
import VideoPlayer from './VideoPlayer'
import VideoGridNew from './VideoGridNew'
import ChatPanel from './ChatPanel'
import ParticipantList from './ParticipantList'

const RoomPageEnhanced = () => {
  const { id } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState(null)
  const [username, setUsername] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // UI State
  const [showChat, setShowChat] = useState(true)
  const [showParticipants, setShowParticipants] = useState(true)
  const [isVideoMaximized, setIsVideoMaximized] = useState(false)
  const [isCallActive, setIsCallActive] = useState(false)
  const [chatSlidePosition, setChatSlidePosition] = useState('right') // 'right', 'left', 'hidden'
  
  // Refs
  const videoContainerRef = useRef(null)
  const chatPanelRef = useRef(null)

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
  }, [id, username, navigate])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'room-joined':
        if (data.data) {
          setRoom(data.data.room)
        }
        break
      case 'participant-joined':
      case 'participant-left':
        // Handle participant updates
        break
      default:
        break
    }
  }

  const handleConnectionChange = (connected) => {
    setIsConnected(connected)
  }

  const handleCallStarted = () => {
    setIsCallActive(true)
  }

  const handleCallEnded = () => {
    setIsCallActive(false)
  }

  const toggleChat = () => {
    if (chatSlidePosition === 'hidden') {
      setChatSlidePosition('right')
    } else if (chatSlidePosition === 'right') {
      setChatSlidePosition('left')
    } else {
      setChatSlidePosition('hidden')
    }
  }

  const toggleVideoMaximize = () => {
    setIsVideoMaximized(!isVideoMaximized)
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
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold text-white">🎬 CineWatchBuddy</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-300">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            {/* Platform Selection Buttons - TwoSeven Style */}
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
            </div>
            
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

      {/* Main Content Area */}
      <div className="flex h-[calc(100vh-65px)]">
        {/* Video Area - Main Content */}
        <div className={`flex-1 flex flex-col transition-all duration-300 ${
          chatSlidePosition === 'right' ? 'mr-80' : 
          chatSlidePosition === 'left' ? 'ml-80' : ''
        }`}>
          {/* Video Player */}
          <div 
            ref={videoContainerRef}
            className={`bg-black relative transition-all duration-300 ${
              isVideoMaximized ? 'h-full' : 'flex-1'
            }`}
          >
            <VideoPlayer 
              roomId={id} 
              username={username} 
              onConnectionChange={handleConnectionChange}
            />
            
            {/* Video Controls Overlay */}
            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleVideoMaximize}
                  className="p-2 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-70"
                  title={isVideoMaximized ? 'Minimize' : 'Maximize'}
                >
                  {isVideoMaximized ? '⤓' : '⤢'}
                </button>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={toggleChat}
                  className="p-2 bg-black bg-opacity-50 text-white rounded hover:bg-opacity-70"
                  title="Toggle Chat"
                >
                  💬
                </button>
              </div>
            </div>
          </div>

          {/* Video Controls */}
          {!isVideoMaximized && (
            <div className="bg-gray-800 border-t border-gray-700 p-4">
              <VideoGridNew
                roomId={id}
                username={username}
                onCallStarted={handleCallStarted}
                onCallEnded={handleCallEnded}
              />
            </div>
          )}
        </div>

        {/* Chat Panel - Sliding from Right */}
        {chatSlidePosition === 'right' && (
          <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">💬 Messages</h3>
              <button
                onClick={() => setChatSlidePosition('hidden')}
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

        {/* Chat Panel - Sliding from Left */}
        {chatSlidePosition === 'left' && (
          <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col order-first">
            {/* Chat Header */}
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h3 className="text-lg font-semibold">💬 Messages</h3>
              <button
                onClick={() => setChatSlidePosition('hidden')}
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

        {/* Participants Panel - Always visible on the opposite side of chat */}
        {chatSlidePosition !== 'hidden' && (
          <div className="w-60 bg-gray-800 border-l border-gray-700 flex flex-col">
            {/* Participants Header */}
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold">👥 Participants</h3>
            </div>

            {/* Participants Content */}
            <div className="flex-1 overflow-y-auto">
              <ParticipantList roomId={id} username={username} />
            </div>
          </div>
        )}
      </div>

      {/* Floating Chat Button - When chat is hidden */}
      {chatSlidePosition === 'hidden' && (
        <button
          onClick={() => setChatSlidePosition('right')}
          className="fixed bottom-4 right-4 p-3 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 z-50"
          title="Open Chat"
        >
          💬
        </button>
      )}
    </div>
  )
}

export default RoomPageEnhanced
