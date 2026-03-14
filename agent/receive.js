import process from "node:process";
import os from "node:os";

import clipboardy from "clipboardy";
import WebSocket from "ws";

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm run agent -- --room 123456",
      "  npm run agent -- --port 8787 --room 123456",
      "  npm run agent -- --server http://192.168.1.23:8787 --room 123456",
      "  npm run agent -- --lan --port 8787 --room 123456",
      "",
      "Notes:",
      "  - Run this on the computer to write clipboard reliably (no browser restrictions).",
      "  - Keep it running in the background; just paste anywhere.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = { server: "", port: "", room: "", lan: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") args.server = argv[++i] ?? "";
    else if (a === "--port") args.port = argv[++i] ?? "";
    else if (a === "--room") args.room = argv[++i] ?? "";
    else if (a === "--lan") args.lan = true;
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const port = Number.parseInt(args.port || process.env.PORT || "8787", 10) || 8787;
const roomId = (args.room || process.env.ROOM || "").trim();

if (!/^\d{6}$/.test(roomId)) {
  // eslint-disable-next-line no-console
  console.error("Missing/invalid --room (expected 6 digits).");
  usage();
  process.exit(2);
}

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function pickLanIpv4() {
  const ifaces = os.networkInterfaces();
  const ips = [];
  for (const ifname of Object.keys(ifaces)) {
    for (const addr of ifaces[ifname] ?? []) {
      if (!addr) continue;
      if (addr.family !== "IPv4") continue;
      if (addr.internal) continue;
      if (!isPrivateIpv4(addr.address)) continue;
      ips.push(addr.address);
    }
  }
  ips.sort((a, b) => (a.startsWith("192.168.") ? -1 : 0) - (b.startsWith("192.168.") ? -1 : 0) || a.localeCompare(b));
  return ips[0] || "";
}

let serverBase = args.server || process.env.SERVER || "";
if (!serverBase) {
  serverBase = `http://127.0.0.1:${port}`;
}

if (args.lan && !args.server) {
  const lanIp = pickLanIpv4();
  if (lanIp) serverBase = `http://${lanIp}:${port}`;
}

const wsUrl = serverBase.replace(/^http/, "ws").replace(/\/$/, "") + `/ws?room=${encodeURIComponent(roomId)}&role=receiver`;

// eslint-disable-next-line no-console
console.log(`Connecting: ${wsUrl}`);

let lastText = "";

function connect() {
  const ws = new WebSocket(wsUrl);

  ws.on("open", () => {
    // eslint-disable-next-line no-console
    console.log("Connected. Waiting for text…");
  });

  ws.on("message", async (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString("utf8"));
    } catch {
      return;
    }
    if (msg.type !== "text" || typeof msg.text !== "string") return;

    const text = msg.text;
    if (text === lastText) return;
    lastText = text;

    try {
      await clipboardy.write(text);
      // eslint-disable-next-line no-console
      console.log(`Clipboard updated (${new Date().toLocaleTimeString()})`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Clipboard write failed:", e?.message ?? e);
    }
  });

  ws.on("close", () => {
    // eslint-disable-next-line no-console
    console.log("Disconnected. Reconnecting in 1s…");
    setTimeout(connect, 1000);
  });

  ws.on("error", () => {
    // Let close handler reconnect.
  });
}

connect();
