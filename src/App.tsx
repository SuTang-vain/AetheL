import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import MainNavigation from "@/components/MainNavigation";
import Navigation from "@/components/Navigation";
import GlobalAIActivity from "@/components/GlobalAIActivity";
import BubbleSpace from "@/pages/BubbleSpace";
import ContextManager from "@/pages/ContextManager";
import PrdOutput from "@/pages/PrdOutput";
import CreativeWorkshop from "@/pages/CreativeWorkshop";
import Settings from "@/pages/Settings";
import { useWorkspacePersistence } from "@/hooks/useWorkspacePersistence";

export default function App() {
  useWorkspacePersistence();

  return (
    <Router basename={__AETHEL_BASE_PATH__ || '/'}>
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
          </Routes>
        </main>
        <GlobalAIActivity />
      </div>
    </Router>
  );
}
