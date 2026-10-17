import { supabase } from "./supabase";

export interface AuthMember {
  id: string;
  email: string;
  handle: string;
  isMember: boolean;
  avatarSeed?: string;
  lastRenamedAt?: string;
}

const STORAGE_KEY = "qs_auth_member";

export function getStoredMember(): AuthMember | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveStoredMember(member: AuthMember): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(member));
  } catch (err) {
    console.warn("Error saving member locally:", err);
  }
}

export function clearStoredMember(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Initiates an email magic link or one-time code authentication.
 */
export async function sendMagicLinkOrCode(email: string): Promise<{ success: boolean; message: string; simulated?: boolean }> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, message: "Please enter a valid email address." };
  }

  if (supabase) {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });

      if (error) {
        return { success: false, message: error.message };
      }
      return { success: true, message: "A secure sign-in link has been sent to your email." };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send magic link";
      return { success: false, message: msg };
    }
  }

  // Simulated fallback when Supabase keys are not set in environment
  return {
    success: true,
    message: "Demo mode: Use code 778899 to sign in without an external email provider.",
    simulated: true,
  };
}

/**
 * Verifies email OTP token.
 */
export async function verifyEmailCode(
  email: string,
  token: string
): Promise<{ success: boolean; member?: AuthMember; error?: string }> {
  const cleanEmail = email.trim().toLowerCase();
  const cleanToken = token.trim();

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: cleanToken,
        type: "email",
      });

      if (error || !data.user) {
        return { success: false, error: error?.message || "Invalid or expired code" };
      }

      // Check if user already has a claimed handle in profiles
      const { data: profile } = await supabase
        .from("profiles")
        .select("id, handle, is_member, last_renamed_at")
        .eq("id", data.user.id)
        .maybeSingle();

      const member: AuthMember = {
        id: data.user.id,
        email: cleanEmail,
        handle: profile?.handle || "",
        isMember: true,
        lastRenamedAt: profile?.last_renamed_at,
      };

      saveStoredMember(member);
      return { success: true, member };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Verification failed";
      return { success: false, error: msg };
    }
  }

  // Simulated fallback
  if (cleanToken === "778899" || cleanToken.length === 6) {
    const existing = getStoredMember();
    const handleSeed = cleanEmail.split("@")[0].replace(/[^a-z0-9]/gi, "").toLowerCase() || "member";
    const member: AuthMember = {
      id: existing?.id || "usr_" + Math.random().toString(36).substring(2, 9),
      email: cleanEmail,
      handle: existing?.handle || `${handleSeed}_${Math.floor(10 + Math.random() * 89)}`,
      isMember: true,
      lastRenamedAt: existing?.lastRenamedAt,
    };
    saveStoredMember(member);
    return { success: true, member };
  }

  return { success: false, error: "Incorrect verification code. Please check your inbox or use 778899 in demo." };
}

/**
 * Sign in via OAuth (Google or Apple).
 */
export async function signInOAuth(provider: "google" | "apple"): Promise<{ success: boolean; error?: string }> {
  if (supabase) {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
        },
      });
      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OAuth sign in failed";
      return { success: false, error: msg };
    }
  }

  // Simulated fallback for immediate local testing
  const mockEmail = `user.${provider}@quietsignal.app`;
  const member: AuthMember = {
    id: "usr_oauth_" + Math.random().toString(36).substring(2, 9),
    email: mockEmail,
    handle: `${provider}_user_${Math.floor(10 + Math.random() * 89)}`,
    isMember: true,
  };
  saveStoredMember(member);
  if (typeof window !== "undefined") {
    window.location.reload();
  }
  return { success: true };
}

/**
 * Log out current member.
 */
export async function logoutMember(): Promise<void> {
  clearStoredMember();
  if (supabase) {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
  }
}
