import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  getActiveUser,
  onLocalAuthStateChange,
  signOutLocal,
  signInLocal,
  signUpLocal,
  type ActiveUser,
} from "@/lib/local-auth";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [localUser, setLocalUser] = useState<ActiveUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cur = getActiveUser();
    setLocalUser(cur);
    if (cur) {
      setLoading(false);
    }

    const unsubLocal = onLocalAuthStateChange((u) => {
      setLocalUser(u);
      setLoading(false);
    });

    try {
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        setSession(s);
        setLoading(false);
      });
      supabase.auth
        .getSession()
        .then(({ data }) => {
          setSession(data?.session ?? null);
          setLoading(false);
        })
        .catch(() => {
          setLoading(false);
        });

      return () => {
        unsubLocal();
        sub.subscription.unsubscribe();
      };
    } catch {
      setLoading(false);
      return unsubLocal;
    }
  }, []);

  const effectiveUser = localUser
    ? ({
        id: localUser.id,
        email: localUser.email,
        user_metadata: { username: localUser.username },
        app_metadata: {},
        aud: "authenticated",
        created_at: new Date().toISOString(),
      } as unknown as User)
    : session?.user ?? null;

  const signOut = async () => {
    signOutLocal();
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  };

  return {
    session,
    user: effectiveUser,
    localUser,
    loading,
    signOut,
    signInLocal,
    signUpLocal,
  };
}
