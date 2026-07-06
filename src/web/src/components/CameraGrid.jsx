import React, { useEffect, useRef, useState } from 'react'

// Resizable camera mosaic. Tiles fill the panel, and the split between adjacent
// tiles (and between rows) is draggable — so participants can be sized unevenly
// (e.g. 70/30) instead of a fixed equal split. `tiles` is an array of keyed
// React elements (one per participant).
export default function CameraGrid({ tiles }) {
  const count = tiles.length
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)))
  const rows = Math.max(1, Math.ceil(count / cols))

  const [tileW, setTileW] = useState(() => Array(count).fill(1))
  const [rowW, setRowW] = useState(() => Array(rows).fill(1))
  const tileWRef = useRef(tileW)
  const rowWRef = useRef(rowW)
  tileWRef.current = tileW
  rowWRef.current = rowW
  const gridRef = useRef(null)

  // Reset weights when the tile/row count changes (participant joined/left).
  useEffect(() => {
    setTileW(Array(count).fill(1))
    setRowW(Array(rows).fill(1))
  }, [count, rows])

  // Group tile indices into rows (last row may hold fewer — it just fills).
  const rowsOfTiles = []
  for (let r = 0; r < rows; r++) {
    const row = []
    for (let c = 0; c < cols && r * cols + c < count; c++) row.push(r * cols + c)
    rowsOfTiles.push(row)
  }

  const redistribute = (a, b, delta, min) => {
    let na = a + delta, nb = b - delta
    if (na < min) { nb -= (min - na); na = min }
    if (nb < min) { na -= (min - nb); nb = min }
    return [na, nb]
  }

  const beginColDrag = (rowGis, leftPos, rowEl, e) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const W = rowEl.getBoundingClientRect().width
    const startX = e.clientX
    const gL = rowGis[leftPos], gR = rowGis[leftPos + 1]
    const base = tileWRef.current
    const a = base[gL], b = base[gR]
    const rowTotal = rowGis.reduce((s, gi) => s + base[gi], 0)
    const move = (ev) => {
      const delta = (ev.clientX - startX) * rowTotal / Math.max(1, W)
      const [na, nb] = redistribute(a, b, delta, 0.2)
      setTileW(cur => { const c = [...cur]; c[gL] = na; c[gR] = nb; return c })
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''; document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  const beginRowDrag = (topRow, e) => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const H = gridRef.current ? gridRef.current.getBoundingClientRect().height : 1
    const startY = e.clientY
    const base = rowWRef.current
    const a = base[topRow], b = base[topRow + 1]
    const total = base.reduce((s, v) => s + v, 0)
    const move = (ev) => {
      const delta = (ev.clientY - startY) * total / Math.max(1, H)
      const [na, nb] = redistribute(a, b, delta, 0.2)
      setRowW(cur => { const c = [...cur]; c[topRow] = na; c[topRow + 1] = nb; return c })
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''; document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'; document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  return (
    <div ref={gridRef} className="h-full flex flex-col gap-1">
      {rowsOfTiles.map((rowGis, r) => (
        <React.Fragment key={r}>
          {r > 0 && (
            <div
              onMouseDown={(e) => beginRowDrag(r - 1, e)}
              className="h-1 shrink-0 cursor-row-resize rounded bg-gray-800 hover:bg-blue-500 transition-colors"
              title="Drag to resize rows"
            />
          )}
          <div className="flex gap-1 min-h-0" style={{ flexGrow: rowW[r] ?? 1, flexBasis: 0 }}>
            {rowGis.map((gi, p) => (
              <React.Fragment key={tiles[gi].key ?? gi}>
                {p > 0 && (
                  <div
                    onMouseDown={(e) => beginColDrag(rowGis, p - 1, e.currentTarget.parentElement, e)}
                    className="w-1 shrink-0 cursor-col-resize rounded bg-gray-800 hover:bg-blue-500 transition-colors"
                    title="Drag to resize"
                  />
                )}
                <div className="relative min-w-0 min-h-0" style={{ flexGrow: tileW[gi] ?? 1, flexBasis: 0 }}>
                  {tiles[gi]}
                </div>
              </React.Fragment>
            ))}
          </div>
        </React.Fragment>
      ))}
    </div>
  )
}
