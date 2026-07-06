import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'

// Floating cats scattered around the landing page.
const CATS = [
  { e: '🐱', left: '7%',  top: '16%', size: 44, dur: 7,  delay: 0 },
  { e: '😺', left: '86%', top: '20%', size: 52, dur: 9,  delay: 1.2 },
  { e: '🐈', left: '13%', top: '72%', size: 58, dur: 8,  delay: 0.6 },
  { e: '😸', left: '80%', top: '74%', size: 40, dur: 10, delay: 1.8 },
  { e: '🐾', left: '48%', top: '8%',  size: 34, dur: 6,  delay: 0.3 },
  { e: '😻', left: '92%', top: '52%', size: 38, dur: 11, delay: 2.2 },
  { e: '🐈', left: '3%',  top: '44%', size: 46, dur: 9,  delay: 1 },
  { e: '😽', left: '40%', top: '88%', size: 42, dur: 8,  delay: 0.9 }
]

const LandingPage = () => {
  const [username, setUsername] = useState('')
  const [roomName, setRoomName] = useState('')
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
      // [TUNNEL] same-origin relative path (was '/api/create-room' via vite proxy)
      const response = await fetch('/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username: username.trim(), roomName: roomName.trim() })
      })

      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text || 'No body'}`)
      }
      const data = await response.json()

      if (data.success) {
        // Store username in localStorage
        localStorage.setItem('cinewatchbuddy_username', username.trim())
        // Navigate to room page (data.roomId is the friendly slug when a name was given)
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
      // [TUNNEL] same-origin relative path (was '/api/join-room' via vite proxy)
      const response = await fetch('/join-room', {
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
        localStorage.setItem('cinewatchbuddy_username', username.trim())
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
    const savedUsername = localStorage.getItem('cinewatchbuddy_username')
    if (savedUsername) {
      setUsername(savedUsername)
    }
  }, [])

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* ambient blue glow */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[32rem] h-[32rem] rounded-full bg-blue-600/20 blur-[120px]"></div>
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[32rem] h-[32rem] rounded-full bg-blue-500/10 blur-[120px]"></div>

      {/* floating cats */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {CATS.map((c, i) => (
          <span
            key={i}
            className="absolute select-none drop-shadow-lg"
            style={{
              left: c.left, top: c.top, fontSize: `${c.size}px`, opacity: 0.55,
              animation: `cwb-float ${c.dur}s ease-in-out infinite`,
              animationDelay: `${c.delay}s`
            }}
          >
            {c.e}
          </span>
        ))}
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src="/CineWatchBuddyLogo.png"
            alt="CineWatchBuddy"
            className="mx-auto w-40 h-40 rounded-2xl object-cover shadow-2xl shadow-black/60 ring-1 ring-white/10"
          />
          <p className="text-gray-400 mt-4">Watch videos together, in perfect sync.</p>
        </div>

        <div className="bg-gray-950/80 backdrop-blur border border-gray-800 rounded-2xl p-6 shadow-2xl shadow-black/50">
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Your name</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter a username"
                className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                maxLength={20}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-300">Room name <span className="text-gray-600 font-normal">(optional)</span></label>
              <input
                type="text"
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="e.g. movie-night"
                className="w-full px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                maxLength={40}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRoom() }}
              />
              <p className="mt-1 text-xs text-gray-600">Friends can join with this name instead of a long ID.</p>
            </div>

            <button
              onClick={handleCreateRoom}
              disabled={isCreating || isJoining}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-semibold transition-colors"
            >
              {isCreating ? 'Creating…' : 'Create a room'}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-800"></div>
              <span className="text-gray-600 text-xs uppercase tracking-wider">or join</span>
              <div className="flex-1 h-px bg-gray-800"></div>
            </div>

            <div className="flex gap-2">
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                placeholder="Room name or ID"
                className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-gray-900 border border-gray-800 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                onKeyDown={(e) => { if (e.key === 'Enter') handleJoinRoom() }}
              />
              <button
                onClick={handleJoinRoom}
                disabled={isCreating || isJoining}
                className="px-5 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 disabled:opacity-50 font-semibold transition-colors"
              >
                {isJoining ? 'Joining…' : 'Join'}
              </button>
            </div>

            {error && (
              <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-3 text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-gray-500 leading-relaxed">
          <p>Supports YouTube, Vimeo, and direct video URLs.</p>
          <p className="mt-1">For Netflix, Disney+ &amp; Prime Video, use the Chrome extension.</p>
        </div>
      </div>
    </div>
  )
}

export default LandingPage
