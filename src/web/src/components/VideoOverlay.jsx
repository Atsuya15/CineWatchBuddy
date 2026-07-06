import React, { useState, useEffect, useRef } from 'react'
import { connectionManager } from '../utils/connectionManager'
import { crossTabSync } from '../utils/crossTabSync'

const VideoOverlay = ({ roomId, username, isVisible, onToggle }) => {
  const [participants, setParticipants] = useState([])
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isHost, setIsHost] = useState(false)
  const [connectionState, setConnectionState] = useState('disconnected')
  const [reactions, setReactions] = useState([])
  const [typingUsers, setTypingUsers] = useState(new Set())
  const [showControls, setShowControls] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showReactions, setShowReactions] = useState(false)
  
  const overlayRef = useRef(null)
  const controlsTimeout = useRef(null)
  const reactionTimeout = useRef(null)

  // Available reactions
  const availableReactions = ['👍', '👎', '❤️', '😂', '😮', '😢', '😡', '🎉']

  useEffect(() => {
    if (!isVisible) return

    // Set up event listeners
    const handleParticipantJoined = (data) => {
      setParticipants(prev => [...prev, data.participant])
    }

    const handleParticipantLeft = (data) => {
      setParticipants(prev => prev.filter(p => p.id !== data.participantId))
    }

    const handleVideoSync = (data) => {
      setIsPlaying(!data.paused)
      setCurrentTime(data.currentTime || 0)
      setDuration(data.duration || 0)
    }

    const handleConnectionStateChange = (state) => {
      setConnectionState(state)
    }

    const handleReaction = (data) => {
      const reaction = {
        id: Date.now() + Math.random(),
        emoji: data.emoji,
        username: data.username,
        timestamp: Date.now(),
        x: Math.random() * 80 + 10, // Random position
        y: Math.random() * 60 + 20
      }
      
      setReactions(prev => [...prev, reaction])
      
      // Remove reaction after 3 seconds
      setTimeout(() => {
        setReactions(prev => prev.filter(r => r.id !== reaction.id))
      }, 3000)
    }

    const handleTypingStart = (data) => {
      setTypingUsers(prev => new Set([...prev, data.username]))
    }

    const handleTypingStop = (data) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev)
        newSet.delete(data.username)
        return newSet
      })
    }

    // Register listeners
    connectionManager.on('participantJoined', handleParticipantJoined)
    connectionManager.on('participantLeft', handleParticipantLeft)
    connectionManager.on('videoSync', handleVideoSync)
    connectionManager.on('connectionStateChanged', handleConnectionStateChange)
    crossTabSync.on('reaction', handleReaction)
    crossTabSync.on('typingStart', handleTypingStart)
    crossTabSync.on('typingStop', handleTypingStop)

    // Cleanup
    return () => {
      connectionManager.off('participantJoined', handleParticipantJoined)
      connectionManager.off('participantLeft', handleParticipantLeft)
      connectionManager.off('videoSync', handleVideoSync)
      connectionManager.off('connectionStateChanged', handleConnectionStateChange)
      crossTabSync.off('reaction', handleReaction)
      crossTabSync.off('typingStart', handleTypingStart)
      crossTabSync.off('typingStop', handleTypingStop)
    }
  }, [isVisible])

  // Mouse movement handler for controls
  const handleMouseMove = () => {
    setShowControls(true)
    
    if (controlsTimeout.current) {
      clearTimeout(controlsTimeout.current)
    }
    
    controlsTimeout.current = setTimeout(() => {
      setShowControls(false)
    }, 3000)
  }

  // Reaction handlers
  const sendReaction = (emoji) => {
    const reactionData = {
      emoji,
      username,
      roomId,
      timestamp: Date.now()
    }
    
    crossTabSync.syncChatMessage({
      type: 'reaction',
      ...reactionData
    })
    
    // Show local reaction immediately
    const reaction = {
      id: Date.now() + Math.random(),
      emoji,
      username: 'You',
      timestamp: Date.now(),
      x: Math.random() * 80 + 10,
      y: Math.random() * 60 + 20
    }
    
    setReactions(prev => [...prev, reaction])
    
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== reaction.id))
    }, 3000)
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

  if (!isVisible) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center"
      onMouseMove={handleMouseMove}
      onClick={(e) => {
        if (e.target === overlayRef.current) {
          onToggle()
        }
      }}
    >
      {/* Main Overlay Content */}
      <div className="relative w-full h-full max-w-6xl max-h-4xl bg-gray-900 rounded-lg overflow-hidden">
        
        {/* Top Controls Bar */}
        <div className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black to-transparent p-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={onToggle}
                className="text-white hover:text-gray-300 transition-colors"
              >
                ✕ Close
              </button>
              
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${getConnectionStatusColor()}`}></div>
                <span className="text-white text-sm">
                  {participants.length} watching
                </span>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <button
                onClick={() => setShowParticipants(!showParticipants)}
                className="text-white hover:text-gray-300 transition-colors"
              >
                👥 Participants
              </button>
              
              <button
                onClick={() => setShowReactions(!showReactions)}
                className="text-white hover:text-gray-300 transition-colors"
              >
                😊 Reactions
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Controls Bar */}
        <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-4 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="text-white hover:text-gray-300 transition-colors text-2xl"
              >
                {isPlaying ? '⏸️' : '▶️'}
              </button>
              
              <div className="text-white text-sm">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <span className="text-white text-sm">
                {isHost ? '🎯 Host' : '👥 Participant'}
              </span>
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="mt-2">
            <div className="w-full bg-gray-700 rounded-full h-1">
              <div
                className="bg-blue-600 h-1 rounded-full transition-all duration-300"
                style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Participants Panel */}
        {showParticipants && (
          <div className="absolute top-16 right-4 bg-gray-800 bg-opacity-90 rounded-lg p-4 w-64 max-h-64 overflow-y-auto">
            <h3 className="text-white font-semibold mb-3">Participants</h3>
            <div className="space-y-2">
              {participants.map(participant => (
                <div key={participant.id} className="flex items-center space-x-2">
                  <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm">
                    {participant.username.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <div className="text-white text-sm">{participant.username}</div>
                    <div className="text-gray-400 text-xs">
                      {participant.isHost ? 'Host' : 'Participant'}
                    </div>
                  </div>
                  <div className={`w-2 h-2 rounded-full ${participant.isActive ? 'bg-green-500' : 'bg-gray-500'}`}></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reactions Panel */}
        {showReactions && (
          <div className="absolute top-16 left-4 bg-gray-800 bg-opacity-90 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-3">Reactions</h3>
            <div className="grid grid-cols-4 gap-2">
              {availableReactions.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  className="text-2xl hover:scale-110 transition-transform p-2 rounded hover:bg-gray-700"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Floating Reactions */}
        {reactions.map(reaction => (
          <div
            key={reaction.id}
            className="absolute text-4xl pointer-events-none animate-bounce"
            style={{
              left: `${reaction.x}%`,
              top: `${reaction.y}%`,
              animation: 'bounce 1s ease-in-out'
            }}
          >
            {reaction.emoji}
          </div>
        ))}

        {/* Typing Indicator */}
        {typingUsers.size > 0 && (
          <div className="absolute bottom-20 left-4 bg-gray-800 bg-opacity-90 rounded-lg p-2">
            <div className="text-white text-sm">
              {Array.from(typingUsers).join(', ')} {typingUsers.size === 1 ? 'is' : 'are'} typing...
            </div>
          </div>
        )}

        {/* Connection Status Overlay */}
        {connectionState === 'reconnecting' && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center">
            <div className="text-center text-white">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
              <div className="text-lg font-semibold">Reconnecting...</div>
              <div className="text-sm text-gray-300">Please wait while we restore your connection</div>
            </div>
          </div>
        )}

        {/* Video Placeholder */}
        <div className="w-full h-full bg-gray-800 flex items-center justify-center">
          <div className="text-center text-white">
            <div className="text-6xl mb-4">🎬</div>
            <div className="text-xl font-semibold mb-2">Video Overlay</div>
            <div className="text-gray-300">Click outside to close</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VideoOverlay
