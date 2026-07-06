import React, { useState, useEffect, useRef, useCallback } from 'react'
import { connectionManager } from '../utils/connectionManager'
import LeaderElection from '../utils/leaderElection'

const VideoPlayerEnhanced = ({ roomId, username, onConnectionChange }) => {
  const [videoUrl, setVideoUrl] = useState('')
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isHost, setIsHost] = useState(false)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState(null)
  const [syncAccuracy, setSyncAccuracy] = useState(0)
  
  const videoRef = useRef(null)
  const playerRef = useRef(null)
  const isUserAction = useRef(false)
  const leaderElection = useRef(null)
  const syncTimeout = useRef(null)
  const lastSyncData = useRef(null)

  // Initialize connection manager and leader election
  useEffect(() => {
    leaderElection.current = new LeaderElection(connectionManager)
    
    // Set up event listeners
    const handleConnectionStateChange = (state) => {
      setConnectionState(state)
      setIsReconnecting(state === 'reconnecting')
      onConnectionChange(state === 'connected')
    }

    const handleVideoSync = (data) => {
      if (isUserAction.current) {
        isUserAction.current = false
        return
      }

      // Calculate sync accuracy
      const now = Date.now()
      const timeDiff = Math.abs(now - (data.timestamp || now))
      setSyncAccuracy(timeDiff)
      setLastSyncTime(now)

      // Apply sync data
      if (videoRef.current) {
        const video = videoRef.current
        
        // Sync video URL if different
        if (data.videoUrl && data.videoUrl !== videoUrl) {
          setVideoUrl(data.videoUrl)
          video.src = data.videoUrl
        }

        // Sync playback state
        if (data.paused !== undefined) {
          if (data.paused && !video.paused) {
            video.pause()
          } else if (!data.paused && video.paused) {
            video.play().catch(console.error)
          }
        }

        // Sync current time (only if significantly different)
        if (data.currentTime !== undefined) {
          const timeDiff = Math.abs(video.currentTime - data.currentTime)
          if (timeDiff > 0.5) { // Only sync if more than 0.5 seconds off
            video.currentTime = data.currentTime
          }
        }

        // Sync playback rate
        if (data.playbackRate !== undefined && video.playbackRate !== data.playbackRate) {
          video.playbackRate = data.playbackRate
        }

        // Sync volume
        if (data.volume !== undefined && video.volume !== data.volume) {
          video.volume = data.volume
        }
      }
    }

    const handleRoomJoined = (data) => {
      if (data.room) {
        setIsHost(data.room.participants.length === 1)
        leaderElection.current.setCurrentParticipantId(data.participantId)
      }
      
      if (data.currentVideo) {
        const video = data.currentVideo
        setVideoUrl(video.videoUrl || '')
        setCurrentTime(video.currentTime || 0)
        setIsPlaying(!video.paused)
        setDuration(video.duration || 0)
        setVolume(video.volume || 1)
      }
    }

    const handleParticipantJoined = (data) => {
      console.log('Participant joined:', data.participant.username)
    }

    const handleParticipantLeft = (data) => {
      console.log('Participant left:', data.participantId)
    }

    // Register event listeners
    connectionManager.on('connectionStateChanged', handleConnectionStateChange)
    connectionManager.on('videoSync', handleVideoSync)
    connectionManager.on('roomJoined', handleRoomJoined)
    connectionManager.on('participantJoined', handleParticipantJoined)
    connectionManager.on('participantLeft', handleParticipantLeft)

    // Connect to WebSocket
    connectionManager.connect().then(() => {
      connectionManager.joinRoom(roomId, username)
    }).catch(error => {
      console.error('Failed to connect:', error)
    })

    // Cleanup
    return () => {
      connectionManager.off('connectionStateChanged', handleConnectionStateChange)
      connectionManager.off('videoSync', handleVideoSync)
      connectionManager.off('roomJoined', handleRoomJoined)
      connectionManager.off('participantJoined', handleParticipantJoined)
      connectionManager.off('participantLeft', handleParticipantLeft)
      
      if (leaderElection.current) {
        leaderElection.current.destroy()
      }
    }
  }, [roomId, username, onConnectionChange])

  // Video event handlers
  const handlePlay = useCallback(() => {
    if (!videoRef.current) return
    
    isUserAction.current = true
    setIsPlaying(true)
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: false,
        currentTime: videoRef.current.currentTime,
        playbackRate: videoRef.current.playbackRate,
        videoUrl: videoUrl,
        duration: videoRef.current.duration,
        volume: videoRef.current.volume
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }, [roomId, videoUrl])

  const handlePause = useCallback(() => {
    if (!videoRef.current) return
    
    isUserAction.current = true
    setIsPlaying(false)
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: true,
        currentTime: videoRef.current.currentTime,
        playbackRate: videoRef.current.playbackRate,
        videoUrl: videoUrl,
        duration: videoRef.current.duration,
        volume: videoRef.current.volume
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }, [roomId, videoUrl])

  const handleSeeked = useCallback(() => {
    if (!videoRef.current) return
    
    isUserAction.current = true
    setCurrentTime(videoRef.current.currentTime)
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: videoRef.current.paused,
        currentTime: videoRef.current.currentTime,
        playbackRate: videoRef.current.playbackRate,
        videoUrl: videoUrl,
        duration: videoRef.current.duration,
        volume: videoRef.current.volume
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }, [roomId, videoUrl])

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return
    
    setCurrentTime(videoRef.current.currentTime)
    
    // Throttled sync for time updates (only leader)
    if (leaderElection.current?.isCurrentUserLeader()) {
      if (syncTimeout.current) {
        clearTimeout(syncTimeout.current)
      }
      
      syncTimeout.current = setTimeout(() => {
        const syncData = {
          roomId,
          paused: videoRef.current.paused,
          currentTime: videoRef.current.currentTime,
          playbackRate: videoRef.current.playbackRate,
          videoUrl: videoUrl,
          duration: videoRef.current.duration,
          volume: videoRef.current.volume
        }
        
        leaderElection.current.sendVideoSync(syncData)
      }, 100) // Throttle to 100ms
    }
  }, [roomId, videoUrl])

  const handleVolumeChange = useCallback(() => {
    if (!videoRef.current) return
    
    setVolume(videoRef.current.volume)
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: videoRef.current.paused,
        currentTime: videoRef.current.currentTime,
        playbackRate: videoRef.current.playbackRate,
        videoUrl: videoUrl,
        duration: videoRef.current.duration,
        volume: videoRef.current.volume
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }, [roomId, videoUrl])

  const handleRateChange = useCallback(() => {
    if (!videoRef.current) return
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: videoRef.current.paused,
        currentTime: videoRef.current.currentTime,
        playbackRate: videoRef.current.playbackRate,
        videoUrl: videoUrl,
        duration: videoRef.current.duration,
        volume: videoRef.current.volume
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }, [roomId, videoUrl])

  const handleUrlChange = (newUrl) => {
    setVideoUrl(newUrl)
    if (videoRef.current) {
      videoRef.current.src = newUrl
    }
    
    // Only leader should broadcast
    if (leaderElection.current?.isCurrentUserLeader()) {
      const syncData = {
        roomId,
        paused: videoRef.current?.paused || false,
        currentTime: videoRef.current?.currentTime || 0,
        playbackRate: videoRef.current?.playbackRate || 1,
        videoUrl: newUrl,
        duration: videoRef.current?.duration || 0,
        volume: videoRef.current?.volume || 1
      }
      
      leaderElection.current.sendVideoSync(syncData)
    }
  }

  // Format time helper
  const formatTime = (time) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Connection status indicator
  const getConnectionStatusColor = () => {
    switch (connectionState) {
      case 'connected': return 'bg-green-500'
      case 'connecting': return 'bg-yellow-500'
      case 'reconnecting': return 'bg-orange-500'
      case 'disconnected': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  const getConnectionStatusText = () => {
    switch (connectionState) {
      case 'connected': return 'Connected'
      case 'connecting': return 'Connecting...'
      case 'reconnecting': return 'Reconnecting...'
      case 'disconnected': return 'Disconnected'
      default: return 'Unknown'
    }
  }

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      {/* Connection Status */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <div className={`w-3 h-3 rounded-full ${getConnectionStatusColor()}`}></div>
          <span className="text-sm text-gray-300">{getConnectionStatusText()}</span>
          {isReconnecting && (
            <span className="text-xs text-orange-400">Auto-reconnecting...</span>
          )}
        </div>
        
        {/* Sync Status */}
        <div className="text-xs text-gray-400">
          {lastSyncTime && (
            <span>Last sync: {new Date(lastSyncTime).toLocaleTimeString()}</span>
          )}
          {syncAccuracy > 0 && (
            <span className="ml-2">Accuracy: {syncAccuracy}ms</span>
          )}
        </div>
      </div>

      {/* Video Player */}
      <div className="relative">
        <video
          ref={videoRef}
          className="w-full h-64 bg-black rounded"
          controls
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={handleSeeked}
          onTimeUpdate={handleTimeUpdate}
          onVolumeChange={handleVolumeChange}
          onRateChange={handleRateChange}
          onLoadedMetadata={() => {
            if (videoRef.current) {
              setDuration(videoRef.current.duration)
            }
          }}
        >
          Your browser does not support the video tag.
        </video>
      </div>

      {/* Video URL Input */}
      <div className="mt-4">
        <label className="block text-sm font-medium text-gray-300 mb-2">
          Video URL
        </label>
        <div className="flex space-x-2">
          <input
            type="url"
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleUrlChange(e.target.value)
              }
            }}
            placeholder="Paste video URL here (YouTube, Vimeo, etc.)"
            className="flex-1 px-3 py-2 bg-gray-800 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => handleUrlChange(videoUrl)}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Load
          </button>
        </div>
      </div>

      {/* Video Controls */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <span className="text-sm text-gray-300">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <span className="text-sm text-gray-300">
            Volume: {Math.round(volume * 100)}%
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-300">
            {leaderElection.current?.isCurrentUserLeader() ? '🎯 Leader' : '👥 Participant'}
          </span>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mt-2">
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          ></div>
        </div>
      </div>
    </div>
  )
}

export default VideoPlayerEnhanced
