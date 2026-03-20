import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AuthError, User, Session } from "@supabase/supabase-js";

export type AuthResult = { error: null } | { error: AuthError };

const GUEST_SESSION_KEY = "skill-builder-guest";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isGuest: boolean;
  enterAsGuest: () => void;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (email: string, password: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readGuestFlag(): boolean {
  try {
    return sessionStorage.getItem(GUEST_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function setGuestFlag(on: boolean) {
  try {
    if (on) sessionStorage.setItem(GUEST_SESSION_KEY, "1");
    else sessionStorage.removeItem(GUEST_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

function normalizeEmail(email: string): string {
  return email.trim();
}

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
  const [isGuest, setIsGuest] = useState(readGuestFlag);

  const clearGuestMode = useCallback(() => {
    setGuestFlag(false);
    setIsGuest(false);
  }, []);

  const enterAsGuest = () => {
    setGuestFlag(true);
    setIsGuest(true);
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          clearGuestMode();
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        clearGuestMode();
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [clearGuestMode]);

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
    clearGuestMode();
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
      clearGuestMode();
      return { error: null };
    }

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: e,
      password,
    });

    if (!signInError && signInData.session) {
      clearGuestMode();
      return { error: null };
    }

    const { data: after } = await supabase.auth.getSession();
    if (after.session) {
      clearGuestMode();
      return { error: null };
    }

    if (data.user) {
      return { error: authMessage(SIGNUP_BLOCKED_MSG, "signup_blocked") };
    }

    return { error: signInError ?? authMessage("Could not sign in after sign-up. Check email/password.", "sign_in_failed") };
  };

  const signOut = async () => {
    clearGuestMode();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ user, session, loading, isGuest, enterAsGuest, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
