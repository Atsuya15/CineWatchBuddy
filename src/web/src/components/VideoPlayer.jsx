import React, { useState, useEffect, useRef } from 'react'
import { websocketManager } from '../utils/websocketManager'

const isYouTubeUrl = (url) => /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url || '')
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
  const prev = window.onYouTubeIframeAPIReady
  window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve() }
})

const VideoPlayer = ({ roomId, username, onConnectionChange }) => {
  const [inputUrl, setInputUrl] = useState('')   // text field (controlled)
  const [videoUrl, setVideoUrl] = useState('')   // committed / currently loaded url
  const [isYouTube, setIsYouTube] = useState(false)
  const [isSyncingVideo, setIsSyncingVideo] = useState(false)

  const videoRef = useRef(null)
  const ytPlayerRef = useRef(null)
  // While Date.now() < applyingUntil, we are applying a REMOTE update, so any
  // local media events it triggers must NOT be broadcast back (prevents the
  // play/pause echo/ping-pong). This is the only sync guard.
  const applyingUntil = useRef(0)
  const pendingLoad = useRef(null)   // url to load once the player element renders
  const isYouTubeRef = useRef(false)
  const loadedUrlRef = useRef('')

  // ---- connection + incoming messages ----
  useEffect(() => {
    websocketManager.connect(roomId, username)
      .then(() => onConnectionChange && onConnectionChange(true))
      .catch((e) => { console.error('WS connect failed', e); onConnectionChange && onConnectionChange(false) })
    const handleMessage = (e) => handleWebSocketMessage(e.detail)
    window.addEventListener('cinewatchbuddy-message', handleMessage)
    return () => window.removeEventListener('cinewatchbuddy-message', handleMessage)
  }, [roomId, username])

  // Load the committed url once the player element exists (runs after render, so
  // the YouTube #yt-player div is present). Only loads urls set via commitUrl().
  useEffect(() => {
    isYouTubeRef.current = isYouTube
    const url = pendingLoad.current
    if (!url || url !== videoUrl) return
    pendingLoad.current = null
    loadedUrlRef.current = url
    if (isYouTube) loadYouTube(url)
    else if (videoRef.current) { videoRef.current.src = url; videoRef.current.load() }
  }, [videoUrl, isYouTube])

  const commitUrl = (url) => {
    setInputUrl(url)
    setVideoUrl(url)
    setIsYouTube(isYouTubeUrl(url))
    isYouTubeRef.current = isYouTubeUrl(url)
    pendingLoad.current = url // the effect above loads it after render
  }

  const sendVideoSync = (data) => {
    if (Date.now() < applyingUntil.current) return // don't echo a remote-applied change
    websocketManager.send('video-sync', {
      ...data,
      url: data.url ?? loadedUrlRef.current,
      roomId, username, timestamp: Date.now()
    })
  }

  const handleWebSocketMessage = (data) => {
    if (data.type === 'video-sync' && data.data) {
      applyRemote(data.data)
    } else if (data.type === 'room-joined' && data.data && data.data.currentVideo) {
      const cv = data.data.currentVideo
      applyRemote({
        url: cv.url || cv.VideoURL || cv.videoUrl,
        currentTime: cv.currentTime, paused: cv.paused, volume: cv.volume
      })
    }
  }

  const applyRemote = (d) => {
    // Suppress the local media events our apply is about to trigger.
    applyingUntil.current = Date.now() + 800
    const url = d.url || d.videoUrl
    const paused = d.paused
    const t = typeof d.currentTime === 'number' ? d.currentTime : null
    const vol = typeof d.volume === 'number' ? d.volume : null

    if (url && url !== loadedUrlRef.current && url !== videoUrl) {
      setIsSyncingVideo(true)
      commitUrl(url)
      setTimeout(() => setIsSyncingVideo(false), 2000)
    }

    if (isYouTubeRef.current && ytPlayerRef.current) {
      const yt = ytPlayerRef.current
      const state = yt.getPlayerState ? yt.getPlayerState() : -1
      if (t != null && Math.abs((yt.getCurrentTime ? yt.getCurrentTime() : 0) - t) > 1.0) yt.seekTo(t, true)
      if (paused === true && (state === 1 || state === 3)) yt.pauseVideo()
      else if (paused === false && state !== 1) yt.playVideo()
      if (vol != null && Math.abs((yt.getVolume ? yt.getVolume() : 0) / 100 - vol) > 0.05) yt.setVolume(vol * 100)
    } else if (videoRef.current) {
      const v = videoRef.current
      if (t != null && Math.abs(v.currentTime - t) > 0.75) { try { v.currentTime = t } catch (e) {} }
      if (paused === true && !v.paused) v.pause()
      else if (paused === false && v.paused) v.play().catch(() => {})
      if (vol != null && Math.abs(v.volume - vol) > 0.05) v.volume = vol
    }
  }

  // ---- local <video> events (also fire when WE apply a remote sync — the
  // applyingUntil guard suppresses those from re-broadcasting) ----
  const handlePlay = () => { if (videoRef.current) sendVideoSync({ currentTime: videoRef.current.currentTime, paused: false, volume: videoRef.current.volume }) }
  const handlePause = () => { if (videoRef.current) sendVideoSync({ currentTime: videoRef.current.currentTime, paused: true, volume: videoRef.current.volume }) }
  const handleSeeked = () => { if (videoRef.current) sendVideoSync({ currentTime: videoRef.current.currentTime, paused: videoRef.current.paused, volume: videoRef.current.volume }) }

  const handleUrlSubmit = (e) => {
    e.preventDefault()
    const url = inputUrl.trim()
    if (!url) return
    commitUrl(url)
    // A URL load is a genuine user action; broadcast it.
    sendVideoSync({ url, currentTime: 0, paused: true, volume: videoRef.current ? videoRef.current.volume : 1 })
  }

  const loadYouTube = async (url) => {
    const id = extractYouTubeId(url)
    if (!id) return
    await ensureYouTubeAPI()
    if (!ytPlayerRef.current) {
      ytPlayerRef.current = new window.YT.Player('yt-player', {
        videoId: id,
        events: {
          onStateChange: (e) => {
            const yt = ytPlayerRef.current
            if (e.data === window.YT.PlayerState.PLAYING) {
              sendVideoSync({ currentTime: yt.getCurrentTime(), paused: false, volume: yt.getVolume() / 100 })
            } else if (e.data === window.YT.PlayerState.PAUSED) {
              sendVideoSync({ currentTime: yt.getCurrentTime(), paused: true, volume: yt.getVolume() / 100 })
            }
          }
        }
      })
    } else {
      ytPlayerRef.current.loadVideoById(id)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Video area */}
      <div className="flex-1 bg-black flex items-center justify-center relative">
        {isSyncingVideo && (
          <div className="absolute inset-0 bg-black bg-opacity-75 flex items-center justify-center z-10">
            <div className="text-center text-white">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
              <p className="text-lg font-semibold">Syncing video from another participant…</p>
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
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
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
