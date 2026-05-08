import { createMockClients } from "./mockData.js";
import {
  bulkUpsertClients,
  deleteClientRemote,
  deleteInsight,
  deleteMonthlyRecord,
  getClients,
  getInsights,
  getSettings,
  isRemoteStorageEnabled,
  saveClient,
  saveMonthlyRecord,
  saveRemoteComment,
  saveRemoteSettings,
} from "./storageService.js";

const STORAGE_KEY = "order-history-clients-v1";
const SETTINGS_KEY = "order-history-settings-v1";
const AI_KEY = "order-history-ai-insights-v1";
let remoteSyncTimer = null;

export function loadClients() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    if (isRemoteStorageEnabled()) return [];
    const seeded = createMockClients();
    saveClients(seeded);
    return seeded;
  }
  try {
    const clients = JSON.parse(raw);
    return migrateClients(clients);
  } catch {
    if (isRemoteStorageEnabled()) return [];
    const seeded = createMockClients();
    saveClients(seeded);
    return seeded;
  }
}

export function saveClients(clients) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clients));
  scheduleRemoteClientSync(clients);
}

export function resetDemoData() {
  const seeded = createMockClients();
  saveClients(seeded);
  return seeded;
}

export function loadSettings() {
  const defaults = { year: 2026, tolerance: 10 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  if (isRemoteStorageEnabled()) {
    saveRemoteSettings(settings).catch((error) => notifyRemoteError(error));
  }
}

export function loadAiState() {
  const defaults = { credits: 100, analyses: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(AI_KEY) || "{}");
    return {
      credits: Number.isFinite(Number(saved.credits)) ? Number(saved.credits) : defaults.credits,
      analyses: Array.isArray(saved.analyses) ? saved.analyses : defaults.analyses,
    };
  } catch {
    return defaults;
  }
}

export function persistAiState(aiState) {
  localStorage.setItem(AI_KEY, JSON.stringify({
    credits: aiState.credits,
    analyses: aiState.analyses || [],
  }));
}

export function saveAiState(aiState) {
  persistAiState(aiState);
}

export async function hydrateRemoteState() {
  if (!isRemoteStorageEnabled()) return { remote: false };
  const [clientsResult, settingsResult, insightsResult] = await Promise.allSettled([
    getClients(),
    getSettings(),
    getInsights(),
  ]);

  const result = { remote: true };
  if (clientsResult.status === "fulfilled" && Array.isArray(clientsResult.value.clients)) {
    result.clients = migrateClients(clientsResult.value.clients);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result.clients));
  }
  if (settingsResult.status === "fulfilled" && settingsResult.value.settings) {
    result.settings = { ...loadSettings(), ...settingsResult.value.settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(result.settings));
  }
  if (insightsResult.status === "fulfilled" && Array.isArray(insightsResult.value.analyses)) {
    const current = loadAiState();
    result.ai = {
      credits: current.credits,
      analyses: insightsResult.value.analyses,
    };
    localStorage.setItem(AI_KEY, JSON.stringify(result.ai));
  }

  const rejected = [clientsResult, settingsResult, insightsResult].find((item) => item.status === "rejected");
  if (rejected) notifyRemoteError(rejected.reason);
  return result;
}

export function removeRemoteInsight(insightId) {
  if (!isRemoteStorageEnabled()) return;
  deleteInsight(insightId).catch((error) => notifyRemoteError(error));
}

export function syncRemoteClient(client) {
  if (!isRemoteStorageEnabled() || !client) return;
  saveClient(client).catch((error) => notifyRemoteError(error));
}

export function removeRemoteClient(clientId) {
  if (!isRemoteStorageEnabled() || !clientId) return;
  deleteClientRemote(clientId).catch((error) => notifyRemoteError(error));
}

export function syncRemoteMonthlyRecord(clientId, record) {
  if (!isRemoteStorageEnabled() || !clientId || !record) return;
  saveMonthlyRecord(clientId, record).catch((error) => notifyRemoteError(error));
}

export function removeRemoteMonthlyRecord(clientId, competencia) {
  if (!isRemoteStorageEnabled() || !clientId || !competencia) return;
  deleteMonthlyRecord(clientId, competencia).catch((error) => notifyRemoteError(error));
}

export function syncRemoteComment(clientId, comment) {
  if (!isRemoteStorageEnabled() || !clientId || !comment) return;
  saveRemoteComment(clientId, comment).catch((error) => notifyRemoteError(error));
}

function migrateClients(clients) {
  return clients.map((client) => ({
    active: client.active !== false,
    dashboardActive: client.dashboardActive !== false,
    cnpj: "",
    erp: "",
    segment: "",
    owner: "",
    notes: "",
    ...client,
    records: (client.records || []).map((record) => ({
      id: record.id || crypto.randomUUID(),
      source: record.source || "importado",
      observation: record.observation || "",
      ...record,
    })),
    comments: client.comments || [],
  }));
}

function scheduleRemoteClientSync(clients) {
  if (!isRemoteStorageEnabled()) return;
  clearTimeout(remoteSyncTimer);
  const snapshot = JSON.parse(JSON.stringify(clients));
  remoteSyncTimer = setTimeout(() => {
    bulkUpsertClients(snapshot).catch((error) => notifyRemoteError(error));
  }, 700);
}

function notifyRemoteError(error) {
  window.dispatchEvent?.(new CustomEvent("remote-storage-error", {
    detail: { message: error?.message || "Falha na persistencia online." },
  }));
}
