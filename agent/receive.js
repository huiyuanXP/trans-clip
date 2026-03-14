import process from "node:process";

import clipboardy from "clipboardy";
import WebSocket from "ws";

function usage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Usage:",
      "  npm run agent -- --server http://127.0.0.1:8787 --room 123456",
      "",
      "Notes:",
      "  - Run this on the computer to write clipboard reliably (no browser restrictions).",
      "  - Keep it running in the background; just paste anywhere.",
    ].join("\n"),
  );
}

function parseArgs(argv) {
  const args = { server: "", room: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--server") args.server = argv[++i] ?? "";
    else if (a === "--room") args.room = argv[++i] ?? "";
    else if (a === "-h" || a === "--help") args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  usage();
  process.exit(0);
}

const serverBase = args.server || process.env.SERVER || "http://127.0.0.1:8787";
const roomId = (args.room || process.env.ROOM || "").trim();

if (!/^\d{6}$/.test(roomId)) {
  // eslint-disable-next-line no-console
  console.error("Missing/invalid --room (expected 6 digits).");
  usage();
  process.exit(2);
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

