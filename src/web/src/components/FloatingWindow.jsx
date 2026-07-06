import React, { useRef, useState, useCallback } from 'react'

// Shared z-index counter so the most recently focused window comes to the front.
let TOP_Z = 20

/**
 * A draggable + resizable floating window.
 * - Drag by its title bar to move it anywhere within `boundsRef`.
 * - Drag the bottom-right grip to resize (enlarge / reduce).
 */
export default function FloatingWindow({
  title, icon, initial, minW = 180, minH = 140,
  headerRight, onClose, boundsRef, children
}) {
  const [rect, setRect] = useState(initial)
  const rectRef = useRef(initial)
  const [z, setZ] = useState(() => ++TOP_Z)

  const apply = (next) => { rectRef.current = next; setRect(next) }
  const focus = () => setZ(++TOP_Z)

  const clamp = (r) => {
    const b = boundsRef && boundsRef.current ? boundsRef.current.getBoundingClientRect() : null
    let { x, y, w, h } = r
    if (b) {
      w = Math.max(minW, Math.min(w, b.width))
      h = Math.max(minH, Math.min(h, b.height))
      x = Math.min(Math.max(0, x), Math.max(0, b.width - 80))
      y = Math.min(Math.max(0, y), Math.max(0, b.height - 40))
    } else {
      w = Math.max(minW, w); h = Math.max(minH, h)
      x = Math.max(0, x); y = Math.max(0, y)
    }
    return { x, y, w, h }
  }

  const beginDrag = useCallback((e) => {
    if (e.button !== 0 || e.target.closest('[data-no-drag]')) return
    e.preventDefault(); focus()
    const sx = e.clientX, sy = e.clientY
    const o = rectRef.current
    const move = (ev) => apply(clamp({ ...rectRef.current, x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) }))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  const beginResize = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation(); focus()
    const sx = e.clientX, sy = e.clientY
    const o = rectRef.current
    const move = (ev) => apply(clamp({ ...rectRef.current, w: o.w + (ev.clientX - sx), h: o.h + (ev.clientY - sy) }))
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
    }
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  return (
    <div
      className="absolute flex flex-col rounded-lg overflow-hidden bg-gray-950 border border-gray-800 shadow-2xl shadow-black/60"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: z }}
      onMouseDown={focus}
    >
      <div
        onMouseDown={beginDrag}
        className="flex items-center justify-between h-9 px-3 shrink-0 bg-gray-900 border-b border-gray-800 cursor-move select-none"
      >
        <span className="text-sm font-semibold text-gray-200 truncate">{icon} {title}</span>
        <div className="flex items-center gap-1" data-no-drag>
          {headerRight}
          {onClose && (
            <button onClick={onClose} title="Hide" className="w-6 h-6 rounded hover:bg-gray-700 text-gray-400 hover:text-white text-xs">✕</button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {children}
      </div>

      {/* Resize grip (bottom-right) */}
      <div
        onMouseDown={beginResize}
        title="Drag to resize"
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
        style={{ background: 'linear-gradient(135deg, transparent 45%, #2563eb 45%)' }}
      />
    </div>
  )
}
