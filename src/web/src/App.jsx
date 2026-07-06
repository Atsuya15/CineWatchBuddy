import React from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import LandingPage from './components/LandingPage'
import RoomPageTwoSeven from './components/RoomPageTwoSeven'

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:id" element={<RoomPageTwoSeven />} />
      </Routes>
    </Router>
  )
}

export default App
