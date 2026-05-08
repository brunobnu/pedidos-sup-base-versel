const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    const missing = [
      !SUPABASE_URL && "SUPABASE_URL",
      !SERVICE_ROLE_KEY && "SUPABASE_SERVICE_ROLE_KEY",
    ].filter(Boolean).join(", ");
    const error = new Error(`Supabase nao configurado. Variavel ausente: ${missing}.`);
    error.statusCode = 500;
    throw error;
  }
}

async function readBody(req) {
  if (req.body && Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8") || "{}");
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8_000_000) reject(new Error("Payload muito grande."));
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function send(res, status, payload = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function error(res, err, fallback = "Falha na API.") {
  const status = Number(err?.statusCode || err?.status || 500);
  const message = err?.message || fallback;
  send(res, status, { error: message });
}

async function supabaseRequest(path, options = {}) {
  assertSupabaseConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    method: options.method || "GET",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.prefer ? { Prefer: options.prefer } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const err = new Error(payload?.message || payload?.error || "Falha ao acessar Supabase.");
    err.statusCode = response.status;
    throw err;
  }
  return payload;
}

async function fetchClients() {
  const rows = await supabaseRequest("clients?select=*,monthly_records(*),comments(*)&order=name.asc");
  return { clients: (rows || []).map(mapClientRow) };
}

async function fetchInsights() {
  const rows = await supabaseRequest("ai_insights?select=*,clients(name)&order=created_at.desc");
  return { analyses: (rows || []).map(mapInsightRow) };
}

async function getLatestSettings() {
  const rows = await supabaseRequest("settings?select=*&order=created_at.desc&limit=1");
  const row = rows?.[0];
  return {
    settings: row
      ? {
          year: Number(row.active_year),
          tolerance: Number(row.tolerance),
          method: row.forecast_method || "historicalMonthly",
          forecastMethod: row.forecast_method || "historicalMonthly",
        }
      : null,
  };
}

async function saveSettings(settings) {
  const current = await supabaseRequest("settings?select=*&order=created_at.desc&limit=1");
  const row = {
    active_year: Number(settings.year || settings.activeYear || 2026),
    tolerance: Number(settings.tolerance || 10),
    forecast_method: settings.method || settings.forecastMethod || "historicalMonthly",
  };
  if (current?.[0]?.id) {
    const rows = await supabaseRequest(`settings?id=eq.${encodeURIComponent(current[0].id)}&select=*`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    });
    return { settings: mapSettingsRow(rows?.[0]) };
  }
  const rows = await supabaseRequest("settings?select=*", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  return { settings: mapSettingsRow(rows?.[0]) };
}

async function upsertClient(client, options = {}) {
  if (!client?.name) {
    const err = new Error("Nome do cliente obrigatorio.");
    err.statusCode = 400;
    throw err;
  }
  const row = clientToRow(client);
  const existing = await findClientByKey(row.client_key);
  if (existing) {
    if (options.preserveFlags) {
      row.active = existing.active;
      row.dashboard_active = existing.dashboard_active;
    }
    const rows = await supabaseRequest(`clients?id=eq.${encodeURIComponent(existing.id)}&select=*`, {
      method: "PATCH",
      body: row,
      prefer: "return=representation",
    });
    return rows?.[0] || existing;
  }
  if (isUuid(client.id)) row.id = client.id;
  const rows = await supabaseRequest("clients?select=*", {
    method: "POST",
    body: row,
    prefer: "return=representation",
  });
  return rows?.[0];
}

async function deleteClient(clientId) {
  if (!isUuid(clientId)) return { ok: true };
  await supabaseRequest(`clients?id=eq.${encodeURIComponent(clientId)}`, { method: "DELETE" });
  return { ok: true };
}

async function upsertRecord(clientId, record) {
  if (!isUuid(clientId)) {
    const err = new Error("Cliente invalido para salvar competencia.");
    err.statusCode = 400;
    throw err;
  }
  if (!/^\d{4}-\d{2}$/.test(record?.competencia || "")) {
    const err = new Error("Competencia invalida.");
    err.statusCode = 400;
    throw err;
  }
  const body = {
    client_id: clientId,
    competencia: record.competencia,
    quantity: Number(record.quantity) || 0,
    source: record.source || "manual",
    observation: record.observation || "",
  };
  const rows = await supabaseRequest("monthly_records?on_conflict=client_id,competencia&select=*", {
    method: "POST",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
  return { record: mapRecordRow(rows?.[0]) };
}

async function deleteRecord(clientId, competencia) {
  if (!isUuid(clientId) || !competencia) return { ok: true };
  await supabaseRequest(`monthly_records?client_id=eq.${encodeURIComponent(clientId)}&competencia=eq.${encodeURIComponent(competencia)}`, { method: "DELETE" });
  return { ok: true };
}

async function insertComment(clientId, comment) {
  if (!isUuid(clientId)) {
    const err = new Error("Cliente invalido para salvar comentario.");
    err.statusCode = 400;
    throw err;
  }
  const body = {
    client_id: clientId,
    competencia: comment.competencia || null,
    observation: comment.observation || "",
    reason: comment.reason || "",
    owner: comment.owner || "",
    next_action: comment.nextAction || comment.next_action || "",
    action_date: comment.actionDate || comment.action_date || "",
  };
  if (isUuid(comment.id)) body.id = comment.id;
  const rows = await supabaseRequest("comments?select=*", {
    method: "POST",
    body,
    prefer: "return=representation",
  });
  return { comment: mapCommentRow(rows?.[0]) };
}

async function fetchComments(clientId) {
  if (!isUuid(clientId)) return { comments: [] };
  const rows = await supabaseRequest(`comments?client_id=eq.${encodeURIComponent(clientId)}&select=*&order=created_at.desc`);
  return { comments: (rows || []).map(mapCommentRow) };
}

async function saveInsight(payload) {
  const insight = payload.insight || payload;
  const body = {
    client_id: isUuid(insight.clientId) ? insight.clientId : null,
    months_ahead: Number(insight.monthsAhead || 3),
    result: insight.result || {},
    input: insight.input || {},
    credits_used: Number(insight.creditsUsed || insight.credits_used || 10),
    created_by: insight.createdBy || insight.user?.email || insight.user?.name || "",
  };
  if (isUuid(insight.id)) body.id = insight.id;
  const rows = await supabaseRequest("ai_insights?select=*,clients(name)", {
    method: "POST",
    body,
    prefer: "return=representation",
  });
  return { analysis: mapInsightRow(rows?.[0]) };
}

async function deleteInsight(insightId) {
  if (!isUuid(insightId)) return { ok: true };
  await supabaseRequest(`ai_insights?id=eq.${encodeURIComponent(insightId)}`, { method: "DELETE" });
  return { ok: true };
}

async function bulkUpsertClients(clients) {
  const imported = consolidateClients(Array.isArray(clients) ? clients : []);
  let importedCount = 0;
  let updatedRecords = 0;
  for (const client of imported) {
    const saved = await upsertClient(client, { preserveFlags: true });
    if (!saved?.id) continue;
    importedCount += 1;
    for (const record of client.records || []) {
      await upsertRecord(saved.id, record);
      updatedRecords += 1;
    }
    for (const comment of client.comments || []) {
      if (comment.id && await commentExists(comment.id)) continue;
      await insertComment(saved.id, comment);
    }
  }
  const result = await fetchClients();
  return { ...result, imported: importedCount, updatedRecords };
}

async function commentExists(commentId) {
  if (!isUuid(commentId)) return false;
  const rows = await supabaseRequest(`comments?id=eq.${encodeURIComponent(commentId)}&select=id&limit=1`);
  return !!rows?.length;
}

async function findClientByKey(clientKey) {
  const rows = await supabaseRequest(`clients?client_key=eq.${encodeURIComponent(clientKey)}&select=*&limit=1`);
  return rows?.[0] || null;
}

function clientToRow(client) {
  return {
    client_key: clientKey(client.name),
    name: String(client.name || "").trim(),
    cnpj: client.cnpj || "",
    erp: client.erp || "",
    segment: client.segment || "",
    owner: client.owner || "",
    notes: client.notes || "",
    active: client.active !== false,
    dashboard_active: client.dashboardActive !== false,
  };
}

function mapClientRow(row) {
  return {
    id: row.id,
    name: row.name || "",
    cnpj: row.cnpj || "",
    erp: row.erp || "",
    segment: row.segment || "",
    owner: row.owner || "",
    notes: row.notes || "",
    active: row.active !== false,
    dashboardActive: row.dashboard_active !== false,
    importedAt: row.created_at,
    records: (row.monthly_records || []).map(mapRecordRow).sort((a, b) => a.competencia.localeCompare(b.competencia)),
    comments: (row.comments || []).map(mapCommentRow).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

function mapRecordRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    competencia: row.competencia,
    quantity: Number(row.quantity) || 0,
    source: row.source || "importado",
    observation: row.observation || "",
  };
}

function mapCommentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    competencia: row.competencia || "",
    observation: row.observation || "",
    reason: row.reason || "",
    owner: row.owner || "",
    nextAction: row.next_action || "",
    actionDate: row.action_date || "",
    createdAt: row.created_at,
  };
}

function mapInsightRow(row) {
  if (!row) return null;
  const clientName = row.clients?.name || row.input?.clientName || "";
  const createdBy = row.created_by || "";
  return {
    id: row.id,
    clientId: row.client_id,
    clientName,
    monthsAhead: Number(row.months_ahead || 3),
    createdAt: row.created_at,
    user: createdBy ? { name: createdBy, email: createdBy } : null,
    result: row.result || {},
    input: row.input || {},
    creditsUsed: Number(row.credits_used || 0),
  };
}

function mapSettingsRow(row) {
  if (!row) return null;
  return {
    year: Number(row.active_year),
    tolerance: Number(row.tolerance),
    method: row.forecast_method || "historicalMonthly",
    forecastMethod: row.forecast_method || "historicalMonthly",
  };
}

function consolidateClients(clients) {
  const byKey = new Map();
  clients.forEach((client) => {
    if (!client?.name) return;
    const key = clientKey(client.name);
    const found = byKey.get(key);
    if (!found) {
      byKey.set(key, { ...client, records: [...(client.records || [])], comments: [...(client.comments || [])] });
      return;
    }
    found.name = preferredName(found.name, client.name);
    found.records = mergeRecords(found.records, client.records || []);
    found.comments.push(...(client.comments || []));
    ["cnpj", "erp", "segment", "owner", "notes"].forEach((field) => {
      found[field] ||= client[field] || "";
    });
    found.active = found.active !== false || client.active !== false;
    found.dashboardActive = found.dashboardActive !== false || client.dashboardActive !== false;
  });
  return [...byKey.values()];
}

function mergeRecords(current, incoming) {
  const byCompetencia = new Map((current || []).map((record) => [record.competencia, record]));
  (incoming || []).forEach((record) => byCompetencia.set(record.competencia, { ...record }));
  return [...byCompetencia.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

function preferredName(current, next) {
  return String(next || "").length > String(current || "").length ? next : current;
}

function clientKey(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  const aliases = {
    arvoredo: "carnesarvoredo",
    carnesarvoredo: "carnesarvoredo",
    sucosspres: "sucosspress",
    sucosspress: "sucosspress",
    ceramicatupiguarany: "ceramicatupi",
    ceramicatupi: "ceramicatupi",
    criativapuxadores: "criativa",
    criativa: "criativa",
    grupoello: "ello",
    ello: "ello",
    fcvnutricaoanimal: "fcvnutricaoanimal",
    azeitesmallaguena: "azeitemalaguena",
    azeitemalaguena: "azeitemalaguena",
  };
  return aliases[normalized] || normalized;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

module.exports = {
  bulkUpsertClients,
  deleteClient,
  deleteInsight,
  deleteRecord,
  error,
  fetchClients,
  fetchComments,
  fetchInsights,
  getLatestSettings,
  insertComment,
  mapInsightRow,
  readBody,
  saveInsight,
  saveSettings,
  send,
  upsertClient,
  upsertRecord,
};
