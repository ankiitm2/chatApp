import { createServer } from "http";
import fs from "fs";
import path from "path";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();

const httpServer = createServer((req, res) => {
  if (req.url === "/.well-known/assetlinks.json") {
    const assetlinksPath = path.join(process.cwd(), "public", ".well-known", "assetlinks.json");
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
const onlineUsers = new Map(); // handle_normalized -> { socketId, nick, handle, isMember }
const socketToUser = new Map(); // socketId -> handle_normalized

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
  const shares = (w) => w.interests.some((i) => me.interests.includes(i));
  let idx = waiting.findIndex((w) => w.id !== me.id && shares(w));
  if (idx < 0) idx = waiting.findIndex((w) => w.id !== me.id);
  if (idx < 0) {
    waiting.push(me);
    io.to(me.id).emit("waiting");
    return;
  }
  const [other] = waiting.splice(idx, 1);
  partners.set(me.id, other.id);
  partners.set(other.id, me.id);
  const common = me.interests.filter((i) => other.interests.includes(i));
  io.to(me.id).emit("matched", {
    nick: other.nick,
    gender: other.gender,
    interests: other.interests,
    style: other.style,
    isMember: !!other.isMember,
    handle: other.handle || null,
    common,
    isInitiator: true,
  });
  io.to(other.id).emit("matched", {
    nick: me.nick,
    gender: me.gender,
    interests: me.interests,
    style: me.style,
    isMember: !!me.isMember,
    handle: me.handle || null,
    common,
    isInitiator: false,
  });
}

let onlineCount = 0;

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("online-count", onlineCount);

  socket.on("find", ({ nick, gender, interests, style, isMember, handle }) => {
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
    });
  });

  socket.on("signal", (data) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("signal", data);
    }
  });

  socket.on("video-state", (state) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("video-state", state);
    }
  });

  socket.on("call-request", (data) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("call-request", data);
    }
  });

  socket.on("call-cancel", () => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("call-cancel");
    }
  });

  socket.on("call-response", (data) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("call-response", data);
    }
  });

  socket.on("friend-request", (senderInfo) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("friend-request", senderInfo);
    }
  });

  socket.on("friend-accept", (acceptInfo) => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("friend-accept", acceptInfo);
    }
  });

  socket.on("call-end", () => {
    const p = partners.get(socket.id);
    if (p) {
      io.to(p).emit("call-end");
    }
  });

  socket.on("message", (payload) => {
    const p = partners.get(socket.id);
    if (p && payload) {
      io.to(p).emit("message", payload);
    }
  });

  socket.on("register-identity", (info) => {
    if (info && info.handle) {
      const norm = String(info.handle).toLowerCase().trim().replace(/^@/, "");
      onlineUsers.set(norm, {
        socketId: socket.id,
        nick: info.nick || info.handle,
        handle: info.handle,
        isMember: !!info.isMember,
      });
      socketToUser.set(socket.id, norm);
      socket.emit("registered", { handle: norm });
    }
  });

  socket.on("direct-chat-request", ({ targetHandle, senderInfo }) => {
    const norm = String(targetHandle || "").toLowerCase().trim().replace(/^@/, "");
    const target = onlineUsers.get(norm);

    if (!target) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} is currently offline.` });
      return;
    }

    if (target.socketId === socket.id) {
      socket.emit("direct-chat-error", { message: "You cannot chat with yourself." });
      return;
    }

    if (partners.has(target.socketId)) {
      socket.emit("direct-chat-error", { message: `@${targetHandle} is currently in another conversation.` });
      return;
    }

    io.to(target.socketId).emit("direct-chat-invite", {
      fromSocketId: socket.id,
      fromNick: senderInfo?.nick || "A friend",
      fromHandle: senderInfo?.handle || null,
      fromIsMember: !!senderInfo?.isMember,
    });
  });

  socket.on("direct-chat-response", ({ accepted, fromSocketId, targetInfo }) => {
    if (!accepted) {
      io.to(fromSocketId).emit("direct-chat-error", { message: "The invitation was declined." });
      return;
    }

    unpair(socket.id);
    dequeue(socket.id);
    unpair(fromSocketId);
    dequeue(fromSocketId);

    partners.set(socket.id, fromSocketId);
    partners.set(fromSocketId, socket.id);

    const senderHandleNorm = socketToUser.get(fromSocketId);
    const sender = senderHandleNorm ? onlineUsers.get(senderHandleNorm) : null;

    io.to(fromSocketId).emit("matched", {
      nick: targetInfo?.nick || "Friend",
      gender: "other",
      interests: ["Direct Connection"],
      style: "text",
      isMember: !!targetInfo?.isMember,
      handle: targetInfo?.handle || null,
      common: ["Direct Connection"],
      isInitiator: true,
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
    });
  });

  const leave = () => {
    unpair(socket.id);
    dequeue(socket.id);
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
