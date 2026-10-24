import { createServer } from "http";
import fs from "fs";
import path from "path";
import next from "next";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();

const supabaseAdmin = (process.env.NEXT_PUBLIC_SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY))
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  : null;

const httpServer = createServer((req, res) => {
  const cleanUrl = (req.url || "").split("?")[0];
  if (cleanUrl === "/.well-known/assetlinks.json" || cleanUrl === "/assetlinks.json") {
    let assetlinksPath = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");
    if (!fs.existsSync(assetlinksPath)) {
      assetlinksPath = path.join(process.cwd(), "public", "assetlinks.json");
    }
    if (fs.existsSync(assetlinksPath)) {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.writeHead(200);
      return fs.createReadStream(assetlinksPath).pipe(res);
    }
  }
  return handle(req, res);
});
const io = new Server(httpServer, {
  maxHttpBufferSize: 1e7, // 10MB for photos and voice notes
});

const waiting = []; // { id, nick, interests }
const partners = new Map(); // socketId -> socketId
const onlineUsers = new Map(); // handle_normalized -> { socketId, nick, handle, isMember, allowSearch, blockedHandles: Set }
const socketToUser = new Map(); // socketId -> handle_normalized
const pendingInvites = new Map(); // inviteId -> { id, fromSocketId, toSocketId, fromHandle, toHandle, createdAt }

// Auto cleanup pending invites older than 60 seconds
setInterval(() => {
  const now = Date.now();
  for (const [id, inv] of pendingInvites.entries()) {
    if (now - inv.createdAt > 60000) {
      pendingInvites.delete(id);
    }
  }
}, 30000);

// In-memory rate limiting map for message spam prevention
const messageRateMap = new Map();
function checkRateLimit(socketId, maxPerWindow = 12, windowMs = 3000) {
  const now = Date.now();
  let entry = messageRateMap.get(socketId);
  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    messageRateMap.set(socketId, entry);
    return true;
  }
  entry.count++;
  return entry.count <= maxPerWindow;
}

function sanitizePayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  const type = ["text", "image", "audio", "sticker"].includes(raw.type) ? raw.type : "text";
  const text = typeof raw.text === "string" ? raw.text.slice(0, 2000) : "";
  let mediaUrl = undefined;
  if (typeof raw.mediaUrl === "string") {
    if (raw.mediaUrl.length <= 5 * 1024 * 1024) {
      mediaUrl = raw.mediaUrl;
    }
  }
  const id = typeof raw.id === "string" ? raw.id.slice(0, 64) : ("m_" + Date.now());
  const toHandle = typeof raw.toHandle === "string" ? raw.toHandle.slice(0, 32) : undefined;
  const fromHandle = typeof raw.fromHandle === "string" ? raw.fromHandle.slice(0, 32) : undefined;
  const fromNick = typeof raw.fromNick === "string" ? raw.fromNick.slice(0, 32) : undefined;
  const time = typeof raw.time === "string" ? raw.time.slice(0, 16) : undefined;
  return { id, type, text, mediaUrl, toHandle, fromHandle, fromNick, time };
}

const dequeue = (id) => {
  const i = waiting.findIndex((w) => w.id === id);
  if (i > -1) waiting.splice(i, 1);
};

const unpair = (id) => {
  const p = partners.get(id);
  if (!p) return;
  partners.delete(id);
  partners.delete(p);
  io.to(p).emit("call-end");
  io.to(p).emit("partner-left");
};

function match(me) {
  let other = null;
  while (waiting.length > 0) {
    const shares = (w) => w.interests.some((i) => me.interests.includes(i));
    let idx = waiting.findIndex((w) => w.id !== me.id && shares(w));
    if (idx < 0 && me.allowFallback !== false) {
      idx = waiting.findIndex((w) => w.id !== me.id && w.allowFallback !== false);
    }
    if (idx < 0) break;

    const [candidate] = waiting.splice(idx, 1);
    const candidateSocket = io.sockets.sockets.get(candidate.id);
    // Discard candidate if disconnected or already paired
    if (!candidateSocket || !candidateSocket.connected || partners.has(candidate.id)) {
      continue;
    }
    other = candidate;
    break;
  }

  if (!other) {
    waiting.push(me);
    io.to(me.id).emit("waiting");
    return;
  }

  partners.set(me.id, other.id);
  partners.set(other.id, me.id);
  const common = me.interests.filter((i) => other.interests.includes(i));
  const isFallback = common.length === 0;
  io.to(me.id).emit("matched", {
    nick: other.nick,
    gender: other.gender,
    interests: other.interests,
    style: other.style,
    isMember: !!other.isMember,
    handle: other.handle || null,
    region: other.region || null,
    common,
    isFallback,
    isInitiator: true,
    isDirect: false,
  });
  io.to(other.id).emit("matched", {
    nick: me.nick,
    gender: me.gender,
    interests: me.interests,
    style: me.style,
    isMember: !!me.isMember,
    handle: me.handle || null,
    region: me.region || null,
    common,
    isFallback,
    isInitiator: false,
    isDirect: false,
  });
}

let onlineCount = 0;

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("online-count", onlineCount);

  socket.on("find", ({ nick, gender, interests, style, isMember, handle, region, allowFallback }) => {
    unpair(socket.id);
    dequeue(socket.id);
    const clean = (Array.isArray(interests) ? interests : [])
      .map((i) => String(i).trim().toLowerCase().slice(0, 24))
      .filter(Boolean)
      .slice(0, 5);
    const validGender = gender === "female" ? "female" : gender === "male" ? "male" : "other";
    match({
      id: socket.id,
      nick: String(nick || "Stranger").trim().slice(0, 20) || "Stranger",
      gender: validGender,
      interests: clean,
      style: style || "text",
      isMember: !!isMember,
      handle: handle ? String(handle).trim().replace(/^@/, "").slice(0, 20) : null,
      region: region ? String(region).slice(0, 40) : null,
      allowFallback: allowFallback !== false,
    });
  });

  const resolveTargetSocket = (data) => {
    let p = partners.get(socket.id);
    if (!p && data && typeof data === "object" && data.toHandle) {
      const norm = String(data.toHandle).toLowerCase().trim().replace(/^@/, "");
      const u = onlineUsers.get(norm);
      if (u && u.socketId && u.socketId !== socket.id) {
        p = u.socketId;
      }
    }
    return p;
  };

  socket.on("signal", (data) => {
    const p = resolveTargetSocket(data);
    if (p) {
      io.to(p).emit("signal", data);
    }
  });

  socket.on("video-state", (state) => {
    const p = resolveTargetSocket(state);
    if (p) {
      io.to(p).emit("video-state", state);
    }
  });

  socket.on("call-request", (data) => {
    const p = resolveTargetSocket(data);
    if (p) {
      io.to(p).emit("call-request", data);
    } else {
      socket.emit("direct-chat-error", { message: "Partner is currently offline or unavailable for video." });
    }
  });

  socket.on("call-cancel", (data) => {
    const p = resolveTargetSocket(data);
    if (p) {
      io.to(p).emit("call-cancel", data);
    }
  });

  socket.on("call-response", (data) => {
    const p = resolveTargetSocket(data);
    if (p) {
      if (data && data.accepted) {
        partners.set(socket.id, p);
        partners.set(p, socket.id);
      }
      io.to(p).emit("call-response", data);
    }
  });

  socket.on("friend-request", (senderInfo) => {
    const p = resolveTargetSocket(senderInfo);
    if (p) {
      io.to(p).emit("friend-request", senderInfo);
    }
  });

  socket.on("friend-accept", (acceptInfo) => {
    const p = resolveTargetSocket(acceptInfo);
    if (p) {
      io.to(p).emit("friend-accept", acceptInfo);
    }
  });

  socket.on("call-end", (data) => {
    const p = resolveTargetSocket(data);
    if (p) {
      partners.delete(socket.id);
      partners.delete(p);
      io.to(p).emit("call-end", data);
    }
  });

  socket.on("message", (rawPayload) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit("direct-chat-error", { message: "Slow down! Sending messages too quickly." });
      return;
    }
    const payload = sanitizePayload(rawPayload);
    if (!payload) return;

    const senderNorm = socketToUser.get(socket.id);
    if (senderNorm) {
      payload.fromHandle = senderNorm;
    }

    const p = partners.get(socket.id);
    let delivered = false;

    if (p) {
      io.to(p).emit("message", payload);
      delivered = true;
    }

    // Direct real-time routing for friend / past conversation messages
    if (payload.toHandle) {
      const norm = String(payload.toHandle).toLowerCase().trim().replace(/^@/, "");
      const target = onlineUsers.get(norm);
      if (target && target.socketId && target.socketId !== socket.id && target.socketId !== p) {
        if (!(target.blockedHandles && senderNorm && target.blockedHandles.has(senderNorm))) {
          io.to(target.socketId).emit("direct-message", payload);
          io.to(target.socketId).emit("message", payload);
          delivered = true;
        }
      }
    }

    // Inform sender that message was delivered to recipient's active socket
    if (delivered && payload.id) {
      socket.emit("message-delivered", {
        messageId: payload.id,
      });
    }
  });

  // Explicit message delivery receipt acknowledgment from recipient client
  socket.on("message-ack", ({ messageId, fromHandle }) => {
    if (!messageId) return;
    const recipientHandle = socketToUser.get(socket.id);
    if (fromHandle) {
      const senderNorm = String(fromHandle).toLowerCase().trim().replace(/^@/, "");
      const senderTarget = onlineUsers.get(senderNorm);
      if (senderTarget && senderTarget.socketId) {
        io.to(senderTarget.socketId).emit("message-delivered", {
          messageId,
          toHandle: recipientHandle,
        });
      }
    }
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("message-delivered", {
        messageId,
      });
    }
  });

  socket.on("message-seen", (data) => {
    if (!data) return;
    const { messageId, toHandle, fromHandle } = data;
    if (toHandle) {
      const norm = String(toHandle).toLowerCase().trim().replace(/^@/, "");
      const target = onlineUsers.get(norm);
      if (target && target.socketId) {
        io.to(target.socketId).emit("message-seen", { messageId, fromHandle });
      }
    }
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("message-seen", { messageId, fromHandle });
    }
  });

  socket.on("direct-message", (rawPayload) => {
    if (!checkRateLimit(socket.id)) {
      socket.emit("direct-chat-error", { message: "Slow down! Sending messages too quickly." });
      return;
    }
    const payload = sanitizePayload(rawPayload);
    if (!payload || !payload.toHandle) return;

    const norm = String(payload.toHandle).toLowerCase().trim().replace(/^@/, "");
    const target = onlineUsers.get(norm);
    const senderNorm = socketToUser.get(socket.id);

    // Enforce verified sender handle from server session
    if (senderNorm) {
      payload.fromHandle = senderNorm;
    }

    // Check if target blocked sender
    if (target && target.blockedHandles && senderNorm && target.blockedHandles.has(senderNorm)) {
      return; // Silently drop blocked messages
    }

    if (target && target.socketId && target.socketId !== socket.id) {
      io.to(target.socketId).emit("direct-message", payload);
      io.to(target.socketId).emit("message", payload);
    }
  });

  socket.on("register-identity", async (info) => {
    if (!info || !info.handle) return;
    const norm = String(info.handle).toLowerCase().trim().replace(/^@/, "");
    let isMember = false;

    // Verify token with Supabase if provided to prevent handle impersonation
    if (info.token && supabaseAdmin) {
      try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(info.token);
        if (!error && user) {
          isMember = true;
        }
      } catch (err) {
        console.warn("Token verification failed:", err);
      }
    } else if (info.isMember) {
      // Fallback if already member
      isMember = true;
    }

    const blockedSet = new Set(
      (Array.isArray(info.blockedHandles) ? info.blockedHandles : [])
        .map((h) => String(h).toLowerCase().trim().replace(/^@/, ""))
        .filter(Boolean)
    );

    onlineUsers.set(norm, {
      socketId: socket.id,
      nick: info.nick || info.handle,
      handle: info.handle,
      isMember,
      allowSearch: info.allowSearch !== false,
      blockedHandles: blockedSet,
    });
    socketToUser.set(socket.id, norm);
    socket.emit("registered", { handle: norm, isMember });
  });

  socket.on("direct-chat-request", ({ targetHandle, senderInfo }) => {
    const norm = String(targetHandle || "").toLowerCase().trim().replace(/^@/, "");
    const target = onlineUsers.get(norm);
    const senderHandleNorm = socketToUser.get(socket.id) || (senderInfo?.handle ? String(senderInfo.handle).toLowerCase().trim().replace(/^@/, "") : null);

    if (!target) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} is currently offline.` });
      return;
    }

    if (target.socketId === socket.id) {
      socket.emit("direct-chat-error", { message: "You cannot chat with yourself." });
      return;
    }

    // Check if target blocked sender
    if (senderHandleNorm && target.blockedHandles && target.blockedHandles.has(senderHandleNorm)) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} is currently unavailable.` });
      return;
    }

    // Consent: Check if target user allows handle search / discovery
    if (target.allowSearch === false) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} does not accept direct search requests.` });
      return;
    }

    if (partners.has(target.socketId)) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} is currently in another conversation.` });
      return;
    }

    const inviteId = "inv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
    pendingInvites.set(inviteId, {
      id: inviteId,
      fromSocketId: socket.id,
      toSocketId: target.socketId,
      fromHandle: senderHandleNorm,
      toHandle: norm,
      createdAt: Date.now(),
    });

    io.to(target.socketId).emit("direct-chat-invite", {
      inviteId,
      fromSocketId: socket.id,
      fromNick: senderInfo?.nick || (senderHandleNorm ? `@${senderHandleNorm}` : "A friend"),
      fromHandle: senderHandleNorm || senderInfo?.handle || null,
      fromIsMember: !!senderInfo?.isMember,
    });
  });

  socket.on("direct-chat-response", ({ inviteId, accepted, fromSocketId, targetInfo }) => {
    let invite = null;
    if (inviteId && pendingInvites.has(inviteId)) {
      invite = pendingInvites.get(inviteId);
      pendingInvites.delete(inviteId);
    }

    const requesterSocketId = invite ? invite.fromSocketId : fromSocketId;

    if (!accepted) {
      if (requesterSocketId) {
        io.to(requesterSocketId).emit("direct-chat-error", { message: "The invitation was declined." });
      }
      return;
    }

    if (!requesterSocketId || !io.sockets.sockets.has(requesterSocketId)) {
      socket.emit("direct-chat-error", { message: "The user who invited you is no longer connected." });
      return;
    }

    unpair(socket.id);
    dequeue(socket.id);
    unpair(requesterSocketId);
    dequeue(requesterSocketId);

    partners.set(socket.id, requesterSocketId);
    partners.set(requesterSocketId, socket.id);

    const senderHandleNorm = socketToUser.get(requesterSocketId);
    const sender = senderHandleNorm ? onlineUsers.get(senderHandleNorm) : null;

    io.to(requesterSocketId).emit("matched", {
      nick: targetInfo?.nick || "Friend",
      gender: "other",
      interests: ["Direct Connection"],
      style: "text",
      isMember: !!targetInfo?.isMember,
      handle: targetInfo?.handle || null,
      common: ["Direct Connection"],
      isInitiator: true,
      isDirect: true,
    });

    io.to(socket.id).emit("matched", {
      nick: sender?.nick || "Friend",
      gender: "other",
      interests: ["Direct Connection"],
      style: "text",
      isMember: !!sender?.isMember,
      handle: sender?.handle || null,
      common: ["Direct Connection"],
      isInitiator: false,
      isDirect: true,
    });
  });

  const leave = () => {
    unpair(socket.id);
    dequeue(socket.id);
    messageRateMap.delete(socket.id);
    for (const [id, inv] of pendingInvites.entries()) {
      if (inv.fromSocketId === socket.id || inv.toSocketId === socket.id) {
        pendingInvites.delete(id);
      }
    }
    const h = socketToUser.get(socket.id);
    if (h) {
      onlineUsers.delete(h);
      socketToUser.delete(socket.id);
    }
  };
  socket.on("leave", leave);
  socket.on("disconnect", () => {
    leave();
    onlineCount = Math.max(0, onlineCount - 1);
    io.emit("online-count", onlineCount);
  });
});

const port = process.env.PORT || 3000;
httpServer.listen(port, () => console.log(`http://localhost:${port}`));
