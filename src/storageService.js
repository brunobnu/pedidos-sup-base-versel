const REMOTE_TIMEOUT_MS = 18000;

export function isRemoteStorageEnabled() {
  return location.protocol !== "file:";
}

export async function getClients() {
  return apiRequest("/api/clients");
}

export async function saveClient(client) {
  return apiRequest("/api/save-client", { method: "POST", body: { client } });
}

export async function updateClient(client) {
  return saveClient(client);
}

export async function deleteClientRemote(clientId) {
  return apiRequest("/api/delete-client", { method: "POST", body: { clientId } });
}

export async function saveMonthlyRecord(clientId, record) {
  return apiRequest("/api/save-record", { method: "POST", body: { clientId, record } });
}

export async function deleteMonthlyRecord(clientId, competencia) {
  return apiRequest("/api/delete-record", { method: "POST", body: { clientId, competencia } });
}

export async function saveRemoteComment(clientId, comment) {
  return apiRequest("/api/save-comment", { method: "POST", body: { clientId, comment } });
}

export async function getComments(clientId) {
  return apiRequest(`/api/comments?clientId=${encodeURIComponent(clientId)}`);
}

export async function saveInsight(insight) {
  return apiRequest("/api/save-insight", { method: "POST", body: { insight } });
}

export async function getInsights() {
  return apiRequest("/api/ai-insights");
}

export async function deleteInsight(insightId) {
  return apiRequest("/api/delete-insight", { method: "POST", body: { insightId } });
}

export async function getSettings() {
  return apiRequest("/api/settings");
}

export async function saveRemoteSettings(settings) {
  return apiRequest("/api/settings", { method: "POST", body: { settings } });
}

export async function bulkUpsertClients(clients) {
  return apiRequest("/api/import-clients", { method: "POST", body: { clients } });
}

async function apiRequest(path, options = {}) {
  if (!isRemoteStorageEnabled()) throw new Error("Persistencia remota indisponivel no modo arquivo local.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: options.method || "GET",
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Falha na API.");
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
