import { useEffect, type ReactNode } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import MainNavigation from "@/components/MainNavigation";
import Navigation from "@/components/Navigation";
import GlobalAIActivity from "@/components/GlobalAIActivity";
import BubbleSpace from "@/pages/BubbleSpace";
import ContextManager from "@/pages/ContextManager";
import PrdOutput from "@/pages/PrdOutput";
import CreativeWorkshop from "@/pages/CreativeWorkshop";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import Admin from "@/pages/Admin";
import { useWorkspacePersistence } from "@/hooks/useWorkspacePersistence";
import { useAuthStore } from "@/stores/authStore";

// 登录守卫：未登录跳转 /login
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuthStore();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[13px] text-on-surface-variant">
        正在验证登录…
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const fetchMe = useAuthStore((state) => state.fetchMe);

  useEffect(() => {
    void fetchMe();
  }, [fetchMe]);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        />
      </Routes>
    </Router>
  );
}

function AppShell() {
  useWorkspacePersistence();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="flex min-h-screen">
      <MainNavigation />
      <Navigation />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<BubbleSpace />} />
          <Route path="/context" element={<ContextManager />} />
          <Route path="/prd" element={<PrdOutput />} />
          <Route path="/workshop" element={<CreativeWorkshop />} />
          <Route path="/settings" element={<Settings />} />
          {user?.role === "admin" && <Route path="/admin" element={<Admin />} />}
        </Routes>
      </main>
      <GlobalAIActivity />
    </div>
  );
}
