import { createServer } from "http";
import next from "next";
import { Server } from "socket.io";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();
await app.prepare();

const httpServer = createServer((req, res) => handle(req, res));
const io = new Server(httpServer);

const waiting = []; // { id, nick, interests }
const partners = new Map(); // socketId -> socketId

const dequeue = (id) => {
  const i = waiting.findIndex((w) => w.id === id);
  if (i > -1) waiting.splice(i, 1);
};

const unpair = (id) => {
  const p = partners.get(id);
  if (!p) return;
  partners.delete(id);
  partners.delete(p);
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
    common,
    isInitiator: true,
  });
  io.to(other.id).emit("matched", {
    nick: me.nick,
    gender: me.gender,
    interests: me.interests,
    style: me.style,
    common,
    isInitiator: false,
  });
}

let onlineCount = 0;

io.on("connection", (socket) => {
  onlineCount++;
  io.emit("online-count", onlineCount);

  socket.on("find", ({ nick, gender, interests, style }) => {
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

  socket.on("message", (text) => {
    const p = partners.get(socket.id);
    if (p && typeof text === "string" && text.trim()) {
      io.to(p).emit("message", text.slice(0, 500));
    }
  });

  const leave = () => {
    unpair(socket.id);
    dequeue(socket.id);
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
