import { NextRequest, NextResponse } from "next/server";
import { validateHandle } from "@/app/lib/handleRules";
import { checkRateLimit } from "@/app/lib/rateLimit";
import { supabase } from "@/app/lib/supabase";

export async function GET(req: NextRequest) {
  // Rate limiting by client IP
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "127.0.0.1";

  const rateCheck = checkRateLimit(ip, 60, 60_000); // 60 checks / minute
  if (!rateCheck.allowed) {
    return NextResponse.json(
      {
        available: false,
        reason: "Too many requests. Please wait a moment before trying again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rateCheck.resetMs / 1000).toString(),
        },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawHandle = searchParams.get("handle") || "";

  // 1. Format & rule validation
  const validation = validateHandle(rawHandle);
  if (!validation.valid) {
    return NextResponse.json({
      available: false,
      reason: validation.error,
      normalized: validation.normalized,
    });
  }

  // 2. Database uniqueness check
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, handle_normalized")
        .eq("handle_normalized", validation.normalized)
        .maybeSingle();

      if (error) {
        console.warn("Database handle check error:", error.message);
      } else if (data) {
        return NextResponse.json({
          available: false,
          reason: "This handle is already taken by another member",
          normalized: validation.normalized,
        });
      }
    } catch (err) {
      console.warn("Handle lookup exception:", err);
    }
  }

  return NextResponse.json({
    available: true,
    normalized: validation.normalized,
  });
}
