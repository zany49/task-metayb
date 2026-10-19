import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { homePathFor, useAuth } from './auth/AuthContext.jsx';
import AppShell from './components/AppShell.jsx';
import JobDetailPage from './pages/JobDetailPage.jsx';
import JobsPage from './pages/JobsPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NewJobPage from './pages/NewJobPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';
import RiderHomePage from './pages/RiderHomePage.jsx';
import RidersPage from './pages/RidersPage.jsx';

/** Shows the page only to signed-in users with one of the given roles. */
function RequireRole({ roles, children }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user)} replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={homePathFor(user)} replace /> : <LoginPage />} />

      <Route
        element={
          <RequireRole>
            <AppShell />
          </RequireRole>
        }
      >
        <Route index element={<Navigate to={homePathFor(user)} replace />} />

        <Route path="jobs" element={<RequireRole roles={['DISPATCHER']}><JobsPage /></RequireRole>} />
        <Route path="jobs/new" element={<RequireRole roles={['DISPATCHER']}><NewJobPage /></RequireRole>} />
        <Route path="jobs/:jobRef" element={<RequireRole roles={['DISPATCHER']}><JobDetailPage /></RequireRole>} />
        <Route path="riders" element={<RequireRole roles={['DISPATCHER']}><RidersPage /></RequireRole>} />

        <Route path="me" element={<RequireRole roles={['RIDER']}><RiderHomePage /></RequireRole>} />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
