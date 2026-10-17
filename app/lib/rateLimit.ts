// Simple in-memory sliding window rate limiter

interface RateLimitRecord {
  timestamps: number[];
}

const ipMap = new Map<string, RateLimitRecord>();

// Clean up stale entries every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of ipMap.entries()) {
      record.timestamps = record.timestamps.filter((ts) => now - ts < 60_000);
      if (record.timestamps.length === 0) {
        ipMap.delete(ip);
      }
    }
  }, 5 * 60_000);
}

/**
 * Checks if an IP has exceeded rate limit.
 * @param ip Client IP address or identifier
 * @param maxRequests Maximum requests allowed within windowMs (default 60 requests / minute)
 * @param windowMs Time window in milliseconds (default 60,000ms = 1 minute)
 */
export function checkRateLimit(
  ip: string,
  maxRequests = 60,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let record = ipMap.get(ip);

  if (!record) {
    record = { timestamps: [] };
    ipMap.set(ip, record);
  }

  // Filter timestamps within current window
  record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

  if (record.timestamps.length >= maxRequests) {
    const oldest = record.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return {
      allowed: false,
      remaining: 0,
      resetMs,
    };
  }

  record.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - record.timestamps.length,
    resetMs: windowMs,
  };
}
