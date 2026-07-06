import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

const LandingPage = () => {
  const [username, setUsername] = useState('')
  const [roomId, setRoomId] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isJoining, setIsJoining] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const handleCreateRoom = async () => {
    if (!username.trim()) {
      setError('Please enter a username')
      return
    }

    setIsCreating(true)
    setError('')

    try {
      const response = await fetch('/api/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username.trim() })
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text || 'No body'}`)
      }
      const data = await response.json()

      if (data.success) {
        // Store username in localStorage
        localStorage.setItem('cinebuddy_username', username.trim())
        // Navigate to room page
        navigate(`/room/${data.roomId}`)
      } else {
        setError(data.message || 'Failed to create room')
      }
    } catch (err) {
      setError('Failed to create room. Please try again.')
      console.error('Error creating room:', err)
    } finally {
      setIsCreating(false)
    }
  }

  const handleJoinRoom = async () => {
    if (!username.trim()) {
      setError('Please enter a username')
      return
    }
    if (!roomId.trim()) {
      setError('Please enter a room ID')
      return
    }

    setIsJoining(true)
    setError('')

    try {
      const response = await fetch('/api/join-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          username: username.trim(),
          roomId: roomId.trim()
        })
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text || 'No body'}`)
      }
      const data = await response.json()

      if (data.success) {
        // Store username in localStorage
        localStorage.setItem('cinebuddy_username', username.trim())
        // Navigate to room page
        navigate(`/room/${roomId.trim()}`)
      } else {
        setError(data.message || 'Failed to join room')
      }
    } catch (err) {
      setError('Failed to join room. Please try again.')
      console.error('Error joining room:', err)
    } finally {
      setIsJoining(false)
    }
  }

  // Load username from localStorage on mount
  React.useEffect(() => {
    const savedUsername = localStorage.getItem('cinebuddy_username')
    if (savedUsername) {
      setUsername(savedUsername)
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card w-full max-w-md">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold mb-2">🎬 CineWatchBuddy</h1>
          <p className="text-gray-400">Watch videos together with friends</p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              className="input"
              maxLength={20}
            />
          </div>

          <div className="space-y-3">
            <button
              onClick={handleCreateRoom}
              disabled={isCreating || isJoining}
              className="btn btn-primary w-full"
            >
              {isCreating ? 'Creating...' : 'Create Room'}
            </button>

            <div className="flex items-center">
              <div className="flex-1 h-px bg-gray-600"></div>
              <span className="px-3 text-gray-400 text-sm">or</span>
              <div className="flex-1 h-px bg-gray-600"></div>
            </div>

            <div>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Enter room ID"
                className="input mb-3"
              />
              <button
                onClick={handleJoinRoom}
                disabled={isCreating || isJoining}
                className="btn btn-secondary w-full"
              >
                {isJoining ? 'Joining...' : 'Join Room'}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-sm text-gray-400">
          <p>Supports YouTube, Vimeo, and more!</p>
          <p className="mt-1">For Netflix, Disney+, Prime Video, use our Chrome extension</p>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
