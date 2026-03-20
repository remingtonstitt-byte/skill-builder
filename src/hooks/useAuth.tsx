import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AuthError, User, Session } from "@supabase/supabase-js";

export type AuthResult = { error: null } | { error: AuthError };

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function normalizeEmail(email: string): string {
  return email.trim();
}

/** Plain Error shaped for our UI; avoids relying on AuthError constructor across bundler versions. */
function authMessage(message: string, code?: string): AuthError {
  const err = new Error(message) as AuthError;
  err.name = "AuthError";
  if (code !== undefined) {
    (err as { code?: string }).code = code;
  }
  return err;
}

const SIGNUP_BLOCKED_MSG =
  "Account exists but sign-in failed. In Supabase: Authentication → Providers → Email → turn OFF “Confirm email”. Then Authentication → Users → delete this email → sign up again on this page.";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const e = normalizeEmail(email);
    const { data, error } = await supabase.auth.signInWithPassword({ email: e, password });
    if (error) return { error };
    if (!data.session) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        return { error: authMessage("Signed in but session missing. Refresh the page.", "no_session") };
      }
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string): Promise<AuthResult> => {
    const e = normalizeEmail(email);

    const { data, error } = await supabase.auth.signUp({
      email: e,
      password,
      options: { emailRedirectTo: `${window.location.origin}/` },
    });

    if (error) {
      const lower = error.message.toLowerCase();
      if (
        lower.includes("already registered") ||
        lower.includes("already been registered") ||
        error.code === "user_already_exists"
      ) {
        return signIn(e, password);
      }
      return { error };
    }

    if (data.session) {
      return { error: null };
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: e,
      password,
    });

    if (!signInError && signInData.session) {
      return { error: null };
    }

    const { data: after } = await supabase.auth.getSession();
    if (after.session) {
      return { error: null };
    }

    if (data.user) {
      return { error: authMessage(SIGNUP_BLOCKED_MSG, "signup_blocked") };
    }

    return { error: signInError ?? authMessage("Could not sign in after sign-up. Check email/password.", "sign_in_failed") };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
