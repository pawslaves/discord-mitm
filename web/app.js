const EPOCH = 1420070400000n;
const PALETTE = [
  "#007aff",
  "#30d158",
  "#ff9f0a",
  "#bf5af2",
  "#5ac8fa",
  "#ff375f",
  "#ffd60a",
];

const S = {
  msgs: [],
  authors: {},
  cfg: {
    channel_id: "",
    is_group: false,
    owner_id: "",
    name: "",
    profile_id: "",
    default_profile: "",
  },
  profiles: [],
  sse: null,
  tab: "text",
  pref: {
    time24: localStorage.getItem("time24") === "1",
  },
};

function genId(tsMs, seq = 0) {
  return (((BigInt(Math.floor(tsMs)) - EPOCH) << 22n) + BigInt(seq)).toString();
}

function nextMsgId(tsMs) {
  const used = new Set(S.msgs.map((m) => m.id).filter(Boolean));
  for (let i = 0; i < 4096; i++) {
    const id = genId(tsMs, i);
    if (!used.has(id)) return id;
  }
  return genId(Date.now(), Math.floor(Math.random() * 4096));
}

function avColor(id) {
  if (!id) return PALETTE[0];
  const n = parseInt(id.slice(-4), 16) % PALETTE.length;
  return PALETTE[isNaN(n) ? 0 : n];
}

function aName(a) {
  return a?.global_name || a?.username || "unknown";
}

function isAutoName(name, id) {
  return !!id && name === `user-${id.slice(-4)}`;
}

function isStubAuthor(a) {
  if (!a?.id) return false;
  return isAutoName(a.username, a.id) || isAutoName(a.global_name, a.id);
}

function setStatus(txt, ms = 2400) {
  const ok = document.getElementById("save-ok");
  ok.textContent = txt;
  if (ms) {
    setTimeout(() => {
      if (ok.textContent === txt) ok.textContent = "";
    }, ms);
  }
}

function avUrl(a) {
  if (!a?.id || !a?.avatar) return "";
  if (/^https?:\/\//i.test(a.avatar)) return a.avatar;
  const ext = a.avatar.startsWith("a_") ? "gif" : "webp";
  return `https://cdn.discordapp.com/avatars/${a.id}/${a.avatar}.${ext}?size=64`;
}

function toInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toTimeValue(iso) {
  const val = toInput(iso);
  return S.pref.time24 ? val.replace("T", " ") : val;
}

function fromInput(val) {
  if (!val) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(val);
  if (!m) return "";
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
  if (!Number.isFinite(d.getTime())) return "";
  return d.toISOString().replace(".000Z", ".000000+00:00");
}

function nowInput() {
  const now = new Date();
  now.setSeconds(0, 0);
  return toTimeValue(now.toISOString());
}

function timeAttr() {
  return S.pref.time24
    ? 'type="text" inputmode="numeric" placeholder="YYYY-MM-DD HH:mm"'
    : 'type="datetime-local"';
}

function applyTimeMode() {
  document.querySelectorAll(".dt-in").forEach((el) => {
    const iso = fromInput(el.value);
    el.type = S.pref.time24 ? "text" : "datetime-local";
    el.inputMode = S.pref.time24 ? "numeric" : "";
    el.placeholder = S.pref.time24 ? "YYYY-MM-DD HH:mm" : "";
    if (iso) el.value = toTimeValue(iso);
  });
}

function addSeconds(iso, seconds) {
  const start = new Date(iso).getTime();
  const ms = Number.isFinite(start)
    ? start + seconds * 1000
    : Date.now() + seconds * 1000;
  return new Date(ms).toISOString();
}

function diffMs(startIso, endIso) {
  const a = new Date(startIso).getTime();
  const b = new Date(endIso).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, b - a);
}

function fmtDur(ms) {
  let s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function parseDur(v) {
  const raw = String(v || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const parts = raw.split(":").map((x) => parseInt(x, 10));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function mType(msg) {
  const target = msg.mentions?.[0];
  if (msg.type === 1) return "add";
  if (msg.type === 3) return "call";
  if (msg.type === 2) return target?.id && target.id !== msg.author?.id ? "kick" : "left";
  if (msg.attachments?.length) return "image";
  return "text";
}

function imgMeta(url) {
  const clean = String(url || "").split(/[?#]/)[0];
  const name = clean.split("/").pop() || "image.jpg";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "jpg";
  const types = {
    gif: "image/gif",
    png: "image/png",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
  };
  return {
    filename: name,
    content_type: types[ext] || "image/jpeg",
  };
}

function imgSize(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve({
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
      });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function mediaUrl(url) {
  if (!/tenor\.com\/view\//i.test(url)) return { url };
  try {
    const r = await fetch(`/api/media/resolve?url=${encodeURIComponent(url)}`);
    const data = await r.json();
    return data?.url ? data : { url };
  } catch {
    return { url };
  }
}

async function makeAtt(url, base = {}, seedMs = Date.now()) {
  const media = await mediaUrl(url);
  const finalUrl = media.url || url;
  const meta = imgMeta(finalUrl);
  const size = await imgSize(finalUrl);
  const same = base.url === finalUrl;
  return {
    ...base,
    id: base.id || genId(seedMs),
    filename: same && base.filename ? base.filename : meta.filename,
    url: finalUrl,
    proxy_url: finalUrl,
    width: size?.width || base.width || 1280,
    height: size?.height || base.height || 720,
    content_type: same && base.content_type ? base.content_type : meta.content_type,
    size: base.size || 100000,
  };
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escA(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function reEsc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionNames(a) {
  return [...new Set([aName(a), a?.username].filter(Boolean))];
}

function editText(s) {
  return String(s ?? "").replace(/<@!?(\d+)>/g, (_, id) => {
    const a = S.authors[id];
    return a ? `@${aName(a)}` : `@${id}`;
  });
}

function msgLabel(m, idx) {
  const name = aName(m.author);
  const body = m.content || (m.attachments?.length ? "[image]" : `[${mType(m)}]`);
  const txt = String(body).replace(/\s+/g, " ").trim();
  return `${idx + 1}. ${name}: ${txt.slice(0, 64) || `[${mType(m)}]`}`;
}

function refMsg(id) {
  return S.msgs.find((m) => m.id === id) || null;
}

function replyOptions(selected = "", skip = "") {
  const opts = ['<option value="">none</option>'];
  S.msgs.forEach((m, i) => {
    if (!m?.id || m.id === skip) return;
    opts.push(
      `<option value="${escA(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(msgLabel(m, i))}</option>`,
    );
  });
  return opts.join("");
}

function applyReply(msg, id) {
  const ref = id ? refMsg(id) : null;
  if (!ref) {
    delete msg.message_reference;
    delete msg.referenced_message;
    if (msg.type === 19) msg.type = 0;
    return;
  }
  msg.type = 19;
  msg.message_reference = {
    channel_id: ref.channel_id || msg.channel_id || S.cfg.channel_id,
    message_id: ref.id,
  };
  msg.referenced_message = structuredClone(ref);
}

function saveText(s) {
  let out = String(s ?? "");
  const ids = new Set();
  out = out.replace(/<@!?(\d+)>/g, (_, id) => {
    if (S.authors[id]) ids.add(id);
    return `<@${id}>`;
  });
  const users = authorList()
    .flatMap((a) => mentionNames(a).map((name) => ({ a, name })))
    .sort((a, b) => b.name.length - a.name.length);
  for (const x of users) {
    const rx = new RegExp(
      `(^|[\\s([{])@${reEsc(x.name)}(?=$|[\\s\\]).,!?;:])`,
      "gi",
    );
    out = out.replace(rx, (m, p) => {
      ids.add(x.a.id);
      return `${p}<@${x.a.id}>`;
    });
  }
  return {
    content: out,
    mentions: Array.from(ids)
      .map((id) => S.authors[id])
      .filter(Boolean),
  };
}

function ensureAuthor(id, name, avatar) {
  if (!id) return;
  const cur = S.authors[id] || {};
  S.authors[id] = {
    id,
    username: name || cur.username || "unknown",
    global_name: name || cur.global_name || cur.username || "unknown",
    avatar: avatar ?? cur.avatar ?? null,
    discriminator: cur.discriminator || "0",
    public_flags: cur.public_flags || 0,
    flags: cur.flags || 0,
    banner: cur.banner ?? null,
    accent_color: cur.accent_color ?? null,
    avatar_decoration_data: cur.avatar_decoration_data ?? null,
    collectibles: cur.collectibles ?? null,
    display_name_styles: cur.display_name_styles ?? null,
    banner_color: cur.banner_color ?? null,
    clan: cur.clan ?? null,
    primary_guild: cur.primary_guild ?? null,
  };
}

function trackAuthors(msgs) {
  for (const m of msgs) {
    const a = m.author;
    if (a?.id) S.authors[a.id] = a;
    for (const x of m.mentions || []) {
      if (x?.id) S.authors[x.id] = x;
    }
  }
  if (Object.keys(S.authors).length > 2) {
    S.cfg.is_group = true;
    const box = document.getElementById("inp-group");
    if (box) box.checked = true;
  }
}

function authorList() {
  return Object.values(S.authors).filter((a) => a?.id);
}

async function fetchUserById(id) {
  try {
    const r = await fetch(`/api/user/${encodeURIComponent(id)}`);
    const data = await r.json();
    if (!r.ok) return { error: data.message || data.error || `HTTP ${r.status}` };
    return data;
  } catch {
    return { error: "local lookup request failed" };
  }
}

function applyAuthor(a) {
  if (!a?.id) return;
  S.authors[a.id] = { ...(S.authors[a.id] || {}), ...a };
  for (const m of S.msgs) {
    if (m.author?.id === a.id) m.author = { ...m.author, ...S.authors[a.id] };
    if (Array.isArray(m.mentions)) {
      m.mentions = m.mentions.map((x) =>
        x?.id === a.id ? { ...x, ...S.authors[a.id] } : x,
      );
    }
  }
}

async function refreshAuthors() {
  const ids = Object.keys(S.authors);
  if (!ids.length) return;
  S.msgs = await collectMsgs();
  let n = 0;
  for (const id of ids) {
    const u = await fetchUserById(id);
    if (!u || u.error) continue;
    applyAuthor(u);
    n++;
  }
  renderUsers();
  render();
  if (n) await writeConfig(`refreshed ${n} + saved`);
}

async function hydrateAuthors(saveAfter = false) {
  const ids = Object.keys(S.authors).filter((id) => isStubAuthor(S.authors[id]));
  if (!ids.length) return 0;
  let n = 0;
  for (const id of ids) {
    const u = await fetchUserById(id);
    if (!u || u.error) continue;
    applyAuthor(u);
    n++;
  }
  if (n && saveAfter) await writeConfig(`updated ${n} + saved`);
  return n;
}

function suggestedName() {
  const names = authorList()
    .map(aName)
    .filter((x) => x && x !== "unknown");
  const unique = [...new Set(names)];
  if (S.cfg.is_group && unique.length)
    return `groupchat of ${unique.slice(0, 6).join(", ")}`;
  if (unique.length) return `chat with ${unique.slice(0, 2).join(", ")}`;
  const cid =
    document.getElementById("inp-ch")?.value.trim() || S.cfg.channel_id;
  return cid ? `channel ${cid}` : "untitled config";
}

async function payload(name, profileId = S.cfg.profile_id) {
  const msgs = await collectMsgs();
  trackAuthors(msgs);
  return {
    profile_id: profileId || null,
    name:
      name ||
      document.getElementById("cfg-name").value.trim() ||
      suggestedName(),
    channel_id: document.getElementById("inp-ch").value.trim(),
    other_user_id: "",
    owner_id: S.cfg.owner_id || "",
    is_group: document.getElementById("inp-group").checked,
    messages: msgs,
    authors: S.authors,
  };
}

function setCfg(data, doRender = true) {
  S.cfg = {
    channel_id: data.channel_id || "",
    is_group: !!data.is_group,
    owner_id: data.owner_id || "",
    name: data.name || "",
    profile_id: data.profile_id || "",
    default_profile: data.default_profile || "",
  };
  S.msgs = data.messages || [];
  S.authors = data.authors || {};
  trackAuthors(S.msgs);
  document.getElementById("inp-ch").value = S.cfg.channel_id;
  document.getElementById("inp-group").checked = S.cfg.is_group;
  document.getElementById("cfg-name").value = S.cfg.name || suggestedName();
  if (doRender) render();
}

function avHtml(a, cls = "msg-av") {
  const color = avColor(a?.id);
  const name = aName(a);
  const init = esc(name[0]?.toUpperCase() || "?");
  const src = avUrl(a);
  return `
    <div class="${cls}" data-color="${escA(color)}">
      <span>${init}</span>
      ${src ? `<img src="${escA(src)}" alt="">` : ""}
    </div>
  `;
}

async function setOwner(id) {
  if (!S.authors[id]) return;
  S.cfg.owner_id = id;
  renderUsers();
  await writeConfig("owner saved");
}

function wireAvatars(root = document) {
  root.querySelectorAll(".msg-av").forEach((el) => {
    el.style.backgroundColor = el.dataset.color || PALETTE[0];
  });
  root.querySelectorAll(".msg-av img").forEach((img) => {
    img.addEventListener("error", () => img.remove());
  });
}

function renderUsers() {
  const list = document.getElementById("user-list");
  const users = authorList();
  const nameEl = document.getElementById("cfg-name");
  if (nameEl && !nameEl.value.trim()) nameEl.value = suggestedName();
  document.getElementById("users-hd").textContent = `users (${users.length})`;
  if (!users.length) {
    list.innerHTML = '<div class="user-empty">no users captured or added</div>';
    return;
  }
  list.innerHTML = "";
  for (const a of users) {
    const el = document.createElement("div");
    const isOwner = a.id === S.cfg.owner_id;
    el.className = `user-item${isOwner ? " is-owner" : ""}`;
    el.innerHTML = `
      ${avHtml(a)}
      <span class="user-name">${esc(aName(a))}</span>
      <span class="user-id">${esc(a.id)}</span>
      <button class="user-own ${isOwner ? "on" : ""}" data-id="${escA(a.id)}">owner</button>
      <button class="user-del" data-id="${escA(a.id)}">&times;</button>
    `;
    el.querySelector(".user-own").addEventListener("click", () => setOwner(a.id));
    el.querySelector(".user-del").addEventListener("click", async () => {
      S.msgs = await collectMsgs();
      if (S.cfg.owner_id === a.id) S.cfg.owner_id = "";
      delete S.authors[a.id];
      renderUsers();
      render();
      await writeConfig("user saved");
    });
    list.appendChild(el);
    wireAvatars(el);
  }
}

function renderProfiles() {
  const sel = document.getElementById("cfg-select");
  sel.innerHTML = "";
  for (const p of S.profiles) {
    const o = document.createElement("option");
    o.value = p.id;
    o.textContent = p.id === S.cfg.default_profile ? `${p.name} *` : p.name;
    sel.appendChild(o);
  }
  sel.value = S.cfg.profile_id;
}

async function loadProfiles() {
  const r = await fetch("/api/profiles");
  const data = await r.json();
  S.profiles = data.profiles || [];
  S.cfg.default_profile = data.default || S.cfg.default_profile;
  renderProfiles();
}

async function loadProfile(id) {
  if (!id) return;
  const r = await fetch(`/api/profiles/${encodeURIComponent(id)}`);
  if (!r.ok) return;
  setCfg(await r.json(), false);
  const n = await hydrateAuthors(false);
  render();
  if (n) await writeConfig(`updated ${n} + saved`);
  await loadProfiles();
}

async function saveProfile(copy = false, makeDefault = false) {
  const body = await payload("", copy ? null : S.cfg.profile_id);
  body.make_default = makeDefault;
  const r = await fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) return;
  setCfg(await r.json(), false);
  const n = await hydrateAuthors(false);
  render();
  if (n) await writeConfig(`updated ${n} + saved`);
  await loadProfiles();
  const ok = document.getElementById("save-ok");
  ok.textContent = makeDefault ? "saved default" : "saved";
  setTimeout(() => {
    ok.textContent = "";
  }, 2000);
}

async function setDefaultProfile() {
  if (!S.cfg.profile_id) return;
  await saveProfile(false, true);
}

async function deleteProfile() {
  if (!S.cfg.profile_id) return;
  if (!confirm("delete this config?")) return;
  await fetch(`/api/profiles/${encodeURIComponent(S.cfg.profile_id)}`, {
    method: "DELETE",
  });
  await loadProfiles();
  const next = S.profiles[0]?.id;
  if (next) await loadProfile(next);
}

function newProfile() {
  S.cfg = {
    channel_id: "",
    is_group: false,
    owner_id: "",
    name: "",
    profile_id: "",
    default_profile: S.cfg.default_profile,
  };
  S.msgs = [];
  S.authors = {};
  document.getElementById("inp-ch").value = "";
  document.getElementById("inp-group").checked = false;
  document.getElementById("cfg-name").value = "untitled config";
  document.getElementById("cfg-select").value = "";
  render();
}

function typeOptions(type) {
  const list =
    type === "system"
      ? ["system", "text", "image", "call", "left", "kick", "add"]
      : ["text", "image", "call", "left", "kick", "add"];
  return list
    .map(
      (x) =>
        `<option value="${x}" ${x === type ? "selected" : ""}>${x}</option>`,
    )
    .join("");
}

function eventTarget(actorId, picked = []) {
  const ids = picked.map((x) => x?.id).filter(Boolean);
  return ids.find((id) => id !== actorId) || ids[0] || authorList().find((a) => a.id !== actorId)?.id || "";
}

function targetOptions(actorId, selected = "") {
  return authorList()
    .filter((a) => a.id !== actorId)
    .map(
      (a) =>
        `<option value="${escA(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(aName(a))}</option>`,
    )
    .join("");
}

function fillEventTargets() {
  const actorId = document.getElementById("add-author").value;
  for (const id of ["kick-target", "add-target"]) {
    const sel = document.getElementById(id);
    const cur = sel.value;
    sel.innerHTML = targetOptions(actorId, cur);
  }
}

function fillReplySelects() {
  document.getElementById("add-text-reply").innerHTML = replyOptions();
  document.getElementById("add-img-reply").innerHTML = replyOptions();
}

function partChecks(picked = []) {
  const ids = new Set(picked.filter(Boolean));
  return authorList()
    .map(
      (a) => `
    <label class="part">
      <input type="checkbox" class="call-part" value="${escA(a.id)}" ${ids.has(a.id) ? "checked" : ""}>
      <span>${esc(aName(a))}</span>
    </label>
  `,
    )
    .join("");
}

function defaultParts(authorId) {
  const ids = authorList().map((a) => a.id);
  if (S.cfg.is_group && ids.length) return ids;
  return authorId ? [authorId] : ids.slice(0, 1);
}

function partIds(root) {
  const ids = Array.from(root.querySelectorAll(".call-part:checked")).map(
    (x) => x.value,
  );
  return ids.length ? ids : [];
}

function convertMsg(msg, type) {
  const out = structuredClone(msg);
  if (type === "system") return out;
  if (type === "text") {
    out.type = 0;
    out.attachments = [];
    delete out.call;
    return out;
  }
  if (type === "image") {
    out.type = 0;
    delete out.call;
    out.attachments = out.attachments?.length
      ? out.attachments
      : [
          {
            id: out.id,
            filename: "image.jpg",
            url: "",
            proxy_url: "",
            width: 0,
            height: 0,
            content_type: "image/jpeg",
            size: 100000,
          },
        ];
    return out;
  }
  if (type === "left") {
    out.type = 2;
    out.content = "";
    out.attachments = [];
    out.embeds = [];
    out.components = [];
    out.mentions = out.author?.id ? [out.author] : [];
    delete out.call;
    return out;
  }
  if (type === "kick" || type === "add") {
    const targetId = eventTarget(out.author?.id, out.mentions || []);
    out.type = type === "add" ? 1 : 2;
    out.content = "";
    out.attachments = [];
    out.embeds = [];
    out.components = [];
    out.mentions = targetId && S.authors[targetId] ? [S.authors[targetId]] : [];
    delete out.call;
    return out;
  }
  out.type = 3;
  out.content = "";
  out.attachments = [];
  out.embeds = [];
  out.components = [];
  out.call = out.call || {
    ended_timestamp: addSeconds(out.timestamp, 30),
    participants: defaultParts(out.author?.id),
  };
  if (!out.call.participants?.length)
    out.call.participants = defaultParts(out.author?.id);
  return out;
}

function renderMsg(msg, idx) {
  const type = mType(msg);
  const a = msg.author || {};
  const name = aName(a);
  const endTs = msg.call?.ended_timestamp || addSeconds(msg.timestamp, 30);

  const el = document.createElement("div");
  el.className = "msg";
  el.dataset.idx = idx;
  el.dataset.type = type;

  let body = "";
  if (type === "text") {
    body = `
      <textarea class="msg-body">${esc(editText(msg.content))}</textarea>
      <label class="reply-lbl">reply to</label>
      <select class="msg-reply">${replyOptions(msg.message_reference?.message_id, msg.id)}</select>
    `;
  } else if (type === "image") {
    const url = msg.attachments[0]?.url || "";
    body = `
      <input class="img-url" type="text" value="${escA(url)}" placeholder="image url">
      <textarea class="msg-body">${esc(editText(msg.content))}</textarea>
      <label class="reply-lbl">reply to</label>
      <select class="msg-reply">${replyOptions(msg.message_reference?.message_id, msg.id)}</select>
      ${url ? `<img class="img-prev" src="${escA(url)}">` : ""}
    `;
  } else if (type === "call") {
    body = `
      <div class="call-row">
        <div>
          <label>started</label>
          <input class="dt-in call-start-in" ${timeAttr()} value="${escA(toTimeValue(msg.timestamp))}" disabled>
        </div>
        <div>
          <label>ended</label>
          <input class="dt-in call-end-in" ${timeAttr()} value="${escA(toTimeValue(endTs))}">
        </div>
        <div>
          <label>lasted</label>
          <input type="text" class="call-len-in" value="${escA(fmtDur(diffMs(msg.timestamp, endTs)))}">
        </div>
      </div>
      <div class="part-list">${partChecks(msg.call?.participants || defaultParts(a.id))}</div>
    `;
  } else if (type === "left") {
    const who = (msg.mentions || [a]).map(aName).join(", ") || name;
    body = `<div class="call-row"><span class="call-lbl">left</span><span>${esc(who)} left</span><span>type 2</span></div>`;
  } else if (type === "kick" || type === "add") {
    const targetId = eventTarget(a.id, msg.mentions || []);
    const action = type === "add" ? "added" : "kicked";
    body = `
      <div class="call-row">
        <span class="call-lbl">${type}</span>
        <span>${esc(name)} ${action}</span>
        <select class="sys-target">${targetOptions(a.id, targetId)}</select>
      </div>
    `;
  } else {
    const who = (msg.mentions || []).map(aName).join(", ") || "unknown";
    body = `<div class="call-row"><span class="call-lbl">system</span><span>type ${esc(msg.type)}</span><span>${esc(who)}</span></div>`;
  }

  el.innerHTML = `
    <div class="msg-hdr">
      ${avHtml(a)}
      <span class="msg-name">${esc(name)}</span>
      <select class="msg-type">${typeOptions(type)}</select>
      <input class="dt-in msg-ts-in" ${timeAttr()} value="${escA(toTimeValue(msg.timestamp))}">
      <button class="msg-del" data-idx="${idx}">&times;</button>
    </div>
    ${body}
  `;

  wireAvatars(el);

  el.querySelector(".msg-del").addEventListener("click", async () => {
    S.msgs = await collectMsgs();
    S.msgs.splice(idx, 1);
    render();
  });

  el.querySelector(".msg-type").addEventListener("change", async (e) => {
    const msgs = await collectMsgs();
    msgs[idx] = convertMsg(msgs[idx], e.target.value);
    S.msgs = msgs;
    render();
  });

  const img = el.querySelector(".img-prev");
  if (img)
    img.addEventListener("error", () => {
      img.style.display = "none";
    });

  const urlIn = el.querySelector(".img-url");
  if (urlIn) {
    urlIn.addEventListener("blur", () => {
      let prev = el.querySelector(".img-prev");
      if (urlIn.value) {
        if (!prev) {
          prev = document.createElement("img");
          prev.className = "img-prev";
          prev.addEventListener("error", () => {
            prev.style.display = "none";
          });
          el.appendChild(prev);
        }
        prev.src = urlIn.value;
        prev.style.display = "";
      } else if (prev) {
        prev.style.display = "none";
      }
    });
  }

  const tsIn = el.querySelector(".msg-ts-in");
  const endIn = el.querySelector(".call-end-in");
  const lenIn = el.querySelector(".call-len-in");
  if (endIn && lenIn) {
    endIn.addEventListener("change", () => {
      lenIn.value = fmtDur(
        diffMs(fromInput(tsIn.value), fromInput(endIn.value)),
      );
    });
    lenIn.addEventListener("change", () => {
      const seconds = parseDur(lenIn.value);
      if (seconds === null) return;
      endIn.value = toTimeValue(addSeconds(fromInput(tsIn.value), seconds));
      lenIn.value = fmtDur(seconds * 1000);
    });
    tsIn.addEventListener("change", () => {
      const seconds = parseDur(lenIn.value);
      if (seconds === null) return;
      endIn.value = toTimeValue(addSeconds(fromInput(tsIn.value), seconds));
    });
  }

  return el;
}

function render() {
  const list = document.getElementById("msg-list");
  document.getElementById("msgs-hd").textContent =
    `messages (${S.msgs.length})`;
  if (!S.msgs.length) {
    list.innerHTML =
      '<div class="no-msgs">no messages -- record or add manually</div>';
    renderUsers();
    return;
  }
  list.innerHTML = "";
  S.msgs.forEach((m, i) => list.appendChild(renderMsg(m, i)));
  applyTimeMode();
  renderUsers();
}

async function collectMsgs() {
  const out = [];
  for (const el of Array.from(document.querySelectorAll(".msg"))) {
    const idx = parseInt(el.dataset.idx, 10);
    const type = el.querySelector(".msg-type")?.value || el.dataset.type;
    const msg = convertMsg(structuredClone(S.msgs[idx]), type);
    const tsEl = el.querySelector(".msg-ts-in");
    if (tsEl?.value) msg.timestamp = fromInput(tsEl.value);

    if (type === "text") {
      const ta = el.querySelector(".msg-body");
      msg.type = 0;
      msg.attachments = [];
      delete msg.call;
      if (ta) {
        const txt = saveText(ta.value);
        msg.content = txt.content;
        msg.mentions = txt.mentions;
      }
      applyReply(msg, el.querySelector(".msg-reply")?.value || "");
    } else if (type === "image") {
      const urlEl = el.querySelector(".img-url");
      const capEl = el.querySelector(".msg-body");
      msg.type = 0;
      delete msg.call;
      if (capEl) {
        const txt = saveText(capEl.value);
        msg.content = txt.content;
        msg.mentions = txt.mentions;
      }
      if (urlEl?.value) {
        const base = msg.attachments?.[0] || {};
        msg.attachments = [await makeAtt(urlEl.value, base, new Date(msg.timestamp).getTime() + 1)];
      } else {
        msg.attachments = [];
      }
      applyReply(msg, el.querySelector(".msg-reply")?.value || "");
    } else if (type === "call") {
      const endEl = el.querySelector(".call-end-in");
      msg.type = 3;
      msg.content = "";
      msg.attachments = [];
      msg.embeds = [];
      msg.components = [];
      msg.mentions = [];
      delete msg.message_reference;
      delete msg.referenced_message;
      msg.call = {
        ...(msg.call || {}),
        ended_timestamp: endEl?.value
          ? fromInput(endEl.value)
          : addSeconds(msg.timestamp, 30),
        participants: partIds(el),
      };
      if (!msg.call.participants.length)
        msg.call.participants = defaultParts(msg.author?.id);
    } else if (type === "left") {
      msg.type = 2;
      msg.content = "";
      msg.attachments = [];
      msg.embeds = [];
      msg.components = [];
      msg.mentions = msg.author?.id ? [msg.author] : [];
      delete msg.message_reference;
      delete msg.referenced_message;
      delete msg.call;
    } else if (type === "kick" || type === "add") {
      const targetId =
        el.querySelector(".sys-target")?.value ||
        eventTarget(msg.author?.id, msg.mentions || []);
      msg.type = type === "add" ? 1 : 2;
      msg.content = "";
      msg.attachments = [];
      msg.embeds = [];
      msg.components = [];
      msg.mentions = targetId && S.authors[targetId] ? [S.authors[targetId]] : [];
      delete msg.message_reference;
      delete msg.referenced_message;
      delete msg.call;
    }
    out.push(msg);
  }
  return out;
}

async function startRecord() {
  const ch = document.getElementById("inp-ch").value.trim();
  const isGroup = document.getElementById("inp-group").checked;
  if (!ch) {
    alert("enter channel id");
    return;
  }

  const r = await fetch("/api/record/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      profile_id: S.cfg.profile_id,
      name: document.getElementById("cfg-name").value.trim() || suggestedName(),
      channel_id: ch,
      other_user_id: "",
      owner_id: S.cfg.owner_id || "",
      is_group: isGroup,
    }),
  });
  if (!r.ok) return;
  const saved = await r.json();

  S.cfg.channel_id = ch;
  S.cfg.name =
    saved.name ||
    document.getElementById("cfg-name").value.trim() ||
    suggestedName();
  S.cfg.profile_id = saved.profile_id || S.cfg.profile_id;
  S.cfg.is_group = isGroup;
  S.cfg.owner_id = saved.owner_id || S.cfg.owner_id || "";
  S.msgs = [];
  await loadProfiles();
  render();

  document.getElementById("btn-rec").classList.add("hidden");
  document.getElementById("btn-stop").classList.remove("hidden");
  document.getElementById("rec-dot").classList.remove("hidden");
  document.getElementById("rec-txt").textContent =
    `recording -- Android Wi-Fi proxy ${saved.proxy_target || "PC_IP:8080"}`;

  S.sse = new EventSource("/api/stream");
  S.sse.onmessage = (e) => {
    const all = JSON.parse(e.data);
    if (!all.length) return;
    S.msgs = all;
    trackAuthors(all);
    render();
  };
  S.sse.onerror = () => {};
}

async function stopRecord() {
  if (S.sse) {
    S.sse.close();
    S.sse = null;
  }

  const r = await fetch("/api/record/stop", { method: "POST" });
  const data = await r.json();

  if (data.messages?.length) {
    S.msgs = data.messages;
    trackAuthors(data.messages);
  }
  if (data.authors) Object.assign(S.authors, data.authors);
  if (data.profile_id) S.cfg.profile_id = data.profile_id;
  if (data.name) S.cfg.name = data.name;
  await loadProfiles();
  render();

  document.getElementById("btn-stop").classList.add("hidden");
  document.getElementById("btn-rec").classList.remove("hidden");
  document.getElementById("rec-dot").classList.add("hidden");
  document.getElementById("rec-txt").textContent =
    `captured ${S.msgs.length} message(s)`;
}

async function writeConfig(label = "") {
  const body = await payload("", S.cfg.profile_id);
  let r;
  try {
    r = await fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    setStatus("server offline", 3000);
    return false;
  }
  if (!r.ok) {
    setStatus("save failed", 3000);
    return false;
  }
  const saved = await r.json();
  const sent = body.messages?.length || 0;
  const got = saved.messages?.length || 0;
  if (got !== sent) {
    setStatus(`save mismatch ${got}/${sent}`, 4000);
    return false;
  }
  S.msgs = saved.messages || body.messages;
  S.authors = saved.authors || S.authors;
  S.cfg.profile_id = saved.profile_id || S.cfg.profile_id;
  S.cfg.name = saved.name || body.name;
  S.cfg.owner_id = saved.owner_id || body.owner_id || "";
  S.cfg.default_profile = saved.default_profile || S.cfg.default_profile;
  document.getElementById("cfg-name").value = S.cfg.name;
  await loadProfiles();
  if (label) setStatus(label, 2000);
  return true;
}

async function save() {
  const msgs = await collectMsgs();
  setStatus(`saving ${msgs.length}...`, 0);
  await writeConfig(`saved ${msgs.length}`);
}

function setTab(tab) {
  S.tab = tab;
  document
    .querySelectorAll(".tab-btn")
    .forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  document
    .querySelectorAll(".tab-pane")
    .forEach((p) => p.classList.toggle("on", p.id === `tab-${tab}`));
}

function fillAuthorSelect() {
  const sel = document.getElementById("add-author");
  sel.innerHTML = "";
  const list = authorList();
  if (!list.length) {
    document.getElementById("no-authors").classList.remove("hidden");
    sel.innerHTML = '<option value="">-- none --</option>';
  } else {
    document.getElementById("no-authors").classList.add("hidden");
    list.forEach((a) => {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = aName(a);
      sel.appendChild(o);
    });
  }
}

function fillAddParts() {
  const sel = document.getElementById("add-author");
  const picked = defaultParts(sel.value);
  document.getElementById("add-call-parts").innerHTML = partChecks(picked);
  fillEventTargets();
}

function syncAddCallEnd() {
  const ts = document.getElementById("add-ts").value;
  const len = parseDur(document.getElementById("add-call-len").value);
  if (!ts || len === null) return;
  document.getElementById("add-call-end").value = toTimeValue(
    addSeconds(fromInput(ts), len),
  );
}

function syncAddCallLen() {
  const ts = document.getElementById("add-ts").value;
  const end = document.getElementById("add-call-end").value;
  if (!ts || !end) return;
  document.getElementById("add-call-len").value = fmtDur(
    diffMs(fromInput(ts), fromInput(end)),
  );
}

function openModal() {
  fillAuthorSelect();
  const iso = nowInput();
  document.getElementById("add-ts").value = iso;
  document.getElementById("add-call-len").value = "00:30";
  syncAddCallEnd();
  fillAddParts();
  document.getElementById("add-content").value = "";
  document.getElementById("add-img").value = "";
  document.getElementById("add-cap").value = "";
  setTab("text");
  fillEventTargets();
  fillReplySelects();
  document.getElementById("modal").classList.remove("hidden");
  applyTimeMode();
}

function closeModal() {
  document.getElementById("modal").classList.add("hidden");
}

function mkMsg(type, authorId, content, ts, extras = {}) {
  const author = S.authors[authorId] || {
    id: authorId || "0",
    username: "unknown",
    global_name: null,
    discriminator: "0",
    avatar: null,
    public_flags: 0,
    flags: 0,
    banner: null,
    accent_color: null,
    avatar_decoration_data: null,
    collectibles: null,
    display_name_styles: null,
    banner_color: null,
    clan: null,
    primary_guild: null,
  };
  const tsIso = fromInput(ts) || new Date().toISOString();
  const sysType = type === "add" ? 1 : type === "kick" || type === "left" ? 2 : 0;
  return {
    type: type === "call" ? 3 : sysType,
    id: nextMsgId(new Date(tsIso).getTime()),
    channel_id:
      document.getElementById("inp-ch").value.trim() || S.cfg.channel_id,
    content: content || "",
    author,
    timestamp: tsIso,
    edited_timestamp: null,
    flags: 0,
    mentions: [],
    mention_roles: [],
    attachments: [],
    embeds: [],
    components: [],
    pinned: false,
    mention_everyone: false,
    tts: false,
    ...extras,
  };
}

async function addConfirm() {
  const authorId = document.getElementById("add-author").value;
  const ts = document.getElementById("add-ts").value;
  if (!ts) {
    alert("set a timestamp");
    return;
  }

  let msg;
  if (S.tab === "text") {
    const txt = saveText(document.getElementById("add-content").value);
    msg = mkMsg("text", authorId, txt.content, ts, { mentions: txt.mentions });
    applyReply(msg, document.getElementById("add-text-reply").value);
  } else if (S.tab === "image") {
    const url = document.getElementById("add-img").value.trim();
    if (!url) {
      alert("enter image url");
      return;
    }
    const cap = saveText(document.getElementById("add-cap").value);
    const att = await makeAtt(url, {}, new Date(fromInput(ts)).getTime() + 1);
    msg = mkMsg("image", authorId, cap.content, ts, {
      attachments: [att],
      mentions: cap.mentions,
    });
    applyReply(msg, document.getElementById("add-img-reply").value);
  } else if (S.tab === "left") {
    const author = S.authors[authorId];
    if (!author) {
      alert("pick a user");
      return;
    }
    msg = mkMsg("left", authorId, "", ts, { mentions: [author] });
  } else if (S.tab === "kick" || S.tab === "add") {
    const targetId = document.getElementById(`${S.tab}-target`).value;
    const target = S.authors[targetId];
    if (!S.authors[authorId]) {
      alert("pick who did it");
      return;
    }
    if (!target) {
      alert(`pick who got ${S.tab === "add" ? "added" : "kicked"}`);
      return;
    }
    msg = mkMsg(S.tab, authorId, "", ts, { mentions: [target] });
  } else {
    const endVal = document.getElementById("add-call-end").value;
    const parts = partIds(document.getElementById("add-call-parts"));
    msg = mkMsg("call", authorId, "", ts, {
      call: {
        ended_timestamp: fromInput(endVal) || addSeconds(fromInput(ts), 30),
        participants: parts.length ? parts : defaultParts(authorId),
      },
    });
  }

  S.msgs.unshift(msg);
  trackAuthors(S.msgs);
  render();
  closeModal();
  await writeConfig("message saved");
}

async function addUser() {
  const id = document.getElementById("user-id").value.trim();
  const name = document.getElementById("user-name").value.trim();
  const avatar = document.getElementById("user-avatar").value.trim();
  if (!id) {
    alert("enter user id");
    return;
  }
  const btn = document.getElementById("btn-user-add");
  const txt = btn.textContent;
  btn.disabled = true;
  btn.textContent = "adding";

  try {
    S.msgs = await collectMsgs();
    let u = null;
    if (/^\d{17,20}$/.test(id)) u = await fetchUserById(id);
    const hit = u && !u.error ? u : null;
    if (!hit && !name && !avatar) {
      alert(u?.error || "user lookup failed; open/load Discord first or enter a display name");
      return;
    }
    ensureAuthor(
      id,
      name || hit?.global_name || hit?.username || `user-${id.slice(-4)}`,
      avatar || hit?.avatar || null,
    );
    applyAuthor(
      hit
        ? {
            ...hit,
            username: name || hit.username,
            global_name: name || hit.global_name || hit.username,
            avatar: avatar || hit.avatar,
          }
        : S.authors[id],
    );

    document.getElementById("user-id").value = "";
    document.getElementById("user-name").value = "";
    document.getElementById("user-avatar").value = "";
    if (authorList().length > 2) {
      S.cfg.is_group = true;
      document.getElementById("inp-group").checked = true;
    }
    renderUsers();
    render();
    await writeConfig("user saved");
  } finally {
    btn.disabled = false;
    btn.textContent = txt;
  }
}

async function init() {
  const r = await fetch("/api/config");
  const data = await r.json();
  setCfg(data, false);
  document.getElementById("time-24").checked = S.pref.time24;
  applyTimeMode();
  const n = await hydrateAuthors(false);
  render();
  if (n) await writeConfig(`updated ${n} + saved`);
  await loadProfiles();

  document.getElementById("btn-rec").addEventListener("click", startRecord);
  document.getElementById("btn-stop").addEventListener("click", stopRecord);
  document.getElementById("btn-save").addEventListener("click", save);
  document
    .getElementById("cfg-select")
    .addEventListener("change", (e) => loadProfile(e.target.value));
  document.getElementById("btn-cfg-new").addEventListener("click", newProfile);
  document
    .getElementById("btn-cfg-save")
    .addEventListener("click", () => saveProfile(false, false));
  document
    .getElementById("btn-cfg-copy")
    .addEventListener("click", () => saveProfile(true, false));
  document
    .getElementById("btn-cfg-default")
    .addEventListener("click", setDefaultProfile);
  document
    .getElementById("btn-cfg-del")
    .addEventListener("click", deleteProfile);
  document.getElementById("btn-add").addEventListener("click", openModal);
  document.getElementById("btn-add-ok").addEventListener("click", addConfirm);
  document
    .getElementById("btn-add-cancel")
    .addEventListener("click", closeModal);
  document.getElementById("btn-user-add").addEventListener("click", addUser);
  document
    .getElementById("btn-refresh-authors")
    .addEventListener("click", refreshAuthors);
  document.getElementById("inp-group").addEventListener("change", (e) => {
    S.cfg.is_group = e.target.checked;
  });
  document.getElementById("time-24").addEventListener("change", (e) => {
    S.pref.time24 = e.target.checked;
    localStorage.setItem("time24", S.pref.time24 ? "1" : "0");
    applyTimeMode();
    render();
  });
  document.getElementById("add-ts").addEventListener("change", syncAddCallEnd);
  document
    .getElementById("add-call-len")
    .addEventListener("change", syncAddCallEnd);
  document
    .getElementById("add-call-end")
    .addEventListener("change", syncAddCallLen);
  document
    .getElementById("add-author")
    .addEventListener("change", fillAddParts);

  let _idTimer = null;
  document.getElementById("user-id").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    clearTimeout(_idTimer);
    if (!/^\d{17,20}$/.test(v)) return;
    _idTimer = setTimeout(async () => {
      const u = await fetchUserById(v);
      if (!u || u.error) return;
      if (document.getElementById("user-id").value.trim() !== v) return;
      const nameEl = document.getElementById("user-name");
      const avEl = document.getElementById("user-avatar");
      if (!nameEl.value) nameEl.value = u.global_name || u.username || "";
      if (!avEl.value) avEl.value = u.avatar || "";
    }, 400);
  });

  document.getElementById("btn-prx-off").addEventListener("click", async () => {
    await fetch("/api/proxy/stop", { method: "POST" });
    document.getElementById("rec-dot").classList.add("hidden");
    document.getElementById("rec-txt").textContent = "proxy stopped";
  });

  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => setTab(b.dataset.tab));
  });

  document.getElementById("modal").addEventListener("click", (e) => {
    if (e.target.id === "modal") closeModal();
  });

}

document.addEventListener("DOMContentLoaded", init);
