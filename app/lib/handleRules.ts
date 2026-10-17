// Rules and validation for persistent handles (account usernames)

export const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "support",
  "moderator",
  "mod",
  "quietsignal",
  "quiet_signal",
  "system",
  "root",
  "staff",
  "anonymous",
  "guest",
  "official",
  "help",
  "security",
  "verified",
  "team",
  "contact",
  "api",
  "null",
  "undefined",
  "service",
  "bot",
  "welcome",
  "privacy",
  "terms",
  "safety",
]);

// Basic offensive / profane terms filter for safety
export const BLOCKED_WORDS = [
  "nazi",
  "hitler",
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "cock",
  "pussy",
  "porn",
  "pedophil",
  "rape",
  "nigger",
  "faggot",
  "retard",
  "whore",
  "slut",
];

export interface HandleValidationResult {
  valid: boolean;
  normalized: string;
  error?: string;
}

/**
 * Normalizes a raw handle using Unicode NFKC, lowercasing, and stripping leading '@'.
 */
export function normalizeHandle(raw: string): string {
  if (!raw) return "";
  let clean = raw.normalize("NFKC").trim();
  if (clean.startsWith("@")) clean = clean.slice(1);
  return clean.toLowerCase();
}

/**
 * Validates a handle against character restrictions, length limits, reserved words, and safety checks.
 */
export function validateHandle(raw: string): HandleValidationResult {
  const normalized = normalizeHandle(raw);

  if (!normalized) {
    return { valid: false, normalized: "", error: "Handle cannot be empty" };
  }

  if (normalized.length < 3) {
    return { valid: false, normalized, error: "Handle must be at least 3 characters" };
  }

  if (normalized.length > 20) {
    return { valid: false, normalized, error: "Handle must be 20 characters or fewer" };
  }

  // Strict regex: only lowercase letters a-z, digits 0-9, and underscore _
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: "Only letters (a-z), numbers (0-9), and underscores (_) are allowed",
    };
  }

  // Cannot start or end with an underscore
  if (normalized.startsWith("_") || normalized.endsWith("_")) {
    return { valid: false, normalized, error: "Handle cannot start or end with an underscore" };
  }

  // Cannot contain consecutive underscores
  if (normalized.includes("__")) {
    return { valid: false, normalized, error: "Handle cannot contain consecutive underscores" };
  }

  // Cannot be purely numeric
  if (/^\d+$/.test(normalized)) {
    return { valid: false, normalized, error: "Handle cannot consist of numbers only" };
  }

  // Check reserved system names
  if (RESERVED_HANDLES.has(normalized)) {
    return { valid: false, normalized, error: "This handle is reserved by Quiet Signal" };
  }

  // Check profanity / offensive words
  for (const word of BLOCKED_WORDS) {
    if (normalized.includes(word)) {
      return { valid: false, normalized, error: "This handle contains inappropriate language" };
    }
  }

  return { valid: true, normalized };
}

/**
 * Generates sample handle suggestions based on a seed name.
 */
export function generateHandleSuggestions(seed: string): string[] {
  const base = normalizeHandle(seed).replace(/[^a-z0-9]/g, "") || "chatter";
  const num1 = Math.floor(10 + Math.random() * 89);
  const num2 = Math.floor(100 + Math.random() * 899);
  return [
    `${base}_${num1}`,
    `${base}${num2}`,
    `the_${base}`,
    `${base}_qs`,
  ].filter(h => validateHandle(h).valid);
}
