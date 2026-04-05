import { Routes, Route, NavLink, Link, Navigate } from 'react-router-dom'
import { Home, MapPin, Target, Zap, Activity, Brain, FileBarChart, Repeat, Droplets, Circle, AlertTriangle, Bell, Search, LayoutGrid } from 'lucide-react'
import Welcome from './pages/Welcome.jsx'
import Location from './pages/Location.jsx'
import Calibration from './pages/Calibration.jsx'
import Inference from './pages/Inference.jsx'
import Visualization from './pages/Visualization.jsx'
import AIAnalytics from './pages/AIAnalytics.jsx'
import JunctionReport from './pages/JunctionReport.jsx'
import BehaviorPatterns from './pages/BehaviorPatterns.jsx'
import FloodDetection from './pages/FloodDetection.jsx'
import PotholeDetection from './pages/PotholeDetection.jsx'
import DisasterRerouting from './pages/DisasterRerouting.jsx'
import LandingPage from './pages/LandingPage.jsx'

const NAV_PIPELINE = [
  { to: '/dashboard',                    label: 'Home',             icon: Home },
  { to: '/dashboard/location',           label: 'Location',         icon: MapPin },
  { to: '/dashboard/calibration',        label: 'Calibration',      icon: Target },
  { to: '/dashboard/inference',          label: 'Inference',        icon: Zap },
  { to: '/dashboard/visualization',      label: 'Visualization',    icon: Activity },
]

const NAV_ANALYSIS = [
  { to: '/dashboard/ai-analytics',       label: 'Analytics',        icon: Brain },
  { to: '/dashboard/junction-report',    label: 'Junction Report',   icon: FileBarChart },
  { to: '/dashboard/behavior-patterns',  label: 'Behavior Patterns', icon: Repeat },
  { to: '/dashboard/flood-detection',    label: 'Flood Detection',   icon: Droplets },
  { to: '/dashboard/pothole-detection',  label: 'Pothole Detection', icon: Circle },
  { to: '/dashboard/disaster-rerouting', label: 'Disaster Rerouting',icon: AlertTriangle },
]

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/landing" element={<LandingPage />} />
      
      {/* Dashboard Routes wrapper */}
      <Route path="/dashboard/*" element={
        <div className="app-shell">
          <aside className="sidebar fade-in">
            <Link to="/" style={{ textDecoration: 'none' }}>
              <div className="sidebar-logo">
                <LayoutGrid size={24} color="var(--primary)" />
                <div className="sidebar-logo-title">TrafficLab</div>
              </div>
            </Link>

            <nav className="sidebar-nav">
              <div className="nav-section-label">Menu</div>
              {NAV_PIPELINE.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/dashboard'}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}

              <div className="nav-section-label" style={{ marginTop: 24 }}>Analysis</div>
              {NAV_ANALYSIS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
                >
                  <Icon size={18} />
                  {label}
                </NavLink>
              ))}
            </nav>
            
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: "12px", color: "var(--text-muted)", cursor: "pointer", padding: "12px 16px", fontWeight: "600", fontSize: "14px" }}>
               Log Out
            </div>
          </aside>

          <main className="main-content">
            <header className="page-header">
              <div>
                <div className="header-user-text">Hello, Admin</div>
                <div className="header-sub-text">Here is your current traffic network overview</div>
              </div>
              
              <div className="header-icons">
              </div>
            </header>
            
            <div className="page-body">
              <Routes>
                <Route path=""                       element={<Welcome />} />
                <Route path="location"               element={<Location />} />
                <Route path="calibration"            element={<Calibration />} />
                <Route path="inference"              element={<Inference />} />
                <Route path="visualization"          element={<Visualization />} />
                <Route path="ai-analytics"           element={<AIAnalytics />} />
                <Route path="junction-report"        element={<JunctionReport />} />
                <Route path="behavior-patterns"      element={<BehaviorPatterns />} />
                <Route path="flood-detection"        element={<FloodDetection />} />
                <Route path="pothole-detection"      element={<PotholeDetection />} />
                <Route path="disaster-rerouting"     element={<DisasterRerouting />} />
                <Route path="*"                      element={<Navigate to="ai-analytics" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      } />
    </Routes>
  )
}
