import React, { useState, useEffect, useRef } from 'react'

const VideoPlayer = ({ roomId, username, onConnectionChange }) => {
  const [videoUrl, setVideoUrl] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isHost, setIsHost] = useState(false)
  const [ws, setWs] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const isUserAction = useRef(false)

  useEffect(() => {
    // Initialize WebSocket connection
    const connectWebSocket = () => {
      const wsUrl = `ws://localhost:8080/ws?room=${roomId}&user=${encodeURIComponent(username)}`
      const websocket = new WebSocket(wsUrl)

      websocket.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
        onConnectionChange(true)
      }

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          handleWebSocketMessage(data)
        } catch (err) {
          console.error('Error parsing WebSocket message:', err)
        }
      }

      websocket.onclose = () => {
        console.log('WebSocket disconnected')
        setIsConnected(false)
        onConnectionChange(false)
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      websocket.onerror = (error) => {
        console.error('WebSocket error:', error)
        setIsConnected(false)
        onConnectionChange(false)
      }

      setWs(websocket)
    }

    connectWebSocket()

    return () => {
      if (ws) {
        ws.close()
      }
    }
  }, [roomId, username])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'video-sync':
        if (data.data && !isUserAction.current) {
          const { currentTime: syncTime, paused, volume: syncVolume, url } = data.data
          if (videoRef.current) {
            // Sync video URL if different
            if (url && videoRef.current.src !== url) {
              videoRef.current.src = url
              videoRef.current.load()
            }
            
            // Sync playback position (only if difference is significant)
            if (Math.abs(videoRef.current.currentTime - syncTime) > 0.5) {
              videoRef.current.currentTime = syncTime
            }
            
            // Sync play/pause state
            if (videoRef.current.paused !== paused) {
              if (paused) {
                videoRef.current.pause()
                setIsPlaying(false)
              } else {
                videoRef.current.play().catch(console.error)
                setIsPlaying(true)
              }
            }
            
            // Sync volume
            if (Math.abs(videoRef.current.volume - syncVolume) > 0.1) {
              videoRef.current.volume = syncVolume
              setVolume(syncVolume)
            }
          }
        }
        break
      case 'room-joined':
        // Handle room joined with current state
        if (data.data) {
          const { room, currentVideo, chatHistory } = data.data
          setRoom(room)
          
          // Apply current video state if available
          if (currentVideo && videoRef.current) {
            if (currentVideo.url && videoRef.current.src !== currentVideo.url) {
              setVideoUrl(currentVideo.url)
              videoRef.current.src = currentVideo.url
              videoRef.current.load()
            }
            
            if (currentVideo.currentTime) {
              videoRef.current.currentTime = currentVideo.currentTime
            }
            
            if (currentVideo.isPlaying !== undefined) {
              if (currentVideo.isPlaying) {
                videoRef.current.play().catch(console.error)
                setIsPlaying(true)
              } else {
                videoRef.current.pause()
                setIsPlaying(false)
              }
            }
            
            if (currentVideo.volume !== undefined) {
              videoRef.current.volume = currentVideo.volume
              setVolume(currentVideo.volume)
            }
          }
        }
        break
      case 'participant-joined':
      case 'participant-left':
        // Handle participant updates
        break
    }
  }

  const sendVideoSync = (data) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'video-sync',
        data: {
          ...data,
          url: videoUrl,
          roomId,
          username,
          timestamp: Date.now()
        }
      }))
    }
  }

  const handlePlay = () => {
    isUserAction.current = true
    setIsPlaying(true)
    sendVideoSync({ currentTime: videoRef.current.currentTime, paused: false, volume: videoRef.current.volume })
    setTimeout(() => { isUserAction.current = false }, 100)
  }

  const handlePause = () => {
    isUserAction.current = true
    setIsPlaying(false)
    sendVideoSync({ currentTime: videoRef.current.currentTime, paused: true, volume: videoRef.current.volume })
    setTimeout(() => { isUserAction.current = false }, 100)
  }

  const handleSeeked = () => {
    isUserAction.current = true
    setCurrentTime(videoRef.current.currentTime)
    sendVideoSync({ currentTime: videoRef.current.currentTime, paused: videoRef.current.paused, volume: videoRef.current.volume })
    setTimeout(() => { isUserAction.current = false }, 100)
  }

  const handleTimeUpdate = () => {
    setCurrentTime(videoRef.current.currentTime)
  }

  const handleLoadedMetadata = () => {
    setDuration(videoRef.current.duration)
  }

  const handleVolumeChange = () => {
    setVolume(videoRef.current.volume)
    sendVideoSync({ currentTime: videoRef.current.currentTime, paused: videoRef.current.paused, volume: videoRef.current.volume })
  }

  const handleUrlSubmit = (e) => {
    e.preventDefault()
    if (videoUrl.trim()) {
      // For now, just set the URL - in a real implementation, you'd validate and process the URL
      setVideoUrl(videoUrl.trim())
    }
  }

  const formatTime = (time) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="h-full flex flex-col">
      {/* Video area */}
      <div className="flex-1 bg-black flex items-center justify-center">
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="max-w-full max-h-full"
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onVolumeChange={handleVolumeChange}
            controls
          />
        ) : (
          <div className="text-center text-gray-400">
            <div className="mb-4">
              <svg className="w-16 h-16 mx-auto mb-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2">No video loaded</h3>
            <p className="mb-4">Paste a YouTube or Vimeo URL to start watching together</p>
          </div>
        )}
      </div>

      {/* URL input */}
      <div className="p-4 bg-gray-900 border-t border-gray-700">
        <form onSubmit={handleUrlSubmit} className="flex gap-2">
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="Paste YouTube, Vimeo, or direct video URL..."
            className="input flex-1"
          />
          <button type="submit" className="btn btn-primary">
            Load Video
          </button>
        </form>
      </div>

      {/* Video controls */}
      {videoUrl && (
        <div className="p-4 bg-gray-800 border-t border-gray-700">
          <div className="flex items-center gap-4">
            <button
              onClick={() => videoRef.current?.play()}
              className="btn btn-secondary"
            >
              ▶️ Play
            </button>
            <button
              onClick={() => videoRef.current?.pause()}
              className="btn btn-secondary"
            >
              ⏸️ Pause
            </button>
            <div className="flex-1 flex items-center gap-2">
              <span className="text-sm text-gray-400">{formatTime(currentTime)}</span>
              <div className="flex-1 bg-gray-600 rounded-full h-1">
                <div
                  className="bg-red-500 h-1 rounded-full"
                  style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-400">{formatTime(duration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Volume:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={volume}
                onChange={(e) => {
                  if (videoRef.current) {
                    videoRef.current.volume = parseFloat(e.target.value)
                  }
                }}
                className="w-20"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default VideoPlayer
