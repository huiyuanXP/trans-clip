export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function roomFromUrlOrStorage(role) {
  const roomInUrl = qs("room");
  if (roomInUrl && /^\d{6}$/.test(roomInUrl)) {
    localStorage.setItem(`transclip.room.${role}`, roomInUrl);
    return roomInUrl;
  }
  const roomInStorage = localStorage.getItem(`transclip.room.${role}`);
  if (roomInStorage && /^\d{6}$/.test(roomInStorage)) return roomInStorage;
  return "";
}

export function wsUrl({ roomId, role }) {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const host = location.host;
  return `${proto}://${host}/ws?room=${encodeURIComponent(roomId)}&role=${encodeURIComponent(role)}`;
}

export function setText(el, text) {
  el.textContent = text;
}

export function setPill(pillEl, { ok, text }) {
  pillEl.classList.remove("ok", "bad");
  pillEl.classList.add(ok ? "ok" : "bad");
  pillEl.textContent = text;
}

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export async function tryWriteClipboard(text) {
  if (!navigator.clipboard?.writeText) throw new Error("Clipboard API not available");
  await navigator.clipboard.writeText(text);
}

export async function copyToClipboard(text) {
  try {
    await tryWriteClipboard(text);
    return true;
  } catch {
    // Fallback (best-effort): execCommand with a temporary textarea
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.left = "-1000px";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    window.getSelection?.().removeAllRanges?.();
    return ok;
  }
}
