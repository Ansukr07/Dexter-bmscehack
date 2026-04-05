import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import visualizationDemo from '../assets/image.png';
import locationDemo from '../assets/image copy.png';
import videoBg from '../assets/video.mp4';
import './LandingPage.css';

// ─── Intersection Observer for scroll animations ───────────────
function useScrollReveal(className = 'lp-reveal') {
  useEffect(() => {
    const els = document.querySelectorAll('.' + className);
    const io = new IntersectionObserver(
      (entries) => entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.style.animation = 'fadeUp .8s ease both';
          io.unobserve(e.target);
        }
      }),
      { threshold: 0.12 }
    );
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
}

// ─── Logo SVG mark ────────────────────────────────────────────
const LogoMark = () => (
  <div className="lp-logo-icon">
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="3" width="4" height="4" rx="1" fill="white" />
      <rect x="10" y="3" width="4" height="4" rx="1" fill="white" opacity=".7" />
      <rect x="17" y="3" width="4" height="4" rx="1" fill="white" opacity=".4" />
      <rect x="3" y="10" width="4" height="4" rx="1" fill="white" opacity=".7" />
      <rect x="10" y="10" width="4" height="4" rx="1" fill="white" />
      <rect x="17" y="10" width="4" height="4" rx="1" fill="white" opacity=".7" />
      <rect x="3" y="17" width="4" height="4" rx="1" fill="white" opacity=".4" />
      <rect x="10" y="17" width="4" height="4" rx="1" fill="white" opacity=".7" />
      <rect x="17" y="17" width="4" height="4" rx="1" fill="white" />
    </svg>
  </div>
);

const LOGOS = [
  'Muni Transit', 'Metro City', 'Urban Flow', 'CityOps',
  'Vega Analytics', 'TransitGrid', 'FlowSense', 'SmartRoad',
];

const BAR_HEIGHTS = [30, 55, 45, 70, 60, 85, 75, 65];

export default function LandingPage() {
  const navigate = useNavigate();
  useScrollReveal('lp-reveal');

  return (
    <div className="lp">

      {/* ── NAVBAR ── */}
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <div className="lp-logo">
            <LogoMark />
            TrafficLab
          </div>
          <div className="lp-nav-links">
            <a href="#features">Features</a>
            <a href="#platform">Solutions</a>
            <a href="#comms">Real-time</a>
            <a href="#footer">Pricing</a>
            <a href="#footer">Company</a>
          </div>
          <div className="lp-nav-actions">
            <button className="lp-btn-ghost" onClick={() => navigate('/dashboard')}>Sign In</button>
            <button className="lp-btn-primary" onClick={() => navigate('/dashboard')}>Open Dashboard</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-content">
          <div className="lp-integrate-badge">
            <span className="lp-integrate-badge-dot" />
            Live data from 40+ city networks
          </div>
          <h1 className="lp-hero-title" style={{ fontSize: 'clamp(2.4rem, 5vw, 4.2rem)' }}>
            From video to vision,<br />traffic intelligence in real time
          </h1>
          <p className="lp-hero-sub" style={{ maxWidth: 650 }}>
            Detect congestion, prevent accidents, and simulate traffic behavior with an AI-powered digital twin built for smarter cities.
          </p>
          <div className="lp-hero-cta">
            <button className="lp-cta-primary" onClick={() => navigate('/dashboard')}>
              Launch Workspace
            </button>
            <button className="lp-cta-secondary" onClick={() => document.getElementById('platform').scrollIntoView({ behavior: 'smooth' })}>
              Explore Platform →
            </button>
          </div>
        </div>

        {/* City SVG + floating overlays */}
        <div className="lp-hero-visual">
          <div className="lp-hero-visual-inner">
            {/* The landing SVG from assets */}
            <img
              src="/src/assets/landing.svg"
              alt="Isometric 3D city visualization"
              style={{ minHeight: 340 }}
            />

            {/* ── Location pins at road intersections ── */}
            {[
              { left: '27%', top: '44%', delay: '0s' },
              { left: '69%', top: '38%', delay: '0.3s' },
              { left: '82%', top: '48%', delay: '0.3s' },
              { left: '45%', top: '65%', delay: '0.9s' },
            ].map(({ left, top, delay }, i) => (
              <div
                key={i}
                className="lp-pin-wrapper"
                style={{ left, top }}
                onClick={() => navigate('/dashboard/visualization')}
              >
                <div className="lp-pin-tooltip">See the visualisation →</div>
                <div className="lp-pin" style={{ animationDelay: delay }} />
                <div className="lp-pin-tail" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ── */}
      <section className="lp-social">
        <div className="lp-social-inner lp-reveal">
          <div className="lp-social-label">All-in-one analytics solution</div>
          <h2 className="lp-social-headline">
            The analytics platform for cities,<br />operators, and agencies
          </h2>
          <div className="lp-logos-marquee">
            <div className="lp-logos-track">
              {[...LOGOS, ...LOGOS].map((logo, i) => (
                <div key={i} className="lp-logo-item">{logo}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── LOCATION & DATA SOURCES ── */}
      <section className="lp-features" style={{ background: '#11101e', paddingTop: 80, paddingBottom: 80 }}>
        <div className="lp-features-inner">
          <div className="lp-features-header lp-reveal" style={{ marginBottom: 50 }}>
            <div className="lp-features-label">Dataset Selection</div>
            <h2 className="lp-features-title" style={{ fontSize: 'clamp(1.8rem, 3vw, 2.8rem)' }}>
              Choose your location from our library<br />or share the cctv and make your own
            </h2>
          </div>

          <div className="lp-reveal" style={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={locationDemo}
              alt="Location Library Demo"
              style={{
                width: '100%',
                maxWidth: 1000,
                borderRadius: 20,
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                border: '1px solid rgba(200,191,255,0.1)'
              }}
            />
          </div>
        </div>
      </section>

      {/* ── PLATFORM ── */}
      <section id="platform" className="lp-platform">
        <div className="lp-platform-inner">
          <div className="lp-platform-text lp-reveal">
            <div className="lp-platform-label">Precision at every intersection</div>
            <h2 className="lp-platform-title">
              Real-time data that<br />moves at city speed
            </h2>
            <p className="lp-platform-desc">
              Our 3D modeling engine doesn't just show cars — it simulates behavior,
              predicts friction points, and optimizes energy flows across entire
              metropolitan grids.
            </p>
            <ul className="lp-feature-list">
              <li><span className="lp-feat-check">✓</span> Real-time telemetry sync</li>
              <li><span className="lp-feat-check">✓</span> Predictive maintenance AI</li>
              <li><span className="lp-feat-check">✓</span> 3D spatial mapping</li>
              <li><span className="lp-feat-check">✓</span> Multi-agency incident routing</li>
            </ul>
          </div>

          {/* Browser dashboard mockup */}
          <div className="lp-dashboard lp-reveal">
            <div className="lp-browser">
              <div className="lp-browser-bar">
                <div className="lp-browser-dots">
                  <div className="lp-browser-dot lp-dot-r" />
                  <div className="lp-browser-dot lp-dot-y" />
                  <div className="lp-browser-dot lp-dot-g" />
                </div>
                <div className="lp-browser-url">trafficlab.ai/dashboard</div>
              </div>
              <div className="lp-dashboard-body">
                <div className="lp-dash-card">
                  <div className="lp-dash-card-label">Congestion Level</div>
                  <div className="lp-dash-card-value">High</div>
                  <div className="lp-dash-card-badge" style={{ color: '#ffb020', background: 'rgba(255,176,32,0.15)' }}>↑ 15% vs normal</div>
                </div>
                <div className="lp-dash-card">
                  <div className="lp-dash-card-label">Active Vehicles</div>
                  <div className="lp-dash-card-value">412</div>
                  <div className="lp-dash-card-badge">↑ 12 new tracks</div>
                </div>
                <div className="lp-dash-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="lp-dash-card-label">Average Speed Flow</div>
                  <div className="lp-dash-card-value">38 km/h</div>
                  <div className="lp-dash-card-badge" style={{ color: '#ff5c5c', background: 'rgba(255,92,92,0.1)' }}>↓ 10% slowdown detected</div>
                  <div className="lp-dash-bar-chart">
                    {BAR_HEIGHTS.map((h, i) => (
                      <div key={i} className="lp-bar" style={{ height: `${h}%` }} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── ANALYSIS MODULES WITH VIDEO BG ── */}
      <section id="analysis-layer" className="lp-video-section">
        <video autoPlay loop muted playsInline className="lp-video-bg">
          <source src={videoBg} type="video/mp4" />
        </video>
        <div className="lp-video-overlay" />
        
        <div className="lp-features-inner lp-reveal" style={{ position: 'relative', zIndex: 2, padding: '100px 0' }}>
          <div className="lp-features-header">
            <div className="lp-features-label" style={{ color: 'var(--primary)', borderColor: 'rgba(139, 92, 246, 0.3)', background: 'rgba(139, 92, 246, 0.1)' }}>Core Capabilities</div>
            <h2 className="lp-features-title" style={{ fontSize: 'clamp(2rem, 3.5vw, 3.2rem)' }}>
              Complete AI Pipeline Edge Processing
            </h2>
            <p className="lp-features-sub" style={{ fontSize: '1.2rem' }}>
              Advanced telemetry layers that transform raw CCTV feeds into a sophisticated urban digital twin.
            </p>
          </div>
          
          <div className="lp-feature-grid">
            {[
              'Analysis',
              'Analytics',
              'Junction Report',
              'Behavior Patterns',
              'Flood Detection',
              'Pothole Detection',
              'Disaster Rerouting',
            ].map(f => (
              <div key={f} className="lp-vid-card">
                <span className="lp-vid-card-icon">✦</span>
                <span className="lp-vid-card-text">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES — Incident Comms ── */}
      <section id="comms" className="lp-features">
        <div className="lp-features-inner">
          <div className="lp-features-header lp-reveal">
            <div className="lp-features-label">Communication Layer</div>
            <h2 className="lp-features-title">
              Optimize your traffic<br />communication
            </h2>
            <p className="lp-features-sub">
              Bridge the gap between raw data and real-world responses with our automated
              incident management and AI recommendation shell.
            </p>
          </div>

          <div className="lp-reveal" style={{ display: 'flex', justifyContent: 'center', marginBottom: 40 }}>
            <img
              src={visualizationDemo}
              alt="Visualization Demo"
              style={{
                width: '100%',
                maxWidth: 1000,
                borderRadius: 20,
                boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
                border: '1px solid rgba(200,191,255,0.15)'
              }}
            />
          </div>

          <div className="lp-incident-panel lp-reveal">
            <div className="lp-panel-top">
              <div className="lp-panel-incident-tag">Alert #42 — Critical Congestion Heatmap Detected</div>
              <div className="lp-panel-status" style={{ color: '#ff5c5c', background: 'rgba(255,92,92,0.15)' }}>
                <span className="lp-panel-status-dot" style={{ background: '#ff5c5c' }} />
                Active
              </div>
            </div>
            <div style={{ padding: '0 28px', marginTop: 20, display: 'flex', gap: 32, flexWrap: 'wrap' }}>
              {[
                ['Category', 'Heatmap / Congestion'],
                ['Location', 'Sector 4 Intersection'],
                ['Priority', 'Critical'],
                ['AI Confidence', '98.5%'],
                ['Assigned To', 'Automated Light Control'],
                ['Latency', '12ms / Live'],
              ].map(([label, value]) => (
                <div key={label} className="lp-panel-meta-item">
                  <span className="lp-panel-meta-label">{label}</span>
                  <span className="lp-panel-meta-value">{value}</span>
                </div>
              ))}
            </div>
            <div className="lp-panel-body">
              <div className="lp-ai-box" style={{ borderColor: 'rgba(255,176,32,0.3)', background: 'rgba(255,176,32,0.1)' }}>
                <div className="lp-ai-box-label" style={{ color: '#ffb020' }}>
                  <span>✦</span> AI Automated Response
                </div>
                <div className="lp-ai-box-text">
                  Thermal heatmap and tracking density indicate a severe bottleneck forming at Sector 4. The AI node has dynamically phase-shifted traffic lights (+45s Green) on northbound routes to disperse the congestion plume. Broadcasting kinematics-based routing updates to connected smart city nodes.
                </div>
              </div>
              <div className="lp-panel-tabs">
                {['New', 'Received', 'In Progress', 'Done'].map((t, i) => (
                  <div key={t} className={`lp-panel-tab${i === 2 ? ' active' : ''}`}>{t}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer id="footer" className="lp-footer">
        <div className="lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-footer-logo">
              <LogoMark />
              TrafficLab
            </div>
            <div className="lp-footer-tagline">
              Atmospheric Precision in Data Modeling for the modern city landscape.
            </div>
          </div>
          <div className="lp-footer-links">
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Product</div>
              <a href="#features">Features</a>
              <a href="#platform">Dashboard</a>
              <a href="#comms">Incidents</a>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Resources</div>
              <a href="#">Documentation</a>
              <a href="#">API Status</a>
              <a href="#">Support</a>
            </div>
            <div className="lp-footer-col">
              <div className="lp-footer-col-title">Legal</div>
              <a href="#">Privacy</a>
              <a href="#">Terms</a>
            </div>
          </div>

        </div>
        <div className="lp-footer-bottom">
          © 2024 TrafficLab. Atmospheric Precision in Data Modeling.
        </div>
      </footer>

    </div>
  );
}
