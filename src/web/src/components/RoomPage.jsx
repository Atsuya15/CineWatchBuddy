import React, { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import VideoPlayer from './VideoPlayer'
import ChatPanel from './ChatPanel'
import ParticipantList from './ParticipantList'
import ExtensionIntegration from './ExtensionIntegration'
import VideoGrid from './VideoGrid'

const RoomPage = () => {
  const { id } = useParams()
  const [room, setRoom] = useState(null)
  const [username, setUsername] = useState('')
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    // Load username from localStorage
    const savedUsername = localStorage.getItem('cinebuddy_username')
    if (savedUsername) {
      setUsername(savedUsername)
    }

    // Load room data from window.__ROOM_DATA__ (injected by backend)
    if (window.__ROOM_DATA__) {
      setRoom(window.__ROOM_DATA__)
    } else {
      // Fallback: fetch room data
      fetchRoomData()
    }
  }, [id])

  const fetchRoomData = async () => {
    try {
      const name = (localStorage.getItem('cinebuddy_username') || '').trim() || 'guest'
      const response = await fetch('/api/join-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: id, username: name })
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text || 'No body'}`)
      }
      const data = await response.json()
      if (data.success && data.room) {
        setRoom(data.room)
      } else {
        setError('Room not found')
      }
    } catch (err) {
      setError('Failed to load room')
      console.error('Error fetching room:', err)
    }
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4 text-red-400">Error</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => window.location.href = '/'}
            className="btn btn-primary"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!room) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-500 mx-auto mb-4"></div>
          <p className="text-gray-400">Loading room...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      <div className="flex h-screen">
        {/* Main video area */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <div className="bg-gray-900 px-6 py-4 border-b border-gray-700">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-bold">Room: {room.id}</h1>
                <p className="text-gray-400 text-sm">
                  {room.participants?.length || 0} participants
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className={`flex items-center gap-2 ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </div>
                <button
                  onClick={() => window.location.href = '/'}
                  className="btn btn-secondary"
                >
                  Leave Room
                </button>
              </div>
            </div>
          </div>

          {/* Video player */}
          <div className="flex-1 bg-black">
            <VideoPlayer
              roomId={id}
              username={username}
              onConnectionChange={setIsConnected}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col">
          {/* Participants */}
          <div className="p-4 border-b border-gray-700">
            <ParticipantList
              participants={room.participants || []}
              roomId={id}
              username={username}
            />
          </div>

          {/* Extension Integration */}
          <div className="p-4 border-b border-gray-700">
            <ExtensionIntegration
              roomId={id}
              username={username}
              onExtensionReady={(data) => {
                console.log('Extension ready:', data)
              }}
              onVideoSync={(data) => {
                console.log('Extension video sync:', data)
              }}
              onChatMessage={(data) => {
                console.log('Extension chat message:', data)
              }}
            />
          </div>

          {/* Video Call */}
          <div className="p-4 border-b border-gray-700">
            <VideoGrid
              roomId={id}
              username={username}
              onCallStarted={() => console.log('Call started')}
              onCallEnded={() => console.log('Call ended')}
            />
          </div>

          {/* Chat */}
          <div className="flex-1">
            <ChatPanel
              roomId={id}
              username={username}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default RoomPage
