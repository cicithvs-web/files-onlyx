import { type ReactNode } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Spinner } from './components/ui';
import AppLayout from './components/AppLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Repos from './pages/Repos';
import Explorer from './pages/Explorer';
import Editor from './pages/Editor';
import Favorites from './pages/Favorites';
import Shares from './pages/Shares';
import Trash from './pages/Trash';
import Storage from './pages/Storage';
import ActivityPage from './pages/ActivityPage';
import Settings from './pages/Settings';
import AdminUsers from './pages/AdminUsers';
import SharePublic from './pages/SharePublic';
import NotFound from './pages/NotFound';

function Protected({ children, fullBleed, adminOnly }: { children: ReactNode; fullBleed?: boolean; adminOnly?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-wrap">
        <div className="aurora-bg" />
        <Spinner size={34} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (adminOnly && user.role !== 'super_admin') return <Navigate to="/app" replace />;
  return <AppLayout fullBleed={fullBleed}>{children}</AppLayout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/s/:token" element={<SharePublic />} />

      <Route path="/app" element={<Protected><Dashboard /></Protected>} />
      <Route path="/app/repos" element={<Protected><Repos /></Protected>} />
      <Route path="/app/repos/:repoId" element={<Protected fullBleed><Explorer /></Protected>} />
      <Route path="/app/repos/:repoId/edit/:nodeId" element={<Protected fullBleed><Editor /></Protected>} />
      <Route path="/app/favorites" element={<Protected><Favorites /></Protected>} />
      <Route path="/app/shares" element={<Protected><Shares /></Protected>} />
      <Route path="/app/trash" element={<Protected><Trash /></Protected>} />
      <Route path="/app/storage" element={<Protected><Storage /></Protected>} />
      <Route path="/app/activity" element={<Protected><ActivityPage /></Protected>} />
      <Route path="/app/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/app/users" element={<Protected adminOnly><AdminUsers /></Protected>} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
