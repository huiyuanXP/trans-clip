import { copyToClipboard, debounce, roomFromUrlOrStorage, setPill, setText, wsUrl } from "./common.js";

const roomInput = document.getElementById("roomInput");
const connectBtn = document.getElementById("connectBtn");
const roomPill = document.getElementById("roomPill");
const wsPill = document.getElementById("wsPill");
const textInput = document.getElementById("textInput");
const sendBtn = document.getElementById("sendBtn");
const sendHint = document.getElementById("sendHint");

let ws = null;
let roomId = roomFromUrlOrStorage("sender");

function normalizeRoom(s) {
  const digits = String(s ?? "").replace(/[^\d]/g, "").slice(0, 6);
  return digits;
}

function setRoom(id) {
  roomId = normalizeRoom(id);
  roomInput.value = roomId;
  setText(roomPill, `房间：${roomId || "—"}`);
  if (roomId) localStorage.setItem("transclip.room.sender", roomId);
}

function setWsState({ ok, text }) {
  setPill(wsPill, { ok, text });
  sendBtn.disabled = !ok;
  setText(sendHint, ok ? "已连接，输入会自动发送" : "未连接");
}

function connect() {
  const id = normalizeRoom(roomInput.value);
  setRoom(id);
  if (!/^\d{6}$/.test(roomId)) {
    setWsState({ ok: false, text: "连接：房间号无效" });
    return;
  }

  if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) ws.close();

  ws = new WebSocket(wsUrl({ roomId, role: "sender" }));

  setWsState({ ok: false, text: "连接：连接中…" });

  ws.addEventListener("open", () => setWsState({ ok: true, text: "连接：已连接" }));
  ws.addEventListener("close", () => setWsState({ ok: false, text: "连接：已断开" }));
  ws.addEventListener("error", () => setWsState({ ok: false, text: "连接：错误" }));
  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === "error") setWsState({ ok: false, text: `连接：${msg.message || "错误"}` });
    } catch {
      // ignore
    }
  });
}

function sendNow() {
  const text = textInput.value ?? "";
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: "text", text }));
  setText(sendHint, `已发送（${new Date().toLocaleTimeString()}）`);
}

const sendDebounced = debounce(sendNow, 220);

roomInput.addEventListener("input", () => setRoom(roomInput.value));
connectBtn.addEventListener("click", connect);
sendBtn.addEventListener("click", sendNow);
textInput.addEventListener("input", () => sendDebounced());

setRoom(roomId);
setWsState({ ok: false, text: "连接：未连接" });

// Nice-to-have: long-press copy room id on mobile
roomPill.addEventListener("click", async () => {
  if (!roomId) return;
  try {
    const ok = await copyToClipboard(roomId);
    if (!ok) throw new Error("copy failed");
    setText(roomPill, `房间：${roomId}（已复制）`);
    setTimeout(() => setText(roomPill, `房间：${roomId}`), 1200);
  } catch {
    // ignore
  }
});
