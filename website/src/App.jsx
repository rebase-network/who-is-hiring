import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import JobList from './JobList'
import JobDetail from './JobDetail'
import './App.css'

function App() {
  return (
    <Router basename="/who-is-hiring">
      <Routes>
        <Route path="/" element={<JobList />} />
        <Route path="/job/:issueNumber" element={<JobDetail />} />
      </Routes>
    </Router>
  )
}

export default App
