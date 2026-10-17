import { supabase } from "./supabase";

export interface UserProfile {
  id: string;
  username: string;
  gender: "male" | "female" | "other";
  interests: string[];
}

export interface MatchHistoryItem {
  id: string;
  partner_name: string;
  partner_gender: string;
  common_interests: string[];
  had_video: boolean;
  matched_at: string;
  last_message?: string;
}

export interface FriendItem {
  id: string;
  friend_name: string;
  friend_gender: string;
  created_at: string;
}

// 1. Get or Create user profile in Supabase
export async function getOrCreateUserProfile(
  username: string,
  gender: "male" | "female" | "other",
  interests: string[]
): Promise<string | null> {
  if (!supabase) return null;

  try {
    const savedId = typeof window !== "undefined" ? localStorage.getItem("neonchat_user_id") : null;

    if (savedId) {
      // Update existing profile
      const { data, error } = await supabase
        .from("profiles")
        .update({ username, gender, interests, updated_at: new Date().toISOString() })
        .eq("id", savedId)
        .select("id")
        .single();

      if (!error && data) return data.id;
    }

    // Insert new profile
    const { data, error } = await supabase
      .from("profiles")
      .insert([{ username, gender, interests }])
      .select("id")
      .single();

    if (!error && data) {
      if (typeof window !== "undefined") {
        localStorage.setItem("neonchat_user_id", data.id);
      }
      return data.id;
    }
  } catch (err) {
    console.warn("Supabase profile error:", err);
  }

  return null;
}

// 2. Record Match in match_history
export async function recordMatchHistory(
  userId: string | null,
  partnerName: string,
  partnerGender: string,
  commonInterests: string[],
  hadVideo = false
) {
  if (typeof window !== "undefined") {
    try {
      const prev = localStorage.getItem("qs_match_history");
      const list: MatchHistoryItem[] = prev ? JSON.parse(prev) : [...DEFAULT_SAMPLE_HISTORY];
      const newItem: MatchHistoryItem = {
        id: "hist-" + Date.now(),
        partner_name: partnerName,
        partner_gender: partnerGender,
        common_interests: commonInterests,
        had_video: hadVideo,
        matched_at: new Date().toISOString(),
        last_message: "Chat session started",
      };
      localStorage.setItem("qs_match_history", JSON.stringify([newItem, ...list.filter(x => x.partner_name !== partnerName)]));
    } catch {
      // ignore
    }
  }

  if (!supabase || !userId) return;

  try {
    await supabase.from("match_history").insert([
      {
        user_id: userId,
        partner_name: partnerName,
        partner_gender: partnerGender,
        common_interests: commonInterests,
        had_video: hadVideo,
      },
    ]);
  } catch (err) {
    console.warn("Supabase recordMatchHistory error:", err);
  }
}

// 3. Save Friendship in Supabase
export async function saveFriendship(
  userId: string | null,
  friendName: string,
  friendGender: string
) {
  if (typeof window !== "undefined") {
    try {
      const prev = localStorage.getItem("qs_friends_list");
      const list: FriendItem[] = prev ? JSON.parse(prev) : [...DEFAULT_SAMPLE_FRIENDS];
      const newItem: FriendItem = {
        id: "fr-" + Date.now(),
        friend_name: friendName,
        friend_gender: friendGender,
        created_at: new Date().toISOString(),
      };
      localStorage.setItem("qs_friends_list", JSON.stringify([newItem, ...list.filter(x => x.friend_name !== friendName)]));
    } catch {
      // ignore
    }
  }

  if (!supabase || !userId) return;

  try {
    // Look up or insert friend profile
    let { data: friendProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", friendName)
      .maybeSingle();

    if (!friendProfile) {
      const { data: newProfile } = await supabase
        .from("profiles")
        .insert([{ username: friendName, gender: friendGender }])
        .select("id")
        .single();
      friendProfile = newProfile;
    }

    if (friendProfile) {
      await supabase.from("friendships").upsert([
        {
          user_id: userId,
          friend_id: friendProfile.id,
          status: "accepted",
        },
      ]);
    }
  } catch (err) {
    console.warn("Supabase saveFriendship error:", err);
  }
}

// Default seeds inspired by the design (River, Atlas, Sunny)
const DEFAULT_SAMPLE_HISTORY: MatchHistoryItem[] = [
  {
    id: "hist-1",
    partner_name: "River",
    partner_gender: "female",
    common_interests: ["Music"],
    had_video: true,
    matched_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    last_message: "That sounds perfect. Send me your first three picks?",
  },
  {
    id: "hist-2",
    partner_name: "Atlas",
    partner_gender: "male",
    common_interests: ["Travel"],
    had_video: false,
    matched_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    last_message: "Thanks for the travel tips! I'll look into Lisbon.",
  },
  {
    id: "hist-3",
    partner_name: "Sunny",
    partner_gender: "female",
    common_interests: ["Books"],
    had_video: false,
    matched_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    last_message: "That book is on my list too. Let me know what you think.",
  },
];

const DEFAULT_SAMPLE_FRIENDS: FriendItem[] = [
  {
    id: "fr-1",
    friend_name: "River",
    friend_gender: "female",
    created_at: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
  },
  {
    id: "fr-2",
    friend_name: "Atlas",
    friend_gender: "male",
    created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: "fr-3",
    friend_name: "Sunny",
    friend_gender: "female",
    created_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

// 4. Fetch Friend list
export async function fetchFriends(userId: string | null): Promise<FriendItem[]> {
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from("friendships")
        .select(`
          id,
          created_at,
          profiles:friend_id (
            username,
            gender
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      type FriendshipRecord = {
        id: string;
        created_at: string;
        profiles: { username?: string; gender?: string } | null;
      };

      if (!error && data && data.length > 0) {
        return (data as unknown as FriendshipRecord[]).map((item) => ({
          id: item.id,
          friend_name: item.profiles?.username || "Friend",
          friend_gender: item.profiles?.gender || "other",
          created_at: item.created_at,
        }));
      }
    } catch (err) {
      console.warn("Supabase fetchFriends error:", err);
    }
  }

  // Local storage fallback
  if (typeof window !== "undefined") {
    try {
      const local = localStorage.getItem("qs_friends_list");
      if (local) {
        return JSON.parse(local);
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_SAMPLE_FRIENDS;
}

// 5. Fetch Match History
export async function fetchMatchHistory(userId: string | null): Promise<MatchHistoryItem[]> {
  if (supabase && userId) {
    try {
      const { data, error } = await supabase
        .from("match_history")
        .select("id, partner_name, partner_gender, common_interests, had_video, matched_at")
        .eq("user_id", userId)
        .order("matched_at", { ascending: false })
        .limit(20);

      if (!error && data && data.length > 0) {
        return data as MatchHistoryItem[];
      }
    } catch (err) {
      console.warn("Supabase fetchMatchHistory error:", err);
    }
  }

  // Local storage fallback
  if (typeof window !== "undefined") {
    try {
      const local = localStorage.getItem("qs_match_history");
      if (local) {
        return JSON.parse(local);
      }
    } catch {
      // ignore
    }
  }

  return DEFAULT_SAMPLE_HISTORY;
}
