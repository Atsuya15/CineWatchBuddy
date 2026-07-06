import React, { useState, useEffect, useRef } from 'react'
import { websocketManager } from '../utils/websocketManager'

const VideoPlayer = ({ roomId, username, onConnectionChange }) => {
  const [videoUrl, setVideoUrl] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isHost, setIsHost] = useState(false)
  const [ws, setWs] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isSyncingVideo, setIsSyncingVideo] = useState(false)
  
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const ytPlayerRef = useRef(null)
  const [isYouTube, setIsYouTube] = useState(false)
  const isUserAction = useRef(false)
  // Suppress OUTGOING sync while (and shortly after) we apply a remote update.
  // Applying a play/pause/seek fires the local media events, which would
  // otherwise re-broadcast and, with tunnel latency, storm the socket until it
  // drops — making participants appear to get kicked out.
  const remoteUntil = useRef(0)
  // Mirror state into refs so the once-bound WS handler reads CURRENT values
  // (otherwise it sees the initial empty videoUrl and reloads on every sync).
  const videoUrlRef = useRef('')
  const isYouTubeRef = useRef(false)

  useEffect(() => {
    // Connect to shared WebSocket
    websocketManager.connect(roomId, username).then(() => {
      setIsConnected(true)
      onConnectionChange(true)
    }).catch(error => {
      console.error('Failed to connect WebSocket:', error)
      setIsConnected(false)
      onConnectionChange(false)
    })

    // Listen to shared WebSocket messages
    const handleMessage = (event) => {
      handleWebSocketMessage(event.detail)
    }

    window.addEventListener('cinewatchbuddy-message', handleMessage)

    return () => {
      window.removeEventListener('cinewatchbuddy-message', handleMessage)
    }
  }, [roomId, username])

  // Auto-load video when URL changes (for synced videos)
  useEffect(() => {
    if (videoUrl && !isUserAction.current) {
      console.log('🎥 Video URL changed, auto-loading:', videoUrl)
      if (isYouTube) {
        loadYouTube(videoUrl)
      } else if (videoRef.current) {
        videoRef.current.src = videoUrl
        videoRef.current.load()
      }
    }
  }, [videoUrl, isYouTube])

  useEffect(() => { videoUrlRef.current = videoUrl }, [videoUrl])
  useEffect(() => { isYouTubeRef.current = isYouTube }, [isYouTube])

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'video-sync':
        if (data.data && !isUserAction.current) {
          // Entering apply mode: hold off on any outgoing sync for a bit so the
          // events our own play/pause/seek trigger don't echo back to the room.
          remoteUntil.current = Date.now() + 1200
          const { currentTime: syncTime, paused, volume: syncVolume, url: videoUrlFromSync } = data.data
          const url = videoUrlFromSync || data.data.videoUrl
          console.log('🎥 Received video sync:', { url, currentTime: syncTime, paused })
          
          // Handle URL change first (compare against the ref, not stale state)
          if (url && url !== videoUrlRef.current) {
            console.log('🎥 Syncing video URL from another participant:', url)
            setIsSyncingVideo(true)
            setVideoUrl(url)
            videoUrlRef.current = url
            setIsYouTube(isYouTubeUrl(url))
            isYouTubeRef.current = isYouTubeUrl(url)
            
            // Automatically load the video for other participants
            if (isYouTubeUrl(url)) {
              console.log('🎥 Auto-loading YouTube video for other participants')
              loadYouTube(url)
            } else if (videoRef.current) {
              console.log('🎥 Auto-loading regular video for other participants')
              videoRef.current.src = url
              videoRef.current.load()
            }
            
            // Hide syncing indicator after video loads
            setTimeout(() => {
              setIsSyncingVideo(false)
            }, 2000)
          }
          
          // Update UI state for all video types
          setIsPlaying(!paused)
          
          if (isYouTubeRef.current && ytPlayerRef.current) {
            if (url && playerRef.current !== url) {
              loadYouTube(url)
            }
            const targetTime = syncTime || 0
            const state = ytPlayerRef.current.getPlayerState()
            const current = ytPlayerRef.current.getCurrentTime()
            if (Math.abs(current - targetTime) > 0.5) {
              ytPlayerRef.current.seekTo(targetTime, true)
            }
            if (paused && (state === 1 || state === 3)) {
              ytPlayerRef.current.pauseVideo()
            } else if (!paused && state !== 1) {
              ytPlayerRef.current.playVideo()
            }
            if (syncVolume !== undefined && ytPlayerRef.current.getVolume() !== syncVolume * 100) {
              ytPlayerRef.current.setVolume(syncVolume * 100)
            }
          } else if (videoRef.current) {
            // Sync video URL if different
            if (url && videoRef.current.src !== url) {
              console.log('🎥 Setting video source to:', url)
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
              } else {
                videoRef.current.play().catch(console.error)
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
          // Room state is handled by parent component
          
          // Apply current video state if available
          if (currentVideo) {
            const videoUrl = currentVideo.url || currentVideo.VideoURL || currentVideo.videoUrl
            if (videoUrl) {
              // Only suppress echoes when there's real state to apply, so a
              // fresh joiner's own first action isn't swallowed.
              remoteUntil.current = Date.now() + 1200
              setVideoUrl(videoUrl)
              if (isYouTubeUrl(videoUrl)) {
                loadYouTube(videoUrl)
              } else if (videoRef.current) {
                videoRef.current.src = videoUrl
                videoRef.current.load()
              }
            }
            
            if (currentVideo.currentTime && videoRef.current) {
              videoRef.current.currentTime = currentVideo.currentTime
            }
            
            const isPaused = currentVideo.paused !== undefined ? currentVideo.paused : !currentVideo.isPlaying
            if (isPaused !== undefined) {
              if (isPaused) {
                if (videoRef.current) {
                  videoRef.current.pause()
                }
                setIsPlaying(false)
              } else {
                if (videoRef.current) {
                  videoRef.current.play().catch(console.error)
                }
                setIsPlaying(true)
              }
            }
            
            if (currentVideo.volume !== undefined && videoRef.current) {
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
    // Don't echo a change we just applied from a remote sync.
    if (Date.now() < remoteUntil.current) {
      return
    }
    const message = {
      ...data,
      url: data.url || videoUrl, // Use the URL from data if provided, otherwise use current videoUrl
      roomId,
      username,
      timestamp: Date.now()
    }
    console.log('🎥 Sending video-sync message:', message)
    const success = websocketManager.send('video-sync', message)
    console.log('🎥 Video sync sent, success:', success)
  }

  const handlePlay = () => {
    if (videoRef.current) {
      isUserAction.current = true
      videoRef.current.play().catch(console.error)
      setIsPlaying(true)
      sendVideoSync({ currentTime: videoRef.current.currentTime, paused: false, volume: videoRef.current.volume })
      setTimeout(() => { isUserAction.current = false }, 100)
    }
  }

  const handlePause = () => {
    if (videoRef.current) {
      isUserAction.current = true
      videoRef.current.pause()
      setIsPlaying(false)
      sendVideoSync({ currentTime: videoRef.current.currentTime, paused: true, volume: videoRef.current.volume })
      setTimeout(() => { isUserAction.current = false }, 100)
    }
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


  const handleUrlSubmit = (e) => {
    e.preventDefault()
    if (videoUrl.trim()) {
      const url = videoUrl.trim()
      
      // Set user action flag to prevent auto-loading conflicts
      isUserAction.current = true
      
      setVideoUrl(url)
      setIsYouTube(isYouTubeUrl(url))
      
      console.log('🎥 User loading video URL:', url, 'isYouTube:', isYouTubeUrl(url))
      
      // Sync video URL change to other participants
      const syncData = { 
        url: url, 
        currentTime: 0, 
        paused: true, 
        volume: videoRef.current?.volume || 1 
      }
      console.log('🎥 Sending video sync:', syncData)
      sendVideoSync(syncData)
      
      // Load the video for the current user
      if (isYouTubeUrl(url)) {
        loadYouTube(url)
      } else if (videoRef.current) {
        videoRef.current.src = url
        videoRef.current.load()
      }
      
      // Reset user action flag after a short delay
      setTimeout(() => {
        isUserAction.current = false
      }, 1000)
    }
  }

  const isYouTubeUrl = (url) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url)

  const extractYouTubeId = (url) => {
    try {
      const u = new URL(url)
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1)
      return u.searchParams.get('v')
    } catch { return null }
  }

  const ensureYouTubeAPI = () => new Promise((resolve) => {
    if (window.YT && window.YT.Player) return resolve()
    const tag = document.createElement('script')
    tag.src = 'https://www.youtube.com/iframe_api'
    document.body.appendChild(tag)
    window.onYouTubeIframeAPIReady = () => resolve()
  })

  const loadYouTube = async (url) => {
    const id = extractYouTubeId(url)
    if (!id) return
    setIsYouTube(true)
    await ensureYouTubeAPI()
    if (!ytPlayerRef.current) {
      ytPlayerRef.current = new window.YT.Player('yt-player', {
        videoId: id,
        events: {
          onStateChange: (e) => {
            if (e.data === window.YT.PlayerState.PLAYING) {
              setIsPlaying(true)
              // Send sync message for YouTube play
              if (!isUserAction.current) {
                isUserAction.current = true
                sendVideoSync({ 
                  currentTime: ytPlayerRef.current.getCurrentTime(), 
                  paused: false, 
                  volume: ytPlayerRef.current.getVolume() / 100 
                })
                setTimeout(() => { isUserAction.current = false }, 100)
              }
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              setIsPlaying(false)
              // Send sync message for YouTube pause
              if (!isUserAction.current) {
                isUserAction.current = true
                sendVideoSync({ 
                  currentTime: ytPlayerRef.current.getCurrentTime(), 
                  paused: true, 
                  volume: ytPlayerRef.current.getVolume() / 100 
                })
                setTimeout(() => { isUserAction.current = false }, 100)
              }
            }
          }
        }
      })
    } else {
      ytPlayerRef.current.loadVideoById(id)
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
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {isSyncingVideo && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-10">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p className="text-lg font-semibold">Syncing video from another participant...</p>
            </div>
          </div>
        )}
        
        {videoUrl && isYouTube ? (
          <div id="yt-player" className="w-full h-full max-w-full max-h-full"></div>
        ) : videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            className="max-w-full max-h-full"
            onPlay={handlePlay}
            onPause={handlePause}
            onSeeked={handleSeeked}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
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

    </div>
  )
}

export default VideoPlayer
