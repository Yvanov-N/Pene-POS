import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { GlobalLogin } from "@/components/auth/GlobalLogin";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { AppShell } from "@/components/layout/AppShell";
import { ReceiptPage } from "@/pages/ReceiptPage";
import { VersionGate } from "@/components/pwa/VersionGate";
import { ToastProvider } from "@/hooks/useToast";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
    });

    return () => authListener.subscription.unsubscribe();
  }, []);

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {/* Public: works for a signed-out visitor with no local data at
              all, via the get_public_receipt RPC (migration 6) -- must never
              sit behind the auth gate below. */}
          <Route path="/receipt/:saleId" element={<ReceiptPage />} />
          <Route
            path="/*"
            element={
              checkingSession ? null : passwordRecovery ? (
                <ResetPasswordForm onComplete={() => setPasswordRecovery(false)} />
              ) : session ? (
                <AppShell />
              ) : (
                <GlobalLogin />
              )
            }
          />
        </Routes>
      </BrowserRouter>
      <VersionGate />
    </ToastProvider>
  );
}

export default App;
