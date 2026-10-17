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
  last_message_at?: string;
  unread_count?: number;
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
  const cleanHandle = friendHandle ? friendHandle.replace(/^@/, "").trim() : undefined;
  if (typeof window !== "undefined") {
    try {
      const prev = localStorage.getItem("qs_friends_list");
      const list: FriendItem[] = prev ? JSON.parse(prev) : [];
      const newItem: FriendItem = {
        id: "fr-" + Date.now(),
        friend_name: friendName,
        friend_gender: friendGender,
        friend_handle: cleanHandle,
        is_member: isMember,
        created_at: new Date().toISOString(),
      };
      const filtered = list.filter((x) => {
        if (cleanHandle && x.friend_handle) {
          return x.friend_handle.toLowerCase() !== cleanHandle.toLowerCase();
        }
        return x.friend_name.toLowerCase() !== friendName.toLowerCase();
      });
      localStorage.setItem("qs_friends_list", JSON.stringify([newItem, ...filtered]));
    } catch {
      // ignore
    }
  }

  if (!supabase) return;

  try {
    let friendProfileId: string | null = null;
    if (cleanHandle) {
      const { data: byHandle } = await supabase
        .from("profiles")
        .select("id")
        .eq("handle_normalized", cleanHandle.toLowerCase())
        .maybeSingle();
      if (byHandle) {
        friendProfileId = byHandle.id;
      }
    }

    if (!friendProfileId) {
      const { data: byName } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", friendName)
        .maybeSingle();
      if (byName) {
        friendProfileId = byName.id;
      } else {
        const { data: newProfile } = await supabase
          .from("profiles")
          .insert([
            {
              username: friendName,
              gender: friendGender,
              handle: cleanHandle || friendName,
              handle_normalized: (cleanHandle || friendName).toLowerCase(),
              is_member: isMember,
            },
          ])
          .select("id")
          .single();
        if (newProfile) friendProfileId = newProfile.id;
      }
    }

    // Only attempt Supabase friendships upsert if userId is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (userId && uuidRegex.test(userId) && friendProfileId) {
      await supabase.from("friendships").upsert([
        {
          user_id: userId,
          friend_id: friendProfileId,
          status: "accepted",
        },
      ]);
    }
  } catch (err) {
    console.warn("Supabase saveFriendship error:", err);
  }
}

// 4. Fetch Friend list (merges local, Supabase friendships, and direct_messages contacts)
export async function fetchFriends(userId: string | null, userHandle?: string): Promise<FriendItem[]> {
  const mergedFriendsMap = new Map<string, FriendItem>();

  // 1. Local storage load
  if (typeof window !== "undefined") {
    try {
      const local = localStorage.getItem("qs_friends_list");
      if (local) {
        const list: FriendItem[] = JSON.parse(local);
        list.forEach((f) => {
          const key = (f.friend_handle || f.friend_name).toLowerCase();
          mergedFriendsMap.set(key, f);
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. Supabase friendships table
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (supabase && userId && uuidRegex.test(userId)) {
    try {
      const { data, error } = await supabase
        .from("friendships")
        .select(`
          id,
          created_at,
          profiles:friend_id (
            username,
            gender,
            handle,
            is_member
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      type FriendshipRecord = {
        id: string;
        created_at: string;
        profiles: { username?: string; gender?: string; handle?: string; is_member?: boolean } | null;
      };

      if (!error && data && data.length > 0) {
        (data as unknown as FriendshipRecord[]).forEach((item) => {
          const name = item.profiles?.username || item.profiles?.handle || "Friend";
          const handle = item.profiles?.handle || undefined;
          const key = (handle || name).toLowerCase();
          mergedFriendsMap.set(key, {
            id: item.id,
            friend_name: name,
            friend_gender: item.profiles?.gender || "other",
            friend_handle: handle,
            is_member: !!item.profiles?.is_member,
            created_at: item.created_at,
          });
        });
      }
    } catch (err) {
      console.warn("Supabase fetchFriends error:", err);
    }
  }

  // 3. Auto-discover contacts from direct_messages if userHandle is provided
  if (supabase && userHandle) {
    try {
      const clean = userHandle.toLowerCase().trim().replace(/^@/, "");
      const { data: dms } = await supabase
        .from("direct_messages")
        .select("sender_handle, receiver_handle, created_at")
        .or(`sender_handle.eq.${clean},receiver_handle.eq.${clean}`)
        .order("created_at", { ascending: false })
        .limit(50);

      if (dms && dms.length > 0) {
        dms.forEach((row: { sender_handle: string; receiver_handle: string; created_at: string }) => {
          const otherHandle = row.sender_handle.toLowerCase() === clean ? row.receiver_handle : row.sender_handle;
          if (otherHandle && otherHandle !== "stranger") {
            const key = otherHandle.toLowerCase();
            if (!mergedFriendsMap.has(key)) {
              mergedFriendsMap.set(key, {
                id: `dm-${key}`,
                friend_name: otherHandle,
                friend_gender: "other",
                friend_handle: otherHandle,
                is_member: true,
                created_at: row.created_at,
              });
            }
          }
        });
      }
    } catch (err) {
      console.warn("Error discovering direct message contacts:", err);
    }
  }

  return Array.from(mergedFriendsMap.values());
}

// 5. Fetch Match History (dynamically ordered by latest message & includes unread counts)
export async function fetchMatchHistory(userId: string | null, userHandle?: string): Promise<MatchHistoryItem[]> {
  const historyMap = new Map<string, MatchHistoryItem>();

  // 1. Load from local storage
  if (typeof window !== "undefined") {
    try {
      const local = localStorage.getItem("qs_match_history");
      if (local) {
        const list: MatchHistoryItem[] = JSON.parse(local);
        list.forEach((item) => {
          const key = (item.partner_handle || item.partner_name).toLowerCase();
          historyMap.set(key, item);
        });
      }
    } catch {}
  }

  // 2. Load from Supabase match_history
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (supabase && userId && uuidRegex.test(userId)) {
    try {
      const { data } = await supabase
        .from("match_history")
        .select("id, partner_name, partner_gender, partner_handle, common_interests, had_video, matched_at")
        .eq("user_id", userId)
        .order("matched_at", { ascending: false })
        .limit(30);

      if (data && data.length > 0) {
        data.forEach((item: any) => {
          const key = (item.partner_handle || item.partner_name).toLowerCase();
          if (!historyMap.has(key)) {
            historyMap.set(key, item as MatchHistoryItem);
          }
        });
      }
    } catch (err) {
      console.warn("Supabase fetchMatchHistory error:", err);
    }
  }

  // 3. Augment with latest message and unread count from direct_messages
  if (supabase && userHandle) {
    try {
      const clean = userHandle.toLowerCase().trim().replace(/^@/, "");
      const { data: dms } = await supabase
        .from("direct_messages")
        .select("id, sender_handle, receiver_handle, text, media_url, message_type, created_at, status")
        .or(`sender_handle.eq.${clean},receiver_handle.eq.${clean}`)
        .order("created_at", { ascending: false })
        .limit(200);

      if (dms && dms.length > 0) {
        const unreadByPartner = new Map<string, number>();
        const latestMsgByPartner = new Map<string, { snippet: string; at: string }>();

        dms.forEach((m: any) => {
          const isSender = m.sender_handle.toLowerCase() === clean;
          const partner = isSender ? m.receiver_handle : m.sender_handle;
          const pKey = partner.toLowerCase();

          // Unread tally for messages sent to me that are not yet read
          if (!isSender && m.status !== "read") {
            unreadByPartner.set(pKey, (unreadByPartner.get(pKey) || 0) + 1);
          }

          if (!latestMsgByPartner.has(pKey)) {
            let snippet = m.text || "";
            if (m.message_type === "image") snippet = "📷 Photo";
            else if (m.message_type === "audio") snippet = "🎙️ Voice message";
            else if (m.message_type === "sticker") snippet = "✨ Sticker";

            latestMsgByPartner.set(pKey, {
              snippet,
              at: m.created_at,
            });
          }
        });

        // Merge latest message snippet, timestamp, and unread counts
        latestMsgByPartner.forEach((info, pKey) => {
          const unread = unreadByPartner.get(pKey) || 0;
          if (historyMap.has(pKey)) {
            const existing = historyMap.get(pKey)!;
            existing.last_message = info.snippet;
            existing.last_message_at = info.at;
            existing.unread_count = unread;
          } else {
            historyMap.set(pKey, {
              id: `conv-${pKey}`,
              partner_name: pKey,
              partner_gender: "other",
              partner_handle: pKey,
              is_member: true,
              common_interests: ["Direct Chat"],
              had_video: false,
              matched_at: info.at,
              last_message: info.snippet,
              last_message_at: info.at,
              unread_count: unread,
            });
          }
        });
      }
    } catch (err) {
      console.warn("Error augmenting match history with messages:", err);
    }
  }

  // Sort strictly by latest message date or matched date descending
  return Array.from(historyMap.values()).sort((a, b) => {
    const timeA = new Date(a.last_message_at || a.matched_at).getTime();
    const timeB = new Date(b.last_message_at || b.matched_at).getTime();
    return timeB - timeA;
  });
}

export interface DirectMessageRecord {
  id: string;
  conversation_key: string;
  sender_handle: string;
  receiver_handle: string;
  message_type: "text" | "image" | "audio" | "sticker";
  status?: "sent" | "delivered" | "read";
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
  id?: string;
  senderHandle: string;
  receiverHandle: string;
  senderId?: string | null;
  receiverId?: string | null;
  messageType?: "text" | "image" | "audio" | "sticker";
  status?: "sent" | "delivered" | "read";
  text?: string;
  mediaUrl?: string;
}) {
  const { id, senderHandle, receiverHandle, senderId, receiverId, messageType = "text", status = "sent", text, mediaUrl } = params;
  if (!senderHandle || !receiverHandle) return;

  const conversationKey = getConversationKey(senderHandle, receiverHandle);
  const now = new Date().toISOString();
  const messageId = id || "msg-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);

  // 1. Cache locally
  if (typeof window !== "undefined") {
    try {
      const storageKey = `qs_chat_${conversationKey}`;
      const prev = localStorage.getItem(storageKey);
      const list: DirectMessageRecord[] = prev ? JSON.parse(prev) : [];
      list.push({
        id: messageId,
        conversation_key: conversationKey,
        sender_handle: senderHandle.replace(/^@/, ""),
        receiver_handle: receiverHandle.replace(/^@/, ""),
        message_type: messageType,
        status,
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
          id: messageId.startsWith("msg-") ? undefined : messageId,
          conversation_key: conversationKey,
          sender_handle: senderHandle.replace(/^@/, ""),
          receiver_handle: receiverHandle.replace(/^@/, ""),
          sender_id: senderId || null,
          receiver_id: receiverId || null,
          message_type: messageType,
          status,
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
 * Marks messages as read in Supabase and local cache.
 */
export async function markDirectMessagesAsRead(myHandle: string, partnerHandle: string) {
  if (!myHandle || !partnerHandle) return;
  const cleanMy = myHandle.trim().toLowerCase().replace(/^@/, "");
  const cleanPartner = partnerHandle.trim().toLowerCase().replace(/^@/, "");
  const conversationKey = getConversationKey(cleanMy, cleanPartner);

  if (typeof window !== "undefined") {
    try {
      const storageKey = `qs_chat_${conversationKey}`;
      const local = localStorage.getItem(storageKey);
      if (local) {
        const list: DirectMessageRecord[] = JSON.parse(local);
        let changed = false;
        list.forEach((m) => {
          if (m.receiver_handle.toLowerCase() === cleanMy && m.status !== "read") {
            m.status = "read";
            changed = true;
          }
        });
        if (changed) localStorage.setItem(storageKey, JSON.stringify(list));
      }
    } catch {}
  }

  if (supabase) {
    try {
      await supabase
        .from("direct_messages")
        .update({ status: "read" })
        .eq("conversation_key", conversationKey)
        .eq("receiver_handle", cleanMy)
        .neq("status", "read");
    } catch (err) {
      console.warn("Error marking messages as read in Supabase:", err);
    }
  }
}

/**
 * Updates status of a specific message in local storage and Supabase.
 */
export async function updateDirectMessageStatus(
  myHandle: string,
  partnerHandle: string,
  messageId: string,
  status: "delivered" | "read"
) {
  const conversationKey = getConversationKey(myHandle, partnerHandle);

  if (typeof window !== "undefined") {
    try {
      const storageKey = `qs_chat_${conversationKey}`;
      const local = localStorage.getItem(storageKey);
      if (local) {
        const list: DirectMessageRecord[] = JSON.parse(local);
        const target = list.find((m) => m.id === messageId);
        if (target) {
          target.status = status;
          localStorage.setItem(storageKey, JSON.stringify(list));
        }
      }
    } catch {}
  }

  if (supabase && !messageId.startsWith("msg-")) {
    try {
      await supabase
        .from("direct_messages")
        .update({ status })
        .eq("id", messageId);
    } catch (err) {
      console.warn("Error updating direct message status in Supabase:", err);
    }
  }
}

/**
 * Fetches the complete message history between two handles.
 */
export async function fetchDirectChatHistory(myHandle: string, partnerHandle: string): Promise<{
  id: string;
  mine: boolean;
  type?: "text" | "image" | "audio" | "sticker";
  status?: "sent" | "delivered" | "read";
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
            id: d.id,
            mine: d.sender_handle.toLowerCase() === cleanMyHandle,
            type: d.message_type || "text",
            status: d.status || "read",
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
            id: d.id,
            mine: d.sender_handle.toLowerCase() === cleanMyHandle,
            type: d.message_type || "text",
            status: d.status || "delivered",
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
