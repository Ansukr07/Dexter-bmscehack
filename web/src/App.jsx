import { Routes, Route, NavLink } from 'react-router-dom'
import Welcome from './pages/Welcome.jsx'
import Location from './pages/Location.jsx'
import Calibration from './pages/Calibration.jsx'
import Inference from './pages/Inference.jsx'
import Visualization from './pages/Visualization.jsx'
import AIAnalytics from './pages/AIAnalytics.jsx'
import JunctionReport from './pages/JunctionReport.jsx'

const NAV = [
  { to: '/',             label: 'Welcome',       icon: '⬡' },
  { to: '/location',     label: 'Location',      icon: '📍' },
  { to: '/calibration',  label: 'Calibration',   icon: '🎯' },
  { to: '/inference',    label: 'Inference',      icon: '⚡' },
  { to: '/visualization',label: 'Visualization',  icon: '📡' },
  { to: '/ai-analytics', label: 'AI Analytics',   icon: '🧠' },
  { to: '/junction-report', label: 'Junction Report', icon: '📊' },
]

export default function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">TrafficLab</div>
          <div className="sidebar-logo-sub">3D ANALYTICS PLATFORM</div>
          <div className="sidebar-version">v1.1.0</div>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            >
              <span style={{ fontSize: 16 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="status-dot">API Connected</div>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="/"              element={<Welcome />} />
          <Route path="/location"      element={<Location />} />
          <Route path="/calibration"   element={<Calibration />} />
          <Route path="/inference"     element={<Inference />} />
          <Route path="/visualization" element={<Visualization />} />
          <Route path="/ai-analytics" element={<AIAnalytics />} />
          <Route path="/junction-report" element={<JunctionReport />} />
          <Route path="/disaster-management" element={<AIAnalytics />} />
        </Routes>
      </main>
    </div>
  )
}
