import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { BottomNav } from "@/components/layout/BottomNav";
import HomeDashboard from "./pages/HomeDashboard";
import SafeBrowser from "./pages/SafeBrowser";
import Partners from "./pages/Partners";
import Growth from "./pages/Growth";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import NotFound from "./pages/NotFound";
import AdminLabels from "./pages/AdminLabels";
import ChallengesScreen from "./pages/ChallengesScreen";
import ShareCardPreview from "./pages/ShareCardPreview";
import PartnerRequestsScreen from "./pages/PartnerRequestsScreen";
import DefenseRoom from "./pages/DefenseRoom";

const queryClient = new QueryClient();

const AppRoutes = () => {
  const location = useLocation();
  const hideBottomNav = location.pathname === "/defense";

  return (
    <div className="min-h-screen bg-background">
      <Routes>
        <Route path="/" element={<HomeDashboard />} />
        <Route path="/browser" element={<SafeBrowser />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/partner-requests" element={<PartnerRequestsScreen />} />
        <Route path="/growth" element={<Growth />} />
        <Route path="/challenges" element={<ChallengesScreen />} />
        <Route path="/share-card" element={<ShareCardPreview />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/logs" element={<Logs />} />
        <Route path="/admin/labels" element={<AdminLabels />} />
        <Route path="/defense" element={<DefenseRoom />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {!hideBottomNav && <BottomNav />}
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
