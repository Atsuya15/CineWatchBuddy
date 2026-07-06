import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { websocketManager } from '../utils/websocketManager'
import VideoPlayer from './VideoPlayer'
import VideoGrid from './VideoGrid'
import ChatPanel from './ChatPanel'
import ParticipantList from './ParticipantList'

const RoomPageNew = () => {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const [room, setRoom] = useState(null)
  const [username, setUsername] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showChat, setShowChat] = useState(true)
  const [showParticipants, setShowParticipants] = useState(true)
  const [isCallActive, setIsCallActive] = useState(false)

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
    websocketManager.connect(roomId, username).then(() => {
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
  }, [roomId, username, navigate])

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
      {/* Header */}
      <div className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <h1 className="text-xl font-bold">🎬 CineWatchBuddy</h1>
            <div className="flex items-center space-x-2">
              <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm text-gray-300">
                {isConnected ? 'Connected' : 'Disconnected'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="text-sm text-gray-300">
              Room: <span className="font-mono text-blue-400">{roomId}</span>
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

      {/* Main Content */}
      <div className="flex h-[calc(100vh-65px)]">
        {/* Video Area - Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Video Player */}
          <div className="flex-1 bg-black relative">
            <VideoPlayer 
              roomId={roomId} 
              username={username} 
              onConnectionChange={handleConnectionChange}
            />
          </div>

          {/* Video Controls */}
          <div className="bg-gray-800 border-t border-gray-700 p-4">
            <VideoGrid
              roomId={roomId}
              username={username}
              onCallStarted={handleCallStarted}
              onCallEnded={handleCallEnded}
            />
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
          {/* Toggle Buttons */}
          <div className="flex border-b border-gray-700">
            <button
              onClick={() => setShowParticipants(!showParticipants)}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                showParticipants 
                  ? 'bg-gray-700 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              👥 Participants
            </button>
            <button
              onClick={() => setShowChat(!showChat)}
              className={`flex-1 px-4 py-3 text-sm font-medium ${
                showChat 
                  ? 'bg-gray-700 text-white' 
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              💬 Chat
            </button>
          </div>

          {/* Participants Panel */}
          {showParticipants && (
            <div className="flex-1 overflow-y-auto">
              <ParticipantList roomId={roomId} username={username} />
            </div>
          )}

          {/* Chat Panel */}
          {showChat && (
            <div className="flex-1 overflow-y-auto">
              <ChatPanel roomId={roomId} username={username} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default RoomPageNew
