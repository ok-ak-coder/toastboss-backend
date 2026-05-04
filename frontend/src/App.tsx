import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AccountSetupPage from './pages/AccountSetup';
import AgendaEditorPage from './pages/AgendaEditor';
import AttendanceVerifierPage from './pages/AttendanceVerifier';
import ClubSetupPage from './pages/ClubSetup';
import DashboardPage from './pages/Dashboard';
import ForClubsPage from './pages/ForClubs';
import LoginPage from './pages/Login';
import RosterManagerPage from './pages/RosterManager';
import type { UserSession } from './types';

const SESSION_STORAGE_KEY = 'toastboss-user-session';
const PENDING_ACCOUNT_STORAGE_KEY = 'toastboss-pending-account';

function App() {
  const [userSession, setUserSession] = useState<UserSession | null>(() => {
    const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!stored) {
      return null;
    }

    try {
      return JSON.parse(stored) as UserSession;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (userSession) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(userSession));
      return;
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [userSession]);

  const handleLogout = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.sessionStorage.removeItem(PENDING_ACCOUNT_STORAGE_KEY);
    setUserSession(null);
  };

  return (
    <div className="toastboss-shell">
      <header className="toastboss-header">
        <div className="toastboss-header-inner">
          <div className="toastboss-brand">
            <span className="toastboss-logo">TB</span>
            <div>
              <h1>ToastBoss</h1>
              <p>Club schedule planning, powered by EquiToast Engine.</p>
            </div>
          </div>
          {userSession && (
            <button className="toastboss-header-action" onClick={handleLogout} type="button">
              Log out
            </button>
          )}
        </div>
      </header>
      <main className="toastboss-main">
        <Routes>
          <Route
            path="/"
            element={userSession ? <Navigate to="/dashboard" /> : <Navigate to="/login" />}
          />
          <Route path="/login" element={<LoginPage onLogin={setUserSession} />} />
          <Route path="/for-clubs" element={<ForClubsPage />} />
          <Route path="/setup-club" element={<ClubSetupPage onLogin={setUserSession} />} />
          <Route path="/activate-account" element={<AccountSetupPage onLogin={setUserSession} />} />
          <Route
            path="/dashboard"
            element={userSession ? <DashboardPage user={userSession} /> : <Navigate to="/login" />}
          />
          <Route
            path="/clubs/:clubId/roster"
            element={userSession ? <RosterManagerPage user={userSession} /> : <Navigate to="/login" />}
          />
          <Route
            path="/clubs/:clubId/agenda"
            element={userSession ? <AgendaEditorPage user={userSession} /> : <Navigate to="/login" />}
          />
          <Route
            path="/clubs/:clubId/attendance"
            element={userSession ? <AttendanceVerifierPage user={userSession} /> : <Navigate to="/login" />}
          />
        </Routes>
      </main>
    </div>
  );
}

export default App;
