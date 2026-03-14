import { copyToClipboard, roomFromUrlOrStorage, setPill, setText, tryWriteClipboard, wsUrl } from "./common.js";

const newRoomBtn = document.getElementById("newRoomBtn");
const autoCopyToggle = document.getElementById("autoCopyToggle");
const publicBaseInput = document.getElementById("publicBaseInput");
const savePublicBaseBtn = document.getElementById("savePublicBaseBtn");
const lanSelect = document.getElementById("lanSelect");
const useLanBtn = document.getElementById("useLanBtn");

const roomPill = document.getElementById("roomPill");
const senderPill = document.getElementById("senderPill");
const wsPill = document.getElementById("wsPill");
const clipPill = document.getElementById("clipPill");
const clipHint = document.getElementById("clipHint");
const shareHint = document.getElementById("shareHint");
const senderLinkInput = document.getElementById("senderLinkInput");
const copySenderLinkBtn = document.getElementById("copySenderLinkBtn");
const agentCmdInput = document.getElementById("agentCmdInput");
const copyAgentCmdBtn = document.getElementById("copyAgentCmdBtn");

const lastText = document.getElementById("lastText");
const copyBtn = document.getElementById("copyBtn");
const copyHint = document.getElementById("copyHint");

let ws = null;
let roomId = roomFromUrlOrStorage("receiver");
let lastTs = 0;
let clipboardPrimed = false;

function normalizePublicBase(s) {
  const raw = String(s ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `http://${raw.replace(/\/+$/, "")}`;
}

function isLocalhostHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost";
}

function getPublicBase() {
  const saved = normalizePublicBase(localStorage.getItem("transclip.public_base") || "");
  if (saved) return saved;
  if (!isLocalhostHost(location.hostname)) return location.origin;
  return "";
}

function setPublicBase(value) {
  const v = normalizePublicBase(value);
  if (v) localStorage.setItem("transclip.public_base", v);
  else localStorage.removeItem("transclip.public_base");
  publicBaseInput.value = v;
  updateShareHint();
}

function setRoom(id) {
  roomId = id;
  setText(roomPill, `房间：${roomId || "—"}`);
  if (roomId) localStorage.setItem("transclip.room.receiver", roomId);
  updateShareHint();
}

function updateShareHint() {
  if (!roomId) {
    setText(shareHint, "点击“生成新房间”，然后用手机打开链接或输入房间号。");
    senderLinkInput.value = "";
    agentCmdInput.value = "";
    return;
  }
  const base = getPublicBase();
  if (!base) {
    setText(
      shareHint,
      "当前接收端是 localhost（仅本机可访问）。请在上面填“给手机用的访问地址”，例如 http://192.168.x.x:8787。",
    );
    senderLinkInput.value = "";
    agentCmdInput.value = "";
    return;
  }
  const senderUrl = `${base}/sender.html?room=${encodeURIComponent(roomId)}`;
  setText(shareHint, `手机打开：${senderUrl}`);
  senderLinkInput.value = senderUrl;

  // Agent is meant to run on the same computer as the server.
  const port = location.port || "8787";
  agentCmdInput.value = `npm run agent -- --port ${port} --room ${roomId}`;
}

function setWsState({ ok, text }) {
  setPill(wsPill, { ok, text });
  updateCopyBtnState();
}

function setSenderStatus(connected) {
  setPill(senderPill, { ok: connected, text: connected ? "输入端：已连接" : "输入端：未连接" });
}

function clipboardCapability() {
  const hasApi = !!navigator.clipboard?.writeText;
  const secure = !!window.isSecureContext;
  return { hasApi, secure, ok: hasApi && secure };
}

function updateClipboardPill() {
  const cap = clipboardCapability();
  if (cap.ok) {
    setPill(clipPill, { ok: true, text: "剪贴板：可写" });
    setText(clipHint, "提示：多数浏览器仍需要先点一次“复制到剪贴板”作为用户手势激活。");
    return;
  }
  if (cap.hasApi && !cap.secure) {
    setPill(clipPill, { ok: false, text: "剪贴板：需 HTTPS/localhost" });
    const port = location.port ? `:${location.port}` : "";
    const localhostUrl = `${location.protocol}//127.0.0.1${port}/receiver.html${location.search || ""}`;
    setText(
      clipHint,
      `当前通过局域网 IP 打开（非安全上下文），浏览器会禁用 Clipboard API。建议在电脑用 ${localhostUrl} 打开接收端；手机仍用局域网链接打开输入端。`,
    );
    return;
  }
  setPill(clipPill, { ok: false, text: "剪贴板：受限" });
  setText(clipHint, "当前环境无法使用 Clipboard API；可用按钮复制（兼容模式）或使用 Agent。");
}

function updateCopyBtnState() {
  copyBtn.disabled = !(lastText.value ?? "");
}

async function newRoom() {
  const res = await fetch("/api/room/new", { method: "GET" });
  const data = await res.json();
  setRoom(data.roomId);
  connect();
}

function connect() {
  if (!/^\d{6}$/.test(roomId)) return;
  if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) ws.close();

  ws = new WebSocket(wsUrl({ roomId, role: "receiver" }));
  setWsState({ ok: false, text: "连接：连接中…" });

  ws.addEventListener("open", () => setWsState({ ok: true, text: "连接：已连接" }));
  ws.addEventListener("close", () => setWsState({ ok: false, text: "连接：已断开" }));
  ws.addEventListener("error", () => setWsState({ ok: false, text: "连接：错误" }));

  ws.addEventListener("message", async (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === "ready") {
      if (typeof msg.lastText === "string" && msg.lastText) {
        lastText.value = msg.lastText;
        setText(copyHint, "已同步上次内容（可复制）");
        updateCopyBtnState();
      }
      return;
    }

    if (msg.type === "sender_status") {
      setSenderStatus(!!msg.connected);
      return;
    }

    if (msg.type === "text" && typeof msg.text === "string") {
      lastText.value = msg.text;
      lastTs = typeof msg.ts === "number" ? msg.ts : Date.now();
      setText(copyHint, `收到（${new Date(lastTs).toLocaleTimeString()}）`);
      updateCopyBtnState();

      if (autoCopyToggle.checked) {
        try {
          const cap = clipboardCapability();
          if (!cap.ok) throw new Error("clipboard not allowed");
          if (!clipboardPrimed) throw new Error("not primed");
          await tryWriteClipboard(msg.text);
          setText(copyHint, `已写入剪贴板（${new Date(lastTs).toLocaleTimeString()}）`);
        } catch {
          clipboardPrimed = false;
          setText(copyHint, "自动写入失败：请点击一次“复制到剪贴板”以授权/激活");
        }
      }
    }
  });
}

async function copyNow() {
  const text = lastText.value ?? "";
  if (!text) return;
  const ok = await copyToClipboard(text);
  clipboardPrimed = ok;
  setText(copyHint, ok ? `已复制（${new Date().toLocaleTimeString()}）` : "复制失败：浏览器不支持");
}

async function copySenderLink() {
  const base = getPublicBase();
  if (!base) {
    setText(copyHint, "请先填写“给手机用的访问地址”");
    return;
  }
  if (!roomId) {
    setText(copyHint, "请先生成房间号");
    return;
  }
  const senderUrl = `${base}/sender.html?room=${encodeURIComponent(roomId)}`;
  const ok = await copyToClipboard(senderUrl);
  setText(copyHint, ok ? "已复制手机链接" : "复制手机链接失败");
}

newRoomBtn.addEventListener("click", () => newRoom().catch(() => {}));
copyBtn.addEventListener("click", () => copyNow().catch(() => {}));
savePublicBaseBtn.addEventListener("click", () => setPublicBase(publicBaseInput.value));
useLanBtn.addEventListener("click", () => setPublicBase(lanSelect.value));
copySenderLinkBtn.addEventListener("click", () => copySenderLink().catch(() => {}));
copyAgentCmdBtn.addEventListener("click", async () => {
  const cmd = agentCmdInput.value ?? "";
  if (!cmd) {
    setText(copyHint, "请先生成房间号");
    return;
  }
  const ok = await copyToClipboard(cmd);
  setText(copyHint, ok ? "已复制 Agent 命令" : "复制 Agent 命令失败");
});

autoCopyToggle.checked = localStorage.getItem("transclip.autocopy") === "1";
autoCopyToggle.addEventListener("change", () => {
  localStorage.setItem("transclip.autocopy", autoCopyToggle.checked ? "1" : "0");
  if (autoCopyToggle.checked) {
    setText(copyHint, "提示：自动写入通常需要先点一次“复制到剪贴板”授权/激活");
    updateClipboardPill();
  }
});

publicBaseInput.value = getPublicBase();

setRoom(roomId);
setSenderStatus(false);
setWsState({ ok: false, text: "连接：未连接" });
updateClipboardPill();
updateCopyBtnState();

document.addEventListener("visibilitychange", () => updateClipboardPill());
window.addEventListener("focus", () => updateClipboardPill());

async function loadLanCandidates() {
  try {
    const res = await fetch("/api/info", { method: "GET" });
    const data = await res.json();
    const suggested = Array.isArray(data?.suggestedBases) ? data.suggestedBases : [];
    if (suggested.length === 0) return;

    lanSelect.innerHTML = '<option value="">选择一个局域网地址…</option>';
    for (const base of suggested) {
      const opt = document.createElement("option");
      opt.value = base;
      opt.textContent = base;
      lanSelect.appendChild(opt);
    }

    if (!getPublicBase() && isLocalhostHost(location.hostname)) {
      setPublicBase(suggested[0]);
      lanSelect.value = suggested[0];
      setText(copyHint, "已自动选择局域网地址（可改）");
    }
  } catch {
    // ignore
  }
}

loadLanCandidates();

if (!roomId) {
  updateShareHint();
} else {
  connect();
}
