import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS } from '../lib/labels.js';
import SimulationBar from './SimulationBar.jsx';

const NAV = {
  DISPATCHER: [
    { to: '/jobs', label: 'Jobs' },
    { to: '/riders', label: 'Riders' },
  ],
  RIDER: [{ to: '/me', label: 'My work' }],
};

export function Wordmark({ inverted = false }) {
  return (
    <span className={`wordmark${inverted ? ' wordmark--inverted' : ''}`}>
      <svg className="wordmark__mark" viewBox="0 0 28 16" aria-hidden="true">
        <path d="M1 8h26" />
        <circle cx="14" cy="8" r="5.5" />
      </svg>
      RELAY
    </span>
  );
}

export default function AppShell() {
  const { user, signOut } = useAuth();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <Link to="/" className="topbar__brand" aria-label="RELAY home">
          <Wordmark inverted />
        </Link>
        <nav className="topbar__nav" aria-label="Main">
          {(NAV[user.role] ?? []).map((item) => (
            <NavLink key={item.to} to={item.to} className="topbar__link">
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="topbar__user">
          <span className="topbar__name">
            {user.name}
            <span className="topbar__role">{ROLE_LABELS[user.role]}</span>
          </span>
          <button type="button" className="button button--on-dark" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>
      {user.role === 'DISPATCHER' && <SimulationBar />}
      <main id="main" className="page" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
