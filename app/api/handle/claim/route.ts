import { NextRequest, NextResponse } from "next/server";
import { validateHandle } from "@/app/lib/handleRules";
import { supabase } from "@/app/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { handle, userId, email } = body;

    const validation = validateHandle(handle);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
    }

    if (supabase) {
      // 1. Check if handle_normalized is already taken by someone else
      const { data: existing } = await supabase
        .from("profiles")
        .select("id, handle_normalized")
        .eq("handle_normalized", validation.normalized)
        .maybeSingle();

      if (existing && existing.id !== userId) {
        return NextResponse.json(
          { success: false, error: "This handle is already taken by another member" },
          { status: 409 }
        );
      }

      // 2. Check 30-day renaming rule if this is an existing profile with an existing handle
      if (userId) {
        const { data: currentProfile } = await supabase
          .from("profiles")
          .select("last_renamed_at, handle")
          .eq("id", userId)
          .maybeSingle();

        if (currentProfile?.handle && currentProfile.last_renamed_at) {
          const lastRenamed = new Date(currentProfile.last_renamed_at).getTime();
          const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
          if (Date.now() - lastRenamed < thirtyDaysMs) {
            const daysLeft = Math.ceil((thirtyDaysMs - (Date.now() - lastRenamed)) / (24 * 60 * 60 * 1000));
            return NextResponse.json(
              {
                success: false,
                error: `Handles can only be changed once every 30 days. You can rename again in ${daysLeft} days.`,
              },
              { status: 429 }
            );
          }
        }

        // Update profile
        const { error: updateError } = await supabase
          .from("profiles")
          .update({
            handle: handle.trim().replace(/^@/, ""),
            handle_normalized: validation.normalized,
            is_member: true,
            last_renamed_at: new Date().toISOString(),
          })
          .eq("id", userId);

        if (updateError) {
          return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          handle: handle.trim().replace(/^@/, ""),
          normalized: validation.normalized,
        });
      } else {
        // Insert new member profile
        const { data: newProfile, error: insertError } = await supabase
          .from("profiles")
          .insert([
            {
              username: handle.trim().replace(/^@/, ""),
              handle: handle.trim().replace(/^@/, ""),
              handle_normalized: validation.normalized,
              is_member: true,
              last_renamed_at: new Date().toISOString(),
            },
          ])
          .select("id")
          .single();

        if (insertError) {
          return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
        }

        return NextResponse.json({
          success: true,
          userId: newProfile.id,
          handle: handle.trim().replace(/^@/, ""),
          normalized: validation.normalized,
        });
      }
    }

    // In-memory / local fallback when Supabase is not connected
    return NextResponse.json({
      success: true,
      handle: handle.trim().replace(/^@/, ""),
      normalized: validation.normalized,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
