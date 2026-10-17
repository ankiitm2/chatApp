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
  partner_handle?: string;
  is_member?: boolean;
  common_interests: string[];
  had_video: boolean;
  matched_at: string;
  last_message?: string;
}

export interface FriendItem {
  id: string;
  friend_name: string;
  friend_gender: string;
  friend_handle?: string;
  is_member?: boolean;
  created_at: string;
}

// 1. Get or Create user profile in Supabase
export async function getOrCreateUserProfile(
  username: string,
  gender: "male" | "female" | "other",
  interests: string[],
  handle?: string,
  isMember = false
): Promise<string | null> {
  if (!supabase) return null;

  try {
    const savedId = typeof window !== "undefined" ? localStorage.getItem("neonchat_user_id") : null;

    if (savedId) {
      // Update existing profile
      const { data, error } = await supabase
        .from("profiles")
        .update({
          username,
          gender,
          interests,
          ...(handle ? { handle, handle_normalized: handle.toLowerCase(), is_member: isMember } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", savedId)
        .select("id")
        .single();

      if (!error && data) return data.id;
    }

    // Insert new profile
    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          username,
          gender,
          interests,
          ...(handle ? { handle, handle_normalized: handle.toLowerCase(), is_member: isMember } : {}),
        },
      ])
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
  hadVideo = false,
  partnerHandle?: string,
  isMember = false
) {
  if (typeof window !== "undefined") {
    try {
      const prev = localStorage.getItem("qs_match_history");
      const list: MatchHistoryItem[] = prev ? JSON.parse(prev) : [];
      const newItem: MatchHistoryItem = {
        id: "hist-" + Date.now(),
        partner_name: partnerName,
        partner_gender: partnerGender,
        partner_handle: partnerHandle,
        is_member: isMember,
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
        partner_handle: partnerHandle,
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
  friendGender: string,
  friendHandle?: string,
  isMember = false
) {
  if (typeof window !== "undefined") {
    try {
      const prev = localStorage.getItem("qs_friends_list");
      const list: FriendItem[] = prev ? JSON.parse(prev) : [];
      const newItem: FriendItem = {
        id: "fr-" + Date.now(),
        friend_name: friendName,
        friend_gender: friendGender,
        friend_handle: friendHandle,
        is_member: isMember,
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

  return [];
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

  return [];
}

export interface DirectMessageRecord {
  id: string;
  conversation_key: string;
  sender_handle: string;
  receiver_handle: string;
  message_type: "text" | "image" | "audio";
  text?: string;
  media_url?: string;
  created_at: string;
}

/**
 * Generates a normalized, alphabetical conversation key for a pair of handles.
 */
export function getConversationKey(h1: string, h2: string): string {
  const norm1 = String(h1 || "").trim().toLowerCase().replace(/^@/, "");
  const norm2 = String(h2 || "").trim().toLowerCase().replace(/^@/, "");
  return [norm1, norm2].sort().join(":");
}

/**
 * Saves a direct chat message to Supabase and local cache.
 */
export async function saveDirectMessage(params: {
  senderHandle: string;
  receiverHandle: string;
  senderId?: string | null;
  receiverId?: string | null;
  messageType?: "text" | "image" | "audio";
  text?: string;
  mediaUrl?: string;
}) {
  const { senderHandle, receiverHandle, senderId, receiverId, messageType = "text", text, mediaUrl } = params;
  if (!senderHandle || !receiverHandle) return;

  const conversationKey = getConversationKey(senderHandle, receiverHandle);
  const now = new Date().toISOString();

  // 1. Cache locally
  if (typeof window !== "undefined") {
    try {
      const storageKey = `qs_chat_${conversationKey}`;
      const prev = localStorage.getItem(storageKey);
      const list: DirectMessageRecord[] = prev ? JSON.parse(prev) : [];
      list.push({
        id: "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        conversation_key: conversationKey,
        sender_handle: senderHandle.replace(/^@/, ""),
        receiver_handle: receiverHandle.replace(/^@/, ""),
        message_type: messageType,
        text,
        media_url: mediaUrl,
        created_at: now,
      });
      localStorage.setItem(storageKey, JSON.stringify(list.slice(-100)));
    } catch {
      // ignore
    }
  }

  // 2. Persist to Supabase
  if (supabase) {
    try {
      await supabase.from("direct_messages").insert([
        {
          conversation_key: conversationKey,
          sender_handle: senderHandle.replace(/^@/, ""),
          receiver_handle: receiverHandle.replace(/^@/, ""),
          sender_id: senderId || null,
          receiver_id: receiverId || null,
          message_type: messageType,
          text: text || null,
          media_url: mediaUrl || null,
        },
      ]);
    } catch (err) {
      console.warn("Error saving direct message:", err);
    }
  }
}

/**
 * Fetches the complete message history between two handles.
 */
export async function fetchDirectChatHistory(myHandle: string, partnerHandle: string): Promise<{
  mine: boolean;
  type?: "text" | "image" | "audio";
  text: string;
  mediaUrl?: string;
  time: string;
}[]> {
  const conversationKey = getConversationKey(myHandle, partnerHandle);
  const cleanMyHandle = myHandle.trim().toLowerCase().replace(/^@/, "");

  // 1. Fetch from Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("conversation_key", conversationKey)
        .order("created_at", { ascending: true })
        .limit(100);

      if (!error && data && data.length > 0) {
        return data.map((d: DirectMessageRecord) => {
          const dTime = new Date(d.created_at);
          const timeStr = `${dTime.getHours().toString().padStart(2, "0")}:${dTime.getMinutes().toString().padStart(2, "0")}`;
          return {
            mine: d.sender_handle.toLowerCase() === cleanMyHandle,
            type: d.message_type || "text",
            text: d.text || "",
            mediaUrl: d.media_url,
            time: timeStr,
          };
        });
      }
    } catch (err) {
      console.warn("Error fetching direct messages:", err);
    }
  }

  // 2. Fallback to local storage
  if (typeof window !== "undefined") {
    try {
      const storageKey = `qs_chat_${conversationKey}`;
      const local = localStorage.getItem(storageKey);
      if (local) {
        const list: DirectMessageRecord[] = JSON.parse(local);
        return list.map((d) => {
          const dTime = new Date(d.created_at);
          const timeStr = `${dTime.getHours().toString().padStart(2, "0")}:${dTime.getMinutes().toString().padStart(2, "0")}`;
          return {
            mine: d.sender_handle.toLowerCase() === cleanMyHandle,
            type: d.message_type || "text",
            text: d.text || "",
            mediaUrl: d.media_url,
            time: timeStr,
          };
        });
      }
    } catch {
      // ignore
    }
  }

  return [];
}
