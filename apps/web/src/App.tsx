import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { GlobalLogin } from "@/components/auth/GlobalLogin";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { PosLayout } from "@/components/pos/PosLayout";
import { VersionGate } from "@/components/pwa/VersionGate";

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
    <>
      {checkingSession ? null : passwordRecovery ? (
        <ResetPasswordForm onComplete={() => setPasswordRecovery(false)} />
      ) : session ? (
        <PosLayout />
      ) : (
        <GlobalLogin />
      )}
      <VersionGate />
    </>
  );
}

export default App;
