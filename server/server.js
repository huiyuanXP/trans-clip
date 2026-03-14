import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import { WebSocketServer } from "ws";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number.parseInt(process.env.PORT ?? "8787", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

/**
 * Room state is in-memory (single-process).
 * - sender: last known websocket for sender (optional)
 * - receivers: set of receiver websockets
 * - lastText: last text sent, for late-join receivers
 */
const rooms = new Map();

function randomRoomCode() {
  return crypto.randomInt(100000, 999999).toString();
}

function getOrCreateRoom(roomId) {
  let room = rooms.get(roomId);
  if (!room) {
    room = { sender: null, receivers: new Set(), lastText: "" };
    rooms.set(roomId, room);
  }
  return room;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function wsSend(ws, obj) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(obj));
}

const app = express();
app.disable("x-powered-by");

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/api/room/new", (_req, res) => {
  let roomId = randomRoomCode();
  while (rooms.has(roomId)) roomId = randomRoomCode();
  getOrCreateRoom(roomId);
  res.json({ roomId });
});

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (sometimes used on routers)
  return false;
}

function getLanIpv4Candidates() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const ifname of Object.keys(nets)) {
    for (const addr of nets[ifname] ?? []) {
      if (!addr) continue;
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!isPrivateIpv4(addr.address)) continue;
      ips.push({ ifname, ip: addr.address });
    }
  }
  // Prefer common home LAN ranges
  const score = (ip) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : ip.startsWith("172.") ? 2 : 3);
  ips.sort((a, b) => score(a.ip) - score(b.ip) || a.ip.localeCompare(b.ip));
  return ips;
}

app.get("/api/info", (_req, res) => {
  const ips = getLanIpv4Candidates();
  const bases = ips.map(({ ip }) => `http://${ip}:${PORT}`);
  res.json({
    port: PORT,
    hostname: os.hostname(),
    ipv4: ips,
    suggestedBases: bases,
  });
});

app.use("/", express.static(path.join(__dirname, "..", "web")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const role = url.searchParams.get("role");
  const roomId = url.searchParams.get("room");

  if (!roomId || !/^\d{6}$/.test(roomId)) {
    ws.close(1008, "Invalid room");
    return;
  }
  if (role !== "sender" && role !== "receiver") {
    ws.close(1008, "Invalid role");
    return;
  }

  const room = getOrCreateRoom(roomId);

  if (role === "sender") {
    if (room.sender && room.sender.readyState === room.sender.OPEN) {
      wsSend(room.sender, { type: "error", message: "Another sender connected; replaced." });
      room.sender.close(1012, "Replaced by new sender");
    }
    room.sender = ws;
    wsSend(ws, { type: "ready", roomId, role });
    for (const r of room.receivers) wsSend(r, { type: "sender_status", connected: true });
  } else {
    room.receivers.add(ws);
    wsSend(ws, { type: "ready", roomId, role, lastText: room.lastText });
    wsSend(ws, { type: "sender_status", connected: !!(room.sender && room.sender.readyState === room.sender.OPEN) });
  }

  ws.on("message", (buf) => {
    const msg = safeJsonParse(buf.toString("utf8"));
    if (!msg || typeof msg !== "object") return;

    if (role === "sender") {
      if (msg.type === "text" && typeof msg.text === "string") {
        room.lastText = msg.text;
        for (const r of room.receivers) wsSend(r, { type: "text", text: msg.text, ts: Date.now() });
      }
      if (msg.type === "ping") wsSend(ws, { type: "pong" });
    } else {
      if (msg.type === "ping") wsSend(ws, { type: "pong" });
    }
  });

  ws.on("close", () => {
    const current = rooms.get(roomId);
    if (!current) return;

    if (role === "sender") {
      if (current.sender === ws) current.sender = null;
      for (const r of current.receivers) wsSend(r, { type: "sender_status", connected: false });
    } else {
      current.receivers.delete(ws);
    }

    if (!current.sender && current.receivers.size === 0) rooms.delete(roomId);
  });
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`trans-clip server listening on http://${HOST}:${PORT}`);
});
