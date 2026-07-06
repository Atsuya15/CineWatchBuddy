import React, { useState, useEffect } from 'react'

const ParticipantList = ({ participants, roomId, username }) => {
  const [ws, setWs] = useState(null)
  const [participantList, setParticipantList] = useState(participants || [])

  useEffect(() => {
    // Initialize WebSocket connection for participant updates
    const connectWebSocket = () => {
      const wsUrl = `ws://localhost:8080/ws?room=${roomId}&user=${encodeURIComponent(username)}`
      const websocket = new WebSocket(wsUrl)

      websocket.onopen = () => {
        console.log('Participant WebSocket connected')
      }

      websocket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          switch (data.type) {
            case 'participant-joined':
              setParticipantList(prev => {
                const newParticipant = data.data.participant
                if (!prev.find(p => p.id === newParticipant.id)) {
                  return [...prev, newParticipant]
                }
                return prev
              })
              break
            case 'participant-left':
              setParticipantList(prev => 
                prev.filter(p => p.id !== data.data.participantId)
              )
              break
            case 'room-joined':
              setParticipantList(data.data.participants || [])
              break
          }
        } catch (err) {
          console.error('Error parsing participant message:', err)
        }
      }

      websocket.onclose = () => {
        console.log('Participant WebSocket disconnected')
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000)
      }

      websocket.onerror = (error) => {
        console.error('Participant WebSocket error:', error)
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

  const getInitials = (name) => {
    return name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getAvatarColor = (name) => {
    const colors = [
      'bg-red-500',
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500'
    ]
    const hash = name.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0)
      return a & a
    }, 0)
    return colors[Math.abs(hash) % colors.length]
  }

  return (
    <div>
      <h3 className="font-semibold mb-3">Participants ({participantList.length})</h3>
      <div className="space-y-2">
        {participantList.length === 0 ? (
          <p className="text-gray-400 text-sm">No participants yet</p>
        ) : (
          participantList.map((participant) => (
            <div
              key={participant.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-800 transition-colors"
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${getAvatarColor(participant.username)}`}
              >
                {getInitials(participant.username)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {participant.username}
                  </span>
                  {participant.isHost && (
                    <span className="text-xs bg-yellow-600 text-yellow-100 px-2 py-1 rounded">
                      👑 Host
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span className="text-xs text-gray-400">Online</span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Extension info */}
      <div className="mt-6 p-3 bg-blue-900/20 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <div className="text-blue-400 text-sm">💡</div>
          <div className="text-sm">
            <p className="text-blue-300 font-medium mb-1">Want to watch Netflix, Disney+, or Prime Video?</p>
            <p className="text-blue-400 text-xs">
              Install our Chrome extension for DRM-protected content!
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ParticipantList
