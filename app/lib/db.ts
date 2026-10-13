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

// 4. Fetch Friend list
export async function fetchFriends(userId: string | null): Promise<FriendItem[]> {
  if (!supabase || !userId) return [];

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

    return (data as unknown as FriendshipRecord[]).map((item) => ({
      id: item.id,
      friend_name: item.profiles?.username || "Friend",
      friend_gender: item.profiles?.gender || "other",
      created_at: item.created_at,
    }));
  } catch (err) {
    console.warn("Supabase fetchFriends error:", err);
    return [];
  }
}

// 5. Fetch Match History
export async function fetchMatchHistory(userId: string | null): Promise<MatchHistoryItem[]> {
  if (!supabase || !userId) return [];

  try {
    const { data, error } = await supabase
      .from("match_history")
      .select("id, partner_name, partner_gender, common_interests, had_video, matched_at")
      .eq("user_id", userId)
      .order("matched_at", { ascending: false })
      .limit(20);

    if (error || !data) return [];

    return data as MatchHistoryItem[];
  } catch (err) {
    console.warn("Supabase fetchMatchHistory error:", err);
    return [];
  }
}
