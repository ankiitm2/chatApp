import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/app/lib/supabase";
import { normalizeHandle } from "@/app/lib/handleRules";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";

  if (!q || q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const cleanQuery = normalizeHandle(q);

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, handle, username, is_member, allow_search, created_at")
        .eq("allow_search", true)
        .or(`handle_normalized.ilike.%${cleanQuery}%,handle.ilike.%${q}%,username.ilike.%${q}%`)
        .limit(10);

      if (error) {
        // Fallback for schemas before allow_search migration
        const { data: fallbackData } = await supabase
          .from("profiles")
          .select("id, handle, username, is_member, created_at")
          .or(`handle_normalized.ilike.%${cleanQuery}%,handle.ilike.%${q}%,username.ilike.%${q}%`)
          .limit(10);

        return NextResponse.json({
          users: (fallbackData || []).map((u) => ({
            id: u.id,
            handle: u.handle || u.username,
            isMember: !!u.is_member,
          })),
        });
      }

      return NextResponse.json({
        users: (data || []).map((u) => ({
          id: u.id,
          handle: u.handle || u.username,
          isMember: !!u.is_member,
        })),
      });
    } catch (err) {
      console.warn("User search exception:", err);
      return NextResponse.json({ users: [] });
    }
  }

  // Fallback demo response if Supabase is offline
  return NextResponse.json({ users: [] });
}
