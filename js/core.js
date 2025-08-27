// js/core.js
"use strict";

/* =========================
   CONFIG
========================= */
export const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbyiIgqviJRTKLmAGD1J0UcMzz6nF42F-m4PL9tQ_yU5K92lghGeEJ8b_gtzws0JWkIr/exec";
export const SHEETS_KEY = "rocketdashartigos";

// Senha de exclusão
export const DELETE_PASSWORD = "rocketgroup";
export const CASE_INSENSITIVE = true;

// LocalStorage keys
const LS_DATA_KEY = "dash_artigos_data_v1";
const LS_OUTBOX_KEY = "dash_artigos_outbox_v2";
const LS_LAST_UPDATED = "dash_artigos_last_updated_v1";

// Retry/outbox
export const RETRY_INTERVAL_MS = 15000;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 5 * 60_000;

// Polling entre dispositivos
export const SERVER_REFRESH_MS = 5000;

/* =========================
   UTILS
========================= */
export const uid = () =>
  (crypto?.randomUUID?.() ||
    (Date.now().toString(36) + Math.random().toString(36).slice(2, 10))
  ).toUpperCase();

export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[m]));

export function sanitizeURL(url) {
  try { const u = new URL(url); return (u.protocol === "http:" || u.protocol === "https:") ? u.href : ""; }
  catch { return ""; }
}

// normalização de senha
const norm = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, "")
    .replace(/[\u00A0\u202F\u3000]/g, " ")
    .trim();

export const normalizeForCompare = s => {
  const n = norm(s);
  return CASE_INSENSITIVE ? n.toLowerCase() : n;
};
export const PASS_NORM = normalizeForCompare(DELETE_PASSWORD);

/* =========================
   ESTADO
========================= */
export let campanhas = JSON.parse(localStorage.getItem(LS_DATA_KEY) || "[]");
export let outbox = JSON.parse(localStorage.getItem(LS_OUTBOX_KEY) || "[]");
let lastUpdatedMs = Number(localStorage.getItem(LS_LAST_UPDATED) || "0") || 0;

export const saveData = () => localStorage.setItem(LS_DATA_KEY, JSON.stringify(campanhas));
export const saveOutbox = () => localStorage.setItem(LS_OUTBOX_KEY, JSON.stringify(outbox));
const saveLastUpdated = (ms) => {
  lastUpdatedMs = Number(ms) || 0;
  localStorage.setItem(LS_LAST_UPDATED, String(lastUpdatedMs));
};

/* =========================
   BACK-END (Apps Script)
========================= */
async function call(op, payload) {
  const body = new URLSearchParams({
    key: SHEETS_KEY,
    op,
    data: JSON.stringify(payload || {})
  }).toString();

  const res = await fetch(WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  if (!json.ok) throw new Error(json.error || "Falha no Apps Script.");
  return json;
}

export async function sendToSheets(payload, op) {
  const json = await call(op || "insert", payload);
  if (json.last_updated) saveLastUpdated(json.last_updated);
  return json;
}

/* =========================
   READ com fallback robusto
========================= */
export async function listFromSheets() {
  // 1) PRIMEIRO CARREGAMENTO: sem lastUpdated -> traga TUDO
  if (!lastUpdatedMs || !Number.isFinite(lastUpdatedMs) || lastUpdatedMs <= 0) {
    const full = await call("read", {}); // sem 'since' para forçar retorno completo
    if (full.last_updated) saveLastUpdated(full.last_updated);
    const rows = Array.isArray(full.rows) ? full.rows : [];
    return rows
      .map(r => ({
        id: String(r.id || ""),
        status: r.status || "ATIVO",
        tema: r.tema || "",
        categoria: r.categoria || "",
        link_artigo: r.link_artigo || "",
        link_drive: r.link_drive || "",
        pais: r.pais || "",
        plataforma: r.plataforma || "",
        link_criativos: r.link_criativos || "",
        idioma: r.idioma || "",
        updated: r.updated
      }))
      .filter(x => x.id);
  }

  // 2) INCREMENTAL: temos lastUpdated -> tenta diff
  const diff = await call("read", { since: lastUpdatedMs });
  // a) se servidor disser 'unchanged', mantenha local
  if (diff.unchanged) {
    // b) MAS se local estiver vazio, faz fallback para leitura completa (conserta “vazio até criar algo novo”)
    if (!Array.isArray(campanhas) || campanhas.length === 0) {
      const full = await call("read", {}); // força full read
      if (full.last_updated) saveLastUpdated(full.last_updated);
      const rowsFull = Array.isArray(full.rows) ? full.rows : [];
      return rowsFull
        .map(r => ({
          id: String(r.id || ""),
          status: r.status || "ATIVO",
          tema: r.tema || "",
          categoria: r.categoria || "",
          link_artigo: r.link_artigo || "",
          link_drive: r.link_drive || "",
          pais: r.pais || "",
          plataforma: r.plataforma || "",
          link_criativos: r.link_criativos || "",
          idioma: r.idioma || "",
          updated: r.updated
        }))
        .filter(x => x.id);
    }
    return campanhas;
  }

  if (diff.last_updated) saveLastUpdated(diff.last_updated);
  const rows = Array.isArray(diff.rows) ? diff.rows : [];
  return rows
    .map(r => ({
      id: String(r.id || ""),
      status: r.status || "ATIVO",
      tema: r.tema || "",
      categoria: r.categoria || "",
      link_artigo: r.link_artigo || "",
      link_drive: r.link_drive || "",
      pais: r.pais || "",
      plataforma: r.plataforma || "",
      link_criativos: r.link_criativos || "",
      idioma: r.idioma || "",
      updated: r.updated
    }))
    .filter(x => x.id);
}

/* =========================
   OUTBOX
========================= */
export function enqueue(row, op) {
  outbox.push({ row, op, attempts: 0, nextAttemptAt: Date.now(), lastError: null });
  saveOutbox();
}
const nextDelay = n => Math.min(BASE_BACKOFF_MS * 2 ** n, MAX_BACKOFF_MS);

export function pendingIdsFromOutbox() {
  try {
    return (outbox || [])
      .map(x => x && x.row && x.row.id)
      .filter(Boolean);
  } catch { return []; }
}

export async function drainOutbox(force = false) {
  if (!navigator.onLine && !force) return 0;
  if (!outbox.length) return 0;

  const now = Date.now();
  const still = [];
  let sent = 0;

  for (const item of outbox) {
    if (!force && now < item.nextAttemptAt) { still.push(item); continue; }
    try {
      await sendToSheets(item.row, item.op || "insert");
      sent++;
    } catch (err) {
      item.attempts += 1;
      item.lastError = String(err?.message || err);
      item.nextAttemptAt = Date.now() + nextDelay(item.attempts);
      still.push(item);
    }
  }
  outbox = still; saveOutbox();
  return sent;
}

/* =========================
   MERGE — servidor autoritativo
========================= */
const toUpdatedMs = (v) => {
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) return n;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : 0;
};

export function mergeRemoteAuthoritative(localArr, remoteArr) {
  const pending = new Set(pendingIdsFromOutbox());
  const map = new Map();

  for (const r of remoteArr) if (r && r.id) map.set(r.id, r);

  for (const l of localArr) {
    if (!l || !l.id) continue;

    if (map.has(l.id)) {
      const rem = map.get(l.id);
      const a = toUpdatedMs(rem.updated);
      const b = toUpdatedMs(l.updated);
      map.set(l.id, b > a ? l : rem);
    } else {
      if (pending.has(l.id)) map.set(l.id, l);
    }
  }
  return Array.from(map.values());
}

/* =========================
   REFRESH DO SERVIDOR
========================= */
export async function refreshFromServer(onChange) {
  try {
    const remote = await listFromSheets(); // pode vir vazio em caso de planilha vazia
    const merged = mergeRemoteAuthoritative(campanhas, remote);
    if (JSON.stringify(merged) !== JSON.stringify(campanhas)) {
      campanhas = merged;
      saveData();
      onChange?.(campanhas);
    } else if (!campanhas.length && remote.length) {
      // garante render no primeiro carregamento mesmo se arrays iguais por referência
      campanhas = remote;
      saveData();
      onChange?.(campanhas);
    }
  } catch (err) {
    console.warn("[refreshFromServer] falhou:", err?.message || err);
  }
}

/* =========================
   Keepalive ao sair (sendBeacon)
========================= */
function trySendBeacon(op, row) {
  if (!("sendBeacon" in navigator)) return false;
  try {
    const body = new URLSearchParams({
      key: SHEETS_KEY,
      op: op || "insert",
      data: JSON.stringify(row || {})
    }).toString();
    const blob = new Blob([body], { type: "application/x-www-form-urlencoded;charset=UTF-8" });
    return navigator.sendBeacon(WEB_APP_URL, blob);
  } catch { return false; }
}

export function flushOutboxKeepalive() {
  if (!outbox.length) return;
  const toSend = [...outbox];
  outbox = []; saveOutbox();

  for (const item of toSend) {
    const ok = trySendBeacon(item.op, item.row);
    if (!ok) {
      const body = new URLSearchParams({
        key: SHEETS_KEY,
        op: item.op || "insert",
        data: JSON.stringify(item.row || {})
      });
      fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body,
        keepalive: true,
        mode: "cors"
      }).catch(() => {
        outbox.push(item); saveOutbox();
      });
    }
  }
}
