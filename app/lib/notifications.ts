// Notification & Audio alert helpers for Quiet Signal

/**
 * Plays a subtle, non-intrusive audio chime using the Web Audio API.
 */
export function playNotificationChime() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    // Pleasant dual chime: 587.33Hz (D5) -> 880Hz (A5)
    osc.frequency.setValueAtTime(587.33, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    // Ignore audio autoplay restrictions
  }
}

/**
 * Requests browser notification permission.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  return Notification.permission;
}

/**
 * Sends a system notification with badge, icon, and chime.
 */
export async function sendAppNotification(
  title: string,
  options?: {
    body?: string;
    tag?: string;
    requireInteraction?: boolean;
    data?: any;
  }
) {
  if (typeof window === "undefined") return;

  // Always play notification chime
  playNotificationChime();

  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }

  const notifOptions: NotificationOptions = {
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    body: options?.body || "",
    tag: options?.tag || "general",
    requireInteraction: options?.requireInteraction || false,
    data: options?.data,
  };

  try {
    // Mobile / Service Worker preferred
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && "showNotification" in reg) {
        await reg.showNotification(title, notifOptions);
        return;
      }
    }

    // Desktop window fallback
    const notif = new Notification(title, notifOptions);
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
  } catch (err) {
    console.warn("Failed to display notification:", err);
  }
}
