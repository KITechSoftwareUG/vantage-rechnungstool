import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Outlet, useLocation } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "./hooks/useAuth";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { MainLayout } from "./components/layout/MainLayout";
import Index from "./pages/Index";
import Hub from "./pages/Hub";
import UploadPage from "./pages/UploadPage";
import InvoicesPage from "./pages/InvoicesPage";
import StatementsPage from "./pages/StatementsPage";
import MatchingPage from "./pages/MatchingPage";
import ExportPage from "./pages/ExportPage";
import FunnelIndex from "./pages/FunnelIndex";
import InboxPage from "./pages/InboxPage";
import LeadDetail from "./pages/LeadDetail";
import ConfigPage from "./pages/ConfigPage";
import StatusPage from "./pages/StatusPage";
import AuthPage from "./pages/AuthPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();
const routerBase = import.meta.env.BASE_URL || "/";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <MainLayout>
        <Outlet />
      </MainLayout>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter basename={routerBase}>
            <ScrollToTop />
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route
                path="/"
                element={
                  <ProtectedRoute>
                    <Hub />
                  </ProtectedRoute>
                }
              />
              <Route element={<ProtectedLayout />}>
                <Route path="/dashboard" element={<Index />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/invoices" element={<InvoicesPage />} />
                <Route path="/statements" element={<StatementsPage />} />
                <Route path="/matching" element={<MatchingPage />} />
                <Route path="/export" element={<ExportPage />} />
                <Route path="/funnel" element={<FunnelIndex />} />
                <Route path="/funnel/inbox" element={<InboxPage />} />
                <Route path="/funnel/:leadId" element={<LeadDetail />} />
                <Route path="/config" element={<ConfigPage />} />
                <Route path="/status" element={<StatusPage />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
