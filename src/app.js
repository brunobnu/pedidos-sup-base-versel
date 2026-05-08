import {
  analyzeClient,
  attainmentForMonth,
  buildClientTable,
  dashboard,
  formatNumber,
  formatPercent,
  getYears,
  percentChange,
  forecastValue,
  projectedYearTotal,
  valueFor,
  yearTotal,
} from "./calculations.js";
import { importFiles } from "./importService.js";
import {
  hydrateRemoteState,
  loadAiState,
  loadClients,
  loadSettings,
  removeRemoteClient,
  removeRemoteInsight,
  removeRemoteMonthlyRecord,
  persistAiState,
  resetDemoData,
  saveClients,
  saveSettings,
  syncRemoteClient,
  syncRemoteComment,
  syncRemoteMonthlyRecord,
} from "./storage.js";
import { exportAllClientsXlsx, exportClientXlsx, exportDashboardPdf } from "./exportService.js";
import { barChart, forecastChart, lineChart, seasonalChart } from "./charts.js";
import { CURRENT_MONTH, CURRENT_YEAR, MONTHS, key } from "./months.js";
import { ProtectedRoute, RequirePermission, authStore, hasPermission } from "./auth.js";

let state = {
  clients: loadClients(),
  settings: loadSettings(),
  ai: loadAiState(),
  user: authStore.getSession(),
  view: "dashboard",
  selectedId: null,
  aiSelectedClientId: null,
  aiSelectedAnalysisId: null,
  aiMonthsAhead: 3,
  aiLoading: false,
  aiError: "",
  attainmentView: "below",
  selectedMonth: null,
  inlineSavedMonth: null,
  collapsedSections: loadCollapsedSections(),
  method: "historicalMonthly",
  filters: { client: "", status: "all", order: "volume", active: "active" },
  importMessages: [],
  pendingImport: null,
  remoteMessage: "",
  editingClient: false,
  editMode: false,
  editingMonth: null,
  clientListScrollTop: 0,
};

state.selectedId = state.clients[0]?.id || null;
state.aiSelectedClientId = state.clients[0]?.id || null;
render();
hydrateOnlineState();
window.addEventListener?.("remote-storage-error", (event) => {
  state.remoteMessage = event.detail?.message || event.message || "Falha na persistencia online.";
  console.warn("Persistencia online:", state.remoteMessage);
  render();
});

async function hydrateOnlineState() {
  try {
    const remote = await hydrateRemoteState();
    if (!remote.remote) return;
    let changed = false;
    state.remoteMessage = "";
    if (Array.isArray(remote.clients)) {
      state.clients = remote.clients;
      if (!state.clients.some((client) => client.id === state.selectedId)) {
        state.selectedId = state.clients[0]?.id || null;
      }
      if (!state.clients.some((client) => client.id === state.aiSelectedClientId)) {
        state.aiSelectedClientId = state.clients[0]?.id || null;
      }
      changed = true;
    }
    if (remote.settings) {
      state.settings = { ...state.settings, ...remote.settings };
      state.method = remote.settings.method || remote.settings.forecastMethod || state.method;
      changed = true;
    }
    if (remote.ai) {
      state.ai = remote.ai;
      state.aiSelectedAnalysisId = state.ai.analyses[0]?.id || state.aiSelectedAnalysisId;
      changed = true;
    }
    if (changed) render();
  } catch (error) {
    state.remoteMessage = error?.message || "Falha na persistencia online.";
    console.warn("Persistencia online:", state.remoteMessage);
    render();
  }
}

function loadCollapsedSections() {
  try {
    return JSON.parse(localStorage.getItem("order-history-collapsed-sections-v1") || "{}");
  } catch {
    return {};
  }
}

function saveCollapsedSections() {
  localStorage.setItem("order-history-collapsed-sections-v1", JSON.stringify(state.collapsedSections));
}

function render() {
  const app = document.getElementById("app");
  app.innerHTML = ProtectedRoute(state.user, `
    <div class="app-shell">
      <aside class="sidebar">
        <div>
          <div class="brand">Pedidos por Cliente</div>
          <nav class="nav">
            ${navButton("dashboard", "Dashboard")}
            ${RequirePermission(state.user, "import", navButton("import", "Importacao"))}
            ${navButton("clients", "Clientes")}
            ${navButton("comments", "Comentarios")}
            ${navButton("ai", "Insights IA")}
            ${navButton("concepts", "Conceitos")}
          </nav>
        </div>
        <div class="user-box">
          <div>
            <strong>${state.user?.name}</strong>
            <span>${roleLabel(state.user?.role)}</span>
          </div>
          <button class="logout-btn" data-action="logout">Sair</button>
        </div>
      </aside>
      <main class="content">${remoteBanner()}${view()}</main>
    </div>`, loginView());
  bind();
  if (state.user) drawCharts();
}

function remoteBanner() {
  if (!state.remoteMessage) return "";
  return `<div class="message error remote-banner">${escapeHtml(state.remoteMessage)}</div>`;
}

function navButton(id, label) {
  return `<button data-view="${id}" class="${state.view === id ? "active" : ""}">${label}</button>`;
}

function view() {
  if (!canViewCurrentRoute()) return dashboardView();
  if (state.view === "import") return importView();
  if (state.view === "clients") return clientsView();
  if (state.view === "comments") return commentsView();
  if (state.view === "ai") return aiInsightsView();
  if (state.view === "concepts") return conceptsView();
  return dashboardView();
}

function loginView() {
  return `<main class="login-screen">
    <section class="login-card">
      <h1>Clic Tecnologia</h1>
      <p>Acesso à análise de pedidos</p>
      <label>E-mail<input class="input" id="loginEmail" type="email" autocomplete="username"></label>
      <label>Senha<input class="input" id="loginPassword" type="password" autocomplete="current-password"></label>
      <button class="btn primary" data-action="login">Entrar</button>
      <div id="loginError" class="message error" style="display:none">Credenciais invalidas.</div>
      <div class="login-hint">
        <strong>Acessos de teste</strong>
        <span>admin@empresa.com / admin123</span>
        <span>usuario@empresa.com / usuario123</span>
      </div>
    </section>
  </main>`;
}

function canViewCurrentRoute() {
  if (state.view === "import" && !can("import")) {
    state.view = "dashboard";
    return false;
  }
  return true;
}

function analysisOptions() {
  const year = Number(state.settings.year || CURRENT_YEAR);
  return { year, currentMonth: year === CURRENT_YEAR ? CURRENT_MONTH : 12, tolerance: Number(state.settings.tolerance || 10) };
}

function header(title, subtitle, tools = "") {
  return `<div class="topbar"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="toolbar">${tools}</div></div>`;
}

function configControls() {
  const years = [...new Set([...getYears(state.clients, state.settings.year), CURRENT_YEAR])].sort((a, b) => b - a);
  const disabled = can("editSettings") ? "" : "disabled";
  return `
    <select class="select" data-change="method" ${disabled}>
      <option value="historicalMonthly" ${state.method === "historicalMonthly" ? "selected" : ""}>Media historica mensal</option>
      <option value="last12" ${state.method === "last12" ? "selected" : ""}>Media ultimos 12 meses</option>
      <option value="last3Years" ${state.method === "last3Years" ? "selected" : ""}>Media ultimos 3 anos</option>
    </select>
    <select class="select compact" data-setting="year" ${disabled}>${years.map((year) => `<option value="${year}" ${Number(state.settings.year) === year ? "selected" : ""}>Ano ${year}</option>`).join("")}</select>
    <label class="setting-inline">Tolerancia <input class="input tiny" type="number" min="1" max="50" data-setting="tolerance" value="${state.settings.tolerance}" ${disabled}>%</label>`;
}

function dashboardView() {
  const options = analysisOptions();
  const data = dashboard(state.clients, state.method, options);
  if (!attainmentGroups(data)[state.attainmentView]) state.attainmentView = "below";
  const activeAttainment = state.attainmentView;
  const selectedAttainment = attainmentGroups(data)[activeAttainment] || [];
  return `
    ${header("Visão geral", "Volume, projeção anual e atingimento mensal.", `${configControls()}${RequirePermission(state.user, "exportData", `<button class="btn" data-action="pdf">Exportar PDF</button><button class="btn primary" data-action="export-all">Exportar XLSX</button>`)}`)}
    <section class="grid cards">
      ${card("Pedidos reais no ano", formatNumber(data.totalCurrent))}
      ${card("Projecao do ano", formatNumber(data.projectedTotal))}
      ${card("Variacao vs ano anterior", formatPercent(data.yoy), data.yoy >= 0 ? "positive" : "negative")}
      ${card("Cresc. / Regular / Obs. / Atencao / Critico", `${data.counts.crescimento || 0} / ${data.counts.regular || 0} / ${data.counts.observacao || 0} / ${data.counts.atencao || 0} / ${data.counts.critico || 0}`)}
    </section>
    <section class="grid split" style="margin-top:16px">
      <div class="panel compact-panel"><h2>Real x projetado</h2>${compactBarRanking(data.rankingVolume.slice(0, 8))}</div>
      <div class="panel"><h2>Atingimento de ${MONTHS[options.currentMonth - 1].label}/${options.year}</h2>
        <div class="mini-kpis">
          ${miniKpi("Bateram", data.attainmentAbove.length, "att-acima", "above", activeAttainment)}
          ${miniKpi("Abaixo", data.attainmentBelow.length, "att-abaixo", "below", activeAttainment)}
          ${miniKpi("Criticos", data.attainmentCritical.length, "att-critico", "critical", activeAttainment)}
          ${miniKpi("Base curta", data.attainmentShort.length, "att-short", "short", activeAttainment)}
        </div>
        <h3 class="list-subtitle">${attainmentTitle(activeAttainment)}</h3>
        ${attainmentList(selectedAttainment)}
      </div>
    </section>
    <section class="grid three" style="margin-top:16px">
      <div class="panel"><h2>Volume real</h2>${rankingList(data.rankingVolume.slice(0, 6), "volume")}</div>
      <div class="panel"><h2>Crescimento</h2>${rankingList(data.rankingGrowth.slice(0, 6), "yoy")}</div>
      <div class="panel"><h2>Queda</h2>${rankingList(data.rankingDrop.slice(0, 6), "yoy")}</div>
    </section>
    <section class="grid two" style="margin-top:16px">
      <div class="panel"><h2>Acima da projeção</h2>${attainmentList(data.attainmentPositive.slice(0, 8))}</div>
      <div class="panel"><h2>Abaixo da projeção</h2>${attainmentList(data.attainmentNegative.slice(0, 8))}</div>
    </section>`;
}

function attainmentGroups(data) {
  return {
    above: data.attainmentAbove,
    below: data.attainmentBelow,
    critical: data.attainmentCritical,
    short: data.attainmentShort,
  };
}

function card(label, value, valueClass = "") {
  return `<div class="card"><span>${label}</span><strong class="${valueClass}">${value}</strong></div>`;
}

function miniKpi(label, value, cls, view, activeView) {
  return `<button class="mini-kpi ${cls} ${view === activeView ? "active" : ""}" data-attainment-view="${view}">
    <span>${label}</span><strong>${value}</strong>
  </button>`;
}

function attainmentTitle(view) {
  return {
    above: "Clientes que bateram a projeção",
    below: "Clientes abaixo da projeção",
    critical: "Clientes críticos",
    short: "Clientes com histórico curto",
  }[view] || "Clientes";
}

function rankingList(items, metric) {
  if (!items.length) return `<p class="muted">Nenhum cliente encontrado.</p>`;
  return `<table><tbody>${items.map(({ client, analysis }) => `
    <tr>
      <td><button class="linklike" data-client="${client.id}">${client.name}</button><br><span class="status ${analysis.status}">${statusLabel(analysis.status)}</span></td>
      <td class="number">${metric === "yoy" ? formatPercent(analysis.yoy) : `${formatNumber(analysis.realizedAccumulated)}<br><span class="muted">Proj. ${formatNumber(analysis.currentProjected)}</span>`}</td>
    </tr>`).join("")}</tbody></table>`;
}

function compactBarRanking(items) {
  if (!items.length) return `<p class="muted">Nenhum cliente encontrado.</p>`;
  const max = Math.max(...items.map((item) => Math.max(item.analysis.realizedAccumulated, item.analysis.currentProjected)), 1);
  return `<div class="bar-list">${items.map(({ client, analysis }, index) => {
    const realizedWidth = Math.max(3, (analysis.realizedAccumulated / max) * 100);
    const projectedWidth = Math.max(3, (analysis.currentProjected / max) * 100);
    return `<button class="bar-row" data-client="${client.id}">
      <span class="bar-rank">${index + 1}</span>
      <span class="bar-name">${client.name}</span>
      <span class="bar-track compare" title="Realizado: ${formatNumber(analysis.realizedAccumulated)} | Projetado: ${formatNumber(analysis.currentProjected)}">
        <span class="bar-projected" style="width:${projectedWidth}%"></span>
        <span class="bar-realized" style="width:${realizedWidth}%"></span>
      </span>
      <strong><span>${formatNumber(analysis.realizedAccumulated)}</span><small>Proj. ${formatNumber(analysis.currentProjected)}</small></strong>
    </button>`;
  }).join("")}</div>`;
}

function attainmentList(items) {
  const filtered = items.filter((item) => item.analysis.monthAttainment.realized !== null);
  if (!filtered.length) return `<p class="muted">Sem realizado para comparar no mes.</p>`;
  return `<table><tbody>${filtered.map(({ client, analysis }) => {
    const att = analysis.monthAttainment;
    return `<tr>
      <td><button class="linklike" data-client="${client.id}">${client.name}</button><br><span class="status ${att.status}">${attainmentLabel(att.status)}</span><br><span class="muted">Real ${formatNumber(att.realized)} | Esperado ${formatNumber(att.expected)}${att.basisCount < 2 ? ` | base ${att.basisCount} ano(s)` : ""}</span></td>
      <td class="number">${formatNumber(att.diff)}<br><span class="${att.pct >= 0 ? "positive" : "negative"}">${formatPercent(att.pct)}</span></td>
    </tr>`;
  }).join("")}</tbody></table>`;
}

function importView() {
  return `
    ${header("Importação", "Envie arquivos CSV/XLSX ou uma pasta com uma aba por cliente.", `<button class="btn subtle" data-action="reset">Restaurar demonstração</button>`)}
    <section class="panel">
      <div class="dropzone">
        <strong>Arquivos de historico mensal</strong>
        <p class="muted">Formatos aceitos: Competencia + Quantidade ou planilha mês x ano por aba de cliente.</p>
        <input type="file" id="fileInput" multiple accept=".csv,.xlsx" />
      </div>
      <div>${state.importMessages.map((msg) => `<div class="message ${msg.ok ? "ok" : "error"}">${msg.text}</div>`).join("")}</div>
      ${state.pendingImport ? pendingImportView(state.pendingImport) : ""}
    </section>
    <section class="panel" style="margin-top:16px">
      <h2>Clientes importados</h2>
      <table><thead><tr><th>Cliente</th><th>Status</th><th class="number">Meses</th><th>Importado em</th></tr></thead><tbody>
      ${state.clients.map((client) => `<tr><td>${client.name}</td><td>${client.active === false ? "Inativo" : "Ativo"}</td><td class="number">${client.records.length}</td><td>${new Date(client.importedAt || Date.now()).toLocaleString("pt-BR")}</td></tr>`).join("")}
      </tbody></table>
    </section>`;
}

function pendingImportView(pending) {
  const rows = pending.conflicts.map((item, index) => {
    const existingSummary = clientImportSummary(item.existing);
    const incomingSummary = clientImportSummary(item.incoming);
    return `<tr>
      <td><strong>${item.existing.name}</strong></td>
      <td>${existingSummary}</td>
      <td>${incomingSummary}</td>
      <td class="number">
        <button class="btn primary mini-btn" data-import-decision="${index}" data-decision="replace">Substituir</button>
        <button class="btn subtle mini-btn" data-import-decision="${index}" data-decision="skip">Ignorar</button>
      </td>
    </tr>`;
  }).join("");
  return `<div class="import-review">
    <div class="section-title">
      <div><h2>Conferir clientes existentes</h2><p class="muted">Escolha individualmente quais clientes devem receber os dados novos.</p></div>
      <div class="toolbar">
        <button class="btn primary" data-action="import-replace-all">Substituir todos</button>
        <button class="btn subtle" data-action="import-skip-all">Ignorar todos</button>
      </div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Cliente</th><th>Atual</th><th>Novo arquivo</th><th class="number">Ação</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  </div>`;
}

function clientImportSummary(client) {
  const records = [...(client.records || [])].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const total = records.reduce((sum, record) => sum + (Number(record.quantity) || 0), 0);
  const first = records[0]?.competencia || "-";
  const last = records.at(-1)?.competencia || "-";
  return `${records.length} competências | ${first} a ${last} | Total ${formatNumber(total)}`;
}

function clientsView() {
  const selected = currentClient();
  const options = analysisOptions();
  const years = getYears(state.clients, options.year);
  const filtered = filteredClients();
  return `
    ${header("Análise de pedidos", "Clientes, dados mensais e projeções.", `${filters()}${configControls()}${RequirePermission(state.user, "createClient", `<button class="btn" data-action="new-client">Novo cliente</button>`)}${RequirePermission(state.user, "exportData", `<button class="btn primary" data-action="export-client">Exportar cliente</button>`)}`)}
    <section class="grid clients-layout">
      <div class="panel">
        <div class="client-list-header">
          <div>
            <h2>${clientListTitle()}</h2>
            <span>${filtered.length} de ${state.clients.length} clientes</span>
          </div>
          <select class="select compact" data-filter="active" title="Filtrar clientes por situação">
            <option value="active" ${state.filters.active === "active" ? "selected" : ""}>Ativos</option>
            <option value="inactive" ${state.filters.active === "inactive" ? "selected" : ""}>Inativos</option>
            <option value="all" ${state.filters.active === "all" ? "selected" : ""}>Todos</option>
          </select>
        </div>
        <input class="input client-search" data-filter="client" placeholder="Buscar cliente" value="${escapeHtml(state.filters.client)}">
        <div class="client-list" data-client-list>${filtered.map((client) => clientButton(client)).join("") || `<p class="muted">Nenhum cliente nos filtros.</p>`}</div>
      </div>
      <div>
        ${state.editingClient ? clientEditor(selected) : ""}
        ${selected ? clientDetail(selected, years, options) : `<div class="panel">Selecione um cliente.</div>`}
      </div>
    </section>`;
}

function aiInsightsView() {
  const active = activeClients();
  const client = active.find((item) => item.id === state.aiSelectedClientId) || active[0] || state.clients[0];
  if (client && state.aiSelectedClientId !== client.id) state.aiSelectedClientId = client.id;
  const saved = [...state.ai.analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = state.aiSelectedAnalysisId ? state.ai.analyses.find((item) => item.id === state.aiSelectedAnalysisId) : saved[0];
  const canGenerate = can("generateAiInsights");
  return `
    ${header("Expectativa para os próximos meses", "Insights preditivos gerados por IA com base nos dados do cliente.", "")}
    <section class="panel ai-panel">
      <div class="ai-toolbar">
        <label>Cliente<select class="select" data-ai-field="client">
          ${active.map((item) => `<option value="${item.id}" ${client?.id === item.id ? "selected" : ""}>${item.name}</option>`).join("")}
        </select></label>
        <label>Período<select class="select" data-ai-field="months">
          ${[3, 6, 12].map((value) => `<option value="${value}" ${Number(state.aiMonthsAhead) === value ? "selected" : ""}>${value} meses</option>`).join("")}
        </select></label>
        <div class="credit-card"><span>Créditos</span><strong>${state.ai.credits}</strong></div>
        ${canGenerate ? `<button class="btn primary" data-action="generate-ai" ${state.aiLoading ? "disabled" : ""}>${state.aiLoading ? "Gerando..." : "Gerar análise"}</button>` : ""}
      </div>
      <p class="muted ai-server-hint">A geração usa Gemini pelo servidor local seguro em http://localhost:4173. Mantenha esta tela no mesmo endereço onde seus dados foram importados.</p>
      ${!canGenerate ? `<div class="message">Visualizadores podem consultar análises salvas, mas não gerar novas análises.</div>` : ""}
      ${state.aiError ? `<div class="message error">${state.aiError}</div>` : ""}
    </section>
    <section class="grid ai-layout">
      <div class="panel">
        <h2>Análises salvas</h2>
        ${saved.length ? `<div class="analysis-list">${saved.map((item) => `
          <button class="analysis-row ${selected?.id === item.id ? "active" : ""}" data-analysis="${item.id}">
            <strong>${item.clientName}</strong>
            <span>${item.monthsAhead} meses | ${new Date(item.createdAt).toLocaleString("pt-BR")} | ${item.user?.name || "-"}</span>
          </button>`).join("")}</div>` : `<p class="muted">Nenhuma análise salva ainda.</p>`}
      </div>
      <div>${selected ? aiResultView(selected) : `<div class="panel">Selecione um cliente e gere uma análise para visualizar os insights.</div>`}</div>
    </section>`;
}

function aiResultView(analysis) {
  const result = analysis.result;
  return `<div class="panel ai-result">
    <div class="section-title">
      <div><h2>${analysis.clientName}</h2><p class="muted">${analysis.monthsAhead} meses | ${new Date(analysis.createdAt).toLocaleString("pt-BR")}</p></div>
      ${RequirePermission(state.user, "deleteAiInsights", `<button class="btn danger" data-action="delete-ai">Excluir análise</button>`)}
    </div>
    <section class="grid cards ai-cards">
      ${card("Pedidos previstos", formatNumber(result.forecastSummary.predictedOrders))}
      ${card("Média histórica", formatNumber(result.forecastSummary.historicalMonthlyAverage))}
      ${card("Média projetada", formatNumber(result.forecastSummary.projectedMonthlyAverage))}
      ${card("Crescimento projetado", formatPercent(result.forecastSummary.projectedGrowthPercent), result.forecastSummary.projectedGrowthPercent >= 0 ? "positive" : "negative")}
    </section>
    <div class="risk-pill ${result.forecastSummary.riskStatus}">Risco ${result.forecastSummary.riskStatus}</div>
    <div class="ai-text">
      <h3>Resumo executivo</h3><p>${escapeHtml(result.executiveSummary)}</p>
      <h3>Tendência esperada</h3><p>${escapeHtml(result.expectedTrend)}</p>
      ${aiList("Riscos", result.risks)}
      ${aiList("Oportunidades", result.opportunities)}
      ${aiList("Recomendações", result.recommendations)}
      ${aiList("Pontos de atenção", result.attentionPoints)}
    </div>
    <div class="chart-card ai-forecast-chart"><h2>Histórico e previsão</h2><canvas id="aiForecastChart"></canvas></div>
  </div>`;
}

function aiList(title, items) {
  const list = Array.isArray(items) && items.length ? items : ["Sem apontamentos relevantes para os dados enviados."];
  return `<h3>${title}</h3><ul>${list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function conceptsView() {
  return `
    ${header("Guia de conceitos", "Regras, formulas e criterios usados nos dashboards e relatorios.", "")}
    <section class="concepts-page">
      ${conceptBlock("1. Dados base", `
        <p><b>Cliente</b>: cada cliente possui uma serie mensal de pedidos negociados. O cliente pode estar ativo para consulta e, separadamente, pode participar ou nao do dashboard.</p>
        <p><b>Competencia</b>: mes e ano do dado, no formato AAAA-MM. Exemplo: 2026-04 representa abril de 2026.</p>
        <p><b>Quantidade de pedidos</b>: valor realizado naquele mes. Quando nao existe valor salvo, a tabela mostra vazio ou valor projetado, conforme o ano e o mes.</p>
        <p><b>Zeros historicos</b>: zeros antes do primeiro pedido real do cliente sao ignorados nas medias. Zeros depois do inicio do historico continuam valendo como queda real.</p>
      `)}
      ${conceptBlock("2. Cliente ativo x participa do dashboard", `
        <p><b>Cliente ativo</b>: aparece na listagem, pode ser consultado, editado e comentado.</p>
        <p><b>Cliente inativo</b>: sai da visao padrao de ativos, mas pode ser visto usando o filtro Inativos ou Todos.</p>
        <p><b>Participa do dashboard</b>: controla se o cliente entra nos totais, rankings, status executivos e blocos de atingimento.</p>
        <p><b>Fora do dashboard</b>: o cliente continua disponivel para consulta, mas nao interfere em queda, crescimento, criticos, ranking ou totais gerais.</p>
      `)}
      ${conceptBlock("3. Projecao mensal e anual", `
        <p><b>Media historica mensal</b>: usa a media do mesmo mes em anos anteriores. Exemplo: abril/2026 usa abril/2025, abril/2024, abril/2023 etc., quando existirem.</p>
        <p><b>Media dos ultimos 12 meses</b>: usa a media dos 12 meses mais recentes antes da competencia projetada.</p>
        <p><b>Media dos ultimos 3 anos</b>: usa a media do mesmo mes considerando, no maximo, os 3 anos anteriores.</p>
        <p><b>Projecao anual</b>: soma os meses realizados do ano ativo com as previsoes dos meses futuros.</p>
        <div class="formula">Projecao anual = meses realizados + meses futuros projetados</div>
      `)}
      ${conceptBlock("4. Status anual do cliente", `
        <p>O status anual compara a projecao do ano ativo contra o total do ano anterior.</p>
        <div class="formula">Variacao anual = (projecao do ano atual - total do ano anterior) / total do ano anterior</div>
        ${ruleTable([
          ["Crescimento", "acima de +10% vs ano anterior"],
          ["Regular", "entre -10% e +10%"],
          ["Atencao", "entre -10% e -20%"],
          ["Critico", "abaixo de -20% ou sem pedidos recentes"],
          ["Observacao", "historico anterior curto, com menos de 6 meses de base"],
        ])}
      `)}
      ${conceptBlock("5. Atingimento mensal", `
        <p>O atingimento mensal compara o realizado do mes atual com a media historica do mesmo mes em anos anteriores. Ele nao usa a media dos ultimos 12 meses, porque isso pode distorcer clientes sazonais ou com historico curto.</p>
        <div class="formula">Atingimento mensal = (realizado do mes - esperado do mes) / esperado do mes</div>
        ${ruleTable([
          ["Acima da projecao", "mais de +10% acima do esperado"],
          ["Dentro do esperado", "entre -10% e +10%"],
          ["Abaixo da projecao", "entre -10% e -20%"],
          ["Critico", "abaixo de -20%, somente quando ha base suficiente"],
          ["Historico curto", "menos de 2 anos anteriores para o mesmo mes"],
          ["Sem realizado", "nao existe valor realizado salvo para o mes"],
        ])}
      `)}
      ${conceptBlock("6. Historico curto", `
        <p>Historico curto evita que um cliente novo seja tratado como critico com base em uma comparacao fraca.</p>
        <p>No mes, a aplicacao exige pelo menos 2 anos anteriores para o mesmo mes antes de classificar como abaixo ou critico.</p>
        <p>No ano, a aplicacao exige pelo menos 6 meses de base anterior antes de classificar o status anual com seguranca.</p>
      `)}
      ${conceptBlock("7. Indicadores da tela do cliente", `
        ${ruleTable([
          ["Projecao do mes", "valor esperado para o mes atual, pela media historica do mesmo mes"],
          ["Realizado do mes", "quantidade salva para o mes atual"],
          ["Diferenca vs projecao", "realizado do mes menos esperado do mes"],
          ["Status do mes", "classificacao do atingimento mensal"],
          ["Projecao anual", "realizado do ano mais previsoes futuras"],
          ["Realizado acumulado", "soma dos meses realizados ate o mes atual"],
          ["Dif. acumulada vs esperado", "realizado acumulado menos esperado acumulado"],
          ["Status anual", "classificacao da projecao anual vs ano anterior"],
        ])}
      `)}
      ${conceptBlock("8. Rankings e graficos", `
        <p><b>Real x projetado</b>: ordena clientes pelo realizado acumulado do ano. A barra laranja representa realizado e a barra cinza representa projecao anual.</p>
        <p><b>Volume real</b>: mostra os maiores volumes realizados no ano ativo, com a projecao como informacao secundaria.</p>
        <p><b>Crescimento</b>: ordena pela maior variacao projetada vs ano anterior.</p>
        <p><b>Queda</b>: ordena pela menor variacao projetada vs ano anterior.</p>
        <p><b>Historico</b>: linha mensal dos pedidos reais do cliente.</p>
        <p><b>Anos</b>: barras comparando totais anuais.</p>
        <p><b>Sazonalidade</b>: media historica de cada mes, usada para entender meses naturalmente fortes ou fracos.</p>
      `)}
      ${conceptBlock("9. Edicao e origem dos dados", `
        <p><b>Importado</b>: valor carregado por arquivo CSV/XLSX.</p>
        <p><b>Manual</b>: valor inserido diretamente no portal.</p>
        <p><b>Ajustado</b>: valor importado ou existente que foi alterado manualmente.</p>
        <p><b>Projetado</b>: valor calculado, usado como previsao. Ele aparece em cinza/italico e nao substitui um realizado.</p>
      `)}
      ${conceptBlock("10. IA e analises salvas", `
        <p>Os insights de IA usam apenas os dados enviados pelo portal: historico mensal, projecoes, status, tolerancia e ano ativo.</p>
        <p>A IA deve gerar leitura executiva, riscos, oportunidades e recomendacoes. Ela nao deve inventar contexto externo sobre o cliente.</p>
        <p>Analises novas consomem creditos; visualizar uma analise salva nao consome creditos.</p>
      `)}
    </section>`;
}

function conceptBlock(title, content) {
  return `<article class="concept-card"><h2>${title}</h2>${content}</article>`;
}

function ruleTable(rows) {
  return `<table class="concept-table"><tbody>${rows.map(([label, description]) => `<tr><th>${label}</th><td>${description}</td></tr>`).join("")}</tbody></table>`;
}

function filters() {
  return `
    <input class="input" data-filter="client" placeholder="Cliente" value="${escapeHtml(state.filters.client)}">
    <select class="select" data-filter="active">
      <option value="active" ${state.filters.active === "active" ? "selected" : ""}>Ativos</option>
      <option value="all" ${state.filters.active === "all" ? "selected" : ""}>Todos</option>
      <option value="inactive" ${state.filters.active === "inactive" ? "selected" : ""}>Inativos</option>
    </select>
    <select class="select" data-filter="status">
      <option value="all">Todos os status</option>
      ${["crescimento", "regular", "observacao", "atencao", "critico"].map((s) => `<option value="${s}" ${state.filters.status === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}
    </select>
    <select class="select" data-filter="order">
      <option value="volume" ${state.filters.order === "volume" ? "selected" : ""}>Maior volume</option>
      <option value="growth" ${state.filters.order === "growth" ? "selected" : ""}>Maior crescimento</option>
      <option value="drop" ${state.filters.order === "drop" ? "selected" : ""}>Maior queda</option>
    </select>`;
}

function clientButton(client) {
  const analysis = analyzeClient(client, state.method, analysisOptions());
  const dashboardNote = client.dashboardActive === false ? "Fora do dashboard | " : "";
  return `<button class="client-row ${client.id === state.selectedId ? "active" : ""} ${client.active === false ? "inactive" : ""}" data-client="${client.id}">
    <strong>${client.name}<span class="status ${analysis.status}">${statusLabel(analysis.status)}</span></strong>
    <span class="muted">${client.active === false ? "Inativo | " : ""}${dashboardNote}Proj. ${formatNumber(analysis.currentProjected)} | ${formatPercent(analysis.yoy)} vs ${analysisOptions().year - 1}</span>
  </button>`;
}

function clientListTitle() {
  if (state.filters.active === "inactive") return "Clientes inativos";
  if (state.filters.active === "all") return "Todos os clientes";
  return "Clientes ativos";
}

function clientDetail(client, years, options) {
  const analysis = analyzeClient(client, state.method, options);
  const last12VsHistorical = percentChange(analysis.last12Average, analysis.historicalAverage);
  const rows = buildClientTable(client, years, state.method, options);
  const att = analysis.monthAttainment;
  const selectedLabel = selectedMonthLabel(options);
  return `
    <div class="panel ${state.editMode ? "edit-mode-panel" : ""}">
      <div class="section-title">
        <div><h2>${client.name}</h2><p class="muted">${clientMeta(client)}</p></div>
        ${RequirePermission(state.user, "editClient", `<div class="toolbar">
          <button class="btn primary" data-action="toggle-edit-mode">${state.editMode ? "Sair da edição" : "Editar"}</button>
          <button class="btn dashboard-toggle ${client.dashboardActive === false ? "off" : "on"}" data-action="toggle-dashboard" title="Controla se o cliente entra nos totais, rankings e status da visao geral">Dashboard: ${client.dashboardActive === false ? "nao" : "sim"}</button>
          <button class="btn secondary" data-action="toggle-client">${client.active === false ? "Ativar" : "Inativar"}</button>
          <button class="btn danger" data-action="delete-client">Excluir</button>
        </div>`)}
      </div>
      ${state.editMode ? `<div class="edit-banner">Modo edição ativo</div>` : ""}
      <div class="client-actions">
        <span>${selectedLabel ? `Mês selecionado: ${selectedLabel}` : "Selecione um mês na tabela para editar mais rápido."}</span>
        <div class="toolbar">
          ${RequirePermission(state.user, "editClient", `<button class="btn dashboard-toggle mini-btn ${client.dashboardActive === false ? "off" : "on"}" data-action="toggle-dashboard" title="Controla se o cliente entra nos totais, rankings e status da visao geral">${client.dashboardActive === false ? "Fora do dashboard" : "No dashboard"}</button>`)}
          <button class="btn subtle mini-btn" data-action="collapse-blocks">Ocultar blocos</button>
          <button class="btn subtle mini-btn" data-action="expand-blocks">Expandir blocos</button>
        </div>
      </div>
      ${sectionBlock("summary", "Indicadores", `
        <div class="metrics">
        ${metric("Projecao do mes", formatNumber(att.expected), "", "media historica do mesmo mes")}
        ${metric("Realizado do mes", formatNumber(att.realized))}
        ${metric("Diferenca vs projecao", `${formatNumber(att.diff)} | ${formatPercent(att.pct)}`, signClass(att.pct))}
        ${metric("Status do mes", `<span class="status ${att.status}">${attainmentLabel(att.status)}</span>`)}
        ${metric("Projecao anual", formatNumber(analysis.currentProjected))}
        ${metric("Realizado acumulado", formatNumber(analysis.realizedAccumulated))}
        ${metric("Dif. acumulada vs esperado", `${formatNumber(analysis.accumulatedDiff)} | ${formatPercent(analysis.accumulatedPct)}`, signClass(analysis.accumulatedPct))}
        ${metric("Status anual", `<span class="status ${analysis.status}">${statusLabel(analysis.status)}</span>`, "", statusExplanation(analysis.status))}
        </div>
        ${conceptPanel(analysis, state.method, options)}
      `)}
      ${can("editMonthlyData") && state.editMode ? sectionBlock("monthly", "Lançamento mensal", monthlyEditor(client, options), "section-panel monthly-section") : ""}
      <div class="table-wrap">
      <table class="spreadsheet">
        <thead><tr><th>Mes</th>${years.map((year) => `<th class="number">${year}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => tableRow(row)).join("")}</tbody>
        <tfoot><tr><td>Total</td>${years.map((year) => `<td class="number">${formatNumber(year === options.year ? projectedYearTotal(client, year, state.method, options) : yearTotal(client, year))}</td>`).join("")}</tr></tfoot>
      </table>
      </div>
      <p class="muted calc-note">Medias e previsoes desconsideram zeros anteriores ao primeiro pedido do cliente. Zeros apos o inicio do historico continuam valendo como queda real.</p>
    </div>
    ${sectionBlock("support", "Análises complementares", `
      <section class="grid three charts-row">
        <div class="chart-card"><h2>Histórico</h2><canvas id="historyChart"></canvas></div>
        <div class="chart-card"><h2>Anos</h2><canvas id="yearChart"></canvas></div>
        <div class="chart-card"><h2>Sazonalidade</h2><canvas id="seasonChart"></canvas></div>
        <div class="chart-card comments-card"><h2>${can("editComments") ? "Comentário rápido" : "Comentários"}</h2>${can("editComments") ? commentForm(client) : commentsList(client)}</div>
      </section>
    `, "panel section-panel support-panel")}`;
}

function tableRow(row) {
  const options = analysisOptions();
  const selected = state.selectedMonth?.endsWith(`-${String(row.monthNumber).padStart(2, "0")}`);
  return `<tr class="${selected ? "selected-month-row" : ""}">
    <td class="month" data-month-cell="${key(options.year, row.monthNumber)}">${row.month}</td>${row.values.map((cell) => tableCell(cell, row.monthNumber)).join("")}
  </tr>`;
}

function tableCell(cell, monthNumber) {
  const competencia = key(cell.year, monthNumber);
  const att = cell.attainment;
  const tooltip = att ? `Realizado: ${formatNumber(att.realized)} | Projetado: ${formatNumber(att.expected)} | Diferenca: ${formatNumber(att.diff)} | ${formatPercent(att.pct)} | ${attainmentLabel(att.status)}` : "";
  const selected = state.selectedMonth === competencia;
  const canInlineEdit = can("editMonthlyData") && state.editMode && selected;
  const badge = att && att.realized !== null ? `<span class="hit-dot ${att.status}" title="${tooltip}"></span>` : "";
  const display = `${formatNumber(cell.value)}${cell.projected ? " proj." : ""}${badge}`;
  const editor = `<div class="inline-month-editor">
    <input class="input" id="inlineMonthQuantity" type="number" min="0" value="${cell.record?.quantity ?? ""}" placeholder="0">
    <button class="btn primary icon-btn" data-action="save-inline-month" title="Salvar valor" aria-label="Salvar valor">✓</button>
  </div>`;
  return `<td class="number ${cell.projected ? "projected" : ""} ${cell.current ? "current-month" : ""} ${selected ? "selected-month-cell" : ""}" data-month-cell="${competencia}" title="${tooltip}">
    ${canInlineEdit ? editor : display}
  </td>`;
}

function monthlyEditor(client, options) {
  const competencia = state.editingMonth || state.selectedMonth || key(options.year, options.currentMonth);
  const record = client.records.find((r) => r.competencia === competencia);
  return `<div class="editor-box">
    <div class="form-grid">
      <input class="input" id="monthCompetence" type="month" value="${competencia}">
      <input class="input" id="monthQuantity" type="number" min="0" placeholder="Quantidade de pedidos" value="${record?.quantity ?? ""}">
      <select class="select" id="monthSource">
        ${["importado", "manual", "ajustado", "projetado"].map((source) => `<option value="${source}" ${(record?.source || "manual") === source ? "selected" : ""}>${source}</option>`).join("")}
      </select>
      <input class="input wide" id="monthObservation" placeholder="Observacao" value="${escapeHtml(record?.observation || "")}">
      <button class="btn primary" data-action="save-month">${record ? "Salvar mes" : "Inserir mes"}</button>
      <button class="btn" data-action="zero-month">Zerar mes</button>
      <button class="btn danger" data-action="delete-month">Excluir valor</button>
    </div>
  </div>`;
}

function sectionBlock(id, title, content, className = "section-panel") {
  const collapsed = id === "monthly" && state.editMode ? false : !!state.collapsedSections[id];
  return `<div class="${className} collapsible ${collapsed ? "is-collapsed" : ""}" data-section="${id}">
    <div class="block-header">
      <h2>${title}</h2>
      ${id === "monthly" ? "" : `<button class="btn subtle mini-btn" data-toggle-section="${id}">${collapsed ? "Expandir" : "Ocultar"}</button>`}
    </div>
    <div class="block-content">${content}</div>
  </div>`;
}

function selectedMonthLabel(options) {
  if (!state.selectedMonth) return "";
  const [year, month] = state.selectedMonth.split("-");
  return `${MONTHS[Number(month) - 1]?.label}/${year}`;
}

function clientEditor(client) {
  const editing = state.editingClient === "new" ? {} : client;
  return `<div class="panel editor-panel">
    <h2>${state.editingClient === "new" ? "Novo cliente" : "Editar cliente"}</h2>
    <div class="form-grid">
      ${field("Nome", "name", editing.name || "")}
      ${field("CNPJ", "cnpj", editing.cnpj || "")}
      ${field("ERP", "erp", editing.erp || "")}
      ${field("Segmento", "segment", editing.segment || "")}
      ${field("Responsavel", "owner", editing.owner || "")}
      <label class="wide">Observacoes<textarea class="textarea" data-client-field="notes">${escapeHtml(editing.notes || "")}</textarea></label>
      <label><input type="checkbox" data-client-field="active" ${editing.active !== false ? "checked" : ""}> Cliente ativo</label>
      <label><input type="checkbox" data-client-field="dashboardActive" ${editing.dashboardActive !== false ? "checked" : ""}> Participa do dashboard</label>
      <div class="toolbar wide"><button class="btn primary" data-action="save-client">Salvar cliente</button><button class="btn" data-action="cancel-client">Cancelar</button></div>
    </div>
  </div>`;
}

function field(label, name, value) {
  return `<label>${label}<input class="input" data-client-field="${name}" value="${escapeHtml(value)}"></label>`;
}

function metric(label, value, cls = "", note = "", noteValue = null) {
  const noteClass = noteValue === null ? "muted" : noteValue >= 0 ? "positive" : "negative";
  const info = metricInfo(label);
  return `<div class="metric">
    <span class="metric-label">${label}${info ? `<button class="info-dot" type="button" aria-label="${escapeHtml(info)}" title="${escapeHtml(info)}">i</button>` : ""}</span>
    <strong class="${cls}">${value}</strong>
    ${note ? `<small class="${noteClass}">${note}</small>` : ""}
  </div>`;
}

function metricInfo(label) {
  const normalized = label.toLowerCase();
  if (normalized.includes("projecao do mes")) return "Valor esperado para o mês selecionado, calculado pela média histórica do mesmo mês em anos anteriores. Com menos de 2 anos de base, o mês fica como histórico curto.";
  if (normalized.includes("realizado do mes")) return "Quantidade real de pedidos registrada para o mês selecionado.";
  if (normalized.includes("diferenca vs projecao")) return "Diferença entre realizado e projeção esperada. Fórmula: realizado - projetado e variação percentual sobre o projetado.";
  if (normalized.includes("status do mes")) return "Classificação do mês conforme a diferença percentual contra a média histórica do mesmo mês. Com menos de 2 anos de base, não classifica como crítico.";
  if (normalized.includes("projecao anual")) return "Total estimado do ano: meses realizados usam dados reais e meses futuros usam projeção.";
  if (normalized.includes("realizado acumulado")) return "Soma dos pedidos reais do ano ativo até o mês atual da análise.";
  if (normalized.includes("dif. acumulada")) return "Comparação entre o realizado acumulado e o esperado acumulado até o mês atual.";
  if (normalized.includes("status anual")) return "Classificação anual baseada na projeção do ano contra o total do ano anterior.";
  if (normalized.includes("media historica")) return "Média mensal histórica desde o primeiro pedido real do cliente.";
  if (normalized.includes("media 12")) return "Média dos últimos 12 meses disponíveis para o cliente.";
  if (normalized.includes("tendencia")) return "Compara a média dos 3 meses mais recentes com os 3 meses imediatamente anteriores.";
  if (normalized.includes("historico")) return "Compara o mês atual com a média histórica do mesmo mês em anos anteriores.";
  return "";
}

function conceptPanel(analysis, method, options) {
  return `<div class="concepts">
    <strong>Como ler estes indicadores</strong>
    <p><b>Status anual</b>: definido pela projecao anual de ${options.year} contra o total de ${options.year - 1}, usando ${methodLabel(method)}. Clientes com menos de 6 meses de base anterior ficam em observacao.</p>
    <p><b>Atingimento mensal</b>: compara o realizado de ${MONTHS[options.currentMonth - 1].label}/${options.year} com a media historica do mesmo mes em anos anteriores. Com menos de 2 anos para o mesmo mes, fica como historico curto. Tolerancia atual: ${options.tolerance}%.</p>
    <p><b>Tendencia 3 meses</b>: compara ${competenceRange(analysis.trend.current)} contra ${competenceRange(analysis.trend.previous)}. Media recente ${formatNumber(analysis.trend.currentAverage)} contra ${formatNumber(analysis.trend.previousAverage)}.</p>
  </div>`;
}

function commentForm(client) {
  const options = analysisOptions();
  return `
    <div class="grid">
      <select class="select" id="commentMonth">${MONTHS.map((m) => `<option value="${key(options.year, m.n)}">${m.label}/${options.year}</option>`).join("")}</select>
      <textarea class="textarea" id="commentObservation" placeholder="Observacao"></textarea>
      <input class="input" id="commentReason" placeholder="Motivo da queda ou aumento">
      <input class="input" id="commentOwner" placeholder="Responsavel">
      <input class="input" id="commentNext" placeholder="Proxima acao">
      <input class="input" id="commentDate" type="date">
      <button class="btn primary" data-action="save-comment">Adicionar comentario</button>
    </div>
    ${commentsList(client)}`;
}

function commentsView() {
  const client = currentClient();
  return `
    ${header("Comentários", "Observações por cliente e competência.", `<select class="select" data-change="selected">${state.clients.map((c) => `<option value="${c.id}" ${c.id === state.selectedId ? "selected" : ""}>${c.name}</option>`).join("")}</select>`)}
    <section class="panel">${client ? `<h2>${client.name}</h2>${can("editComments") ? commentForm(client) : commentsList(client)}` : "Nenhum cliente cadastrado."}</section>`;
}

function commentsList(client) {
  if (!client.comments?.length) return `<p class="muted" style="margin-top:14px">Sem comentarios registrados.</p>`;
  return `<div style="margin-top:14px">${[...client.comments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((c) => `
    <article class="comment">
      <strong>${c.competencia}</strong> <span class="muted">${c.owner || "Sem responsavel"} | Acao: ${c.actionDate || "-"}</span>
      <p>${c.observation || "-"}</p>
      <p class="muted">Motivo: ${c.reason || "-"} | Proxima acao: ${c.nextAction || "-"}</p>
    </article>`).join("")}</div>`;
}

function bind() {
  document.querySelector("[data-action='login']")?.addEventListener("click", login);
  document.querySelector("[data-action='logout']")?.addEventListener("click", logout);
  document.querySelectorAll("[data-view]").forEach((el) => el.addEventListener("click", () => { state.view = el.dataset.view; state.editingClient = false; render(); }));
  restoreClientListScroll();
  document.querySelectorAll("[data-client]").forEach((el) => el.addEventListener("click", () => selectClient(el.dataset.client)));
  document.querySelectorAll("[data-change='method']").forEach((el) => el.addEventListener("change", () => {
    state.method = el.value;
    saveSettings({ ...state.settings, method: state.method, forecastMethod: state.method });
    render();
  }));
  document.querySelectorAll("[data-change='selected']").forEach((el) => el.addEventListener("change", () => { state.selectedId = el.value; render(); }));
  document.querySelectorAll("[data-filter]").forEach((el) => el.addEventListener("input", () => {
    const restoreSearch = el.dataset.filter === "client";
    state.filters[el.dataset.filter] = el.value;
    render();
    if (restoreSearch) restoreClientSearchFocus();
  }));
  document.querySelectorAll("[data-attainment-view]").forEach((el) => el.addEventListener("click", () => {
    state.attainmentView = el.dataset.attainmentView;
    render();
  }));
  document.querySelectorAll("[data-ai-field]").forEach((el) => el.addEventListener("change", () => {
    if (el.dataset.aiField === "client") state.aiSelectedClientId = el.value;
    if (el.dataset.aiField === "months") state.aiMonthsAhead = Number(el.value);
    state.aiError = "";
    render();
  }));
  document.querySelectorAll("[data-analysis]").forEach((el) => el.addEventListener("click", () => {
    state.aiSelectedAnalysisId = el.dataset.analysis;
    state.aiError = "";
    render();
  }));
  document.querySelectorAll("[data-setting]").forEach((el) => el.addEventListener("change", () => {
    if (!requirePermission("editSettings")) return;
    state.settings[el.dataset.setting] = Number(el.value);
    saveSettings(state.settings);
    render();
  }));
  document.querySelectorAll("[data-month-cell]").forEach((el) => el.addEventListener("click", () => selectMonth(el.dataset.monthCell)));
  document.querySelectorAll(".inline-month-editor input").forEach((el) => el.addEventListener("click", (event) => event.stopPropagation()));
  document.querySelector("[data-action='save-inline-month']")?.addEventListener("click", (event) => {
    event.stopPropagation();
    event.currentTarget.classList.add("saved");
    event.currentTarget.setAttribute("title", "Valor salvo");
    event.currentTarget.setAttribute("aria-label", "Valor salvo");
    saveInlineMonth();
  });
  document.querySelectorAll("[data-toggle-section]").forEach((el) => el.addEventListener("click", () => toggleSection(el.dataset.toggleSection)));
  document.getElementById("fileInput")?.addEventListener("change", handleImport);
  document.querySelector("[data-action='reset']")?.addEventListener("click", () => { state.clients = resetDemoData(); state.selectedId = state.clients[0]?.id; saveClients(state.clients); render(); });
  document.querySelector("[data-action='pdf']")?.addEventListener("click", exportDashboardPdf);
  document.querySelector("[data-action='export-all']")?.addEventListener("click", () => exportAllClientsXlsx(activeClients(), getYears(state.clients, analysisOptions().year), state.method, analysisOptions()));
  document.querySelector("[data-action='export-client']")?.addEventListener("click", () => currentClient() && exportClientXlsx(currentClient(), getYears(state.clients, analysisOptions().year), state.method, analysisOptions()));
  document.querySelector("[data-action='save-comment']")?.addEventListener("click", saveComment);
  document.querySelector("[data-action='new-client']")?.addEventListener("click", () => { state.editingClient = "new"; render(); });
  document.querySelector("[data-action='toggle-edit-mode']")?.addEventListener("click", toggleEditMode);
  document.querySelector("[data-action='edit-client']")?.addEventListener("click", () => { state.editingClient = true; render(); });
  document.querySelector("[data-action='cancel-client']")?.addEventListener("click", () => { state.editingClient = false; render(); });
  document.querySelector("[data-action='save-client']")?.addEventListener("click", saveClientForm);
  document.querySelector("[data-action='toggle-client']")?.addEventListener("click", toggleClient);
  document.querySelectorAll("[data-action='toggle-dashboard']").forEach((el) => el.addEventListener("click", toggleDashboardParticipation));
  document.querySelector("[data-action='delete-client']")?.addEventListener("click", deleteClient);
  document.querySelector("[data-action='save-month']")?.addEventListener("click", () => saveMonth(false));
  document.querySelector("[data-action='zero-month']")?.addEventListener("click", () => saveMonth(true));
  document.querySelector("[data-action='delete-month']")?.addEventListener("click", deleteMonth);
  document.querySelector("[data-action='collapse-blocks']")?.addEventListener("click", () => setSectionsCollapsed(true));
  document.querySelector("[data-action='expand-blocks']")?.addEventListener("click", () => setSectionsCollapsed(false));
  document.querySelector("[data-action='generate-ai']")?.addEventListener("click", generateAiInsight);
  document.querySelector("[data-action='delete-ai']")?.addEventListener("click", deleteAiInsight);
  document.querySelector("[data-action='import-replace-all']")?.addEventListener("click", () => applyPendingImport("replace-all"));
  document.querySelector("[data-action='import-skip-all']")?.addEventListener("click", () => applyPendingImport("skip-all"));
  document.querySelectorAll("[data-import-decision]").forEach((el) => el.addEventListener("click", () => applyPendingImportDecision(Number(el.dataset.importDecision), el.dataset.decision)));
}

function selectClient(clientId) {
  const list = document.querySelector("[data-client-list]");
  state.clientListScrollTop = list?.scrollTop || state.clientListScrollTop || 0;
  state.selectedId = clientId;
  state.view = "clients";
  state.editingClient = false;
  render();
  setTimeout(restoreClientListScroll, 0);
}

function restoreClientListScroll() {
  const list = document.querySelector("[data-client-list]");
  if (!list) return;
  list.scrollTop = state.clientListScrollTop || 0;
}

function restoreClientSearchFocus() {
  const input = document.querySelector(".client-search");
  if (!input) return;
  input.focus({ preventScroll: true });
  const end = input.value.length;
  input.setSelectionRange?.(end, end);
}

async function generateAiInsight() {
  if (!requirePermission("generateAiInsights")) return;
  if (state.ai.credits < 10) {
    state.aiError = "Saldo insuficiente para gerar nova análise.";
    render();
    return;
  }
  const client = state.clients.find((item) => item.id === state.aiSelectedClientId);
  if (!client || client.records.length < 3) {
    state.aiError = "Cliente sem dados suficientes para análise.";
    render();
    return;
  }
  const payload = buildAiPayload(client, Number(state.aiMonthsAhead));
  state.aiLoading = true;
  state.aiError = "";
  render();
  try {
    const response = await fetch(apiUrl("/api/ai-insights"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Falha ao gerar análise.");
    const result = body.result || body;
    validateAiResult(result);
    const saved = body.analysis ? {
      ...body.analysis,
      clientId: body.analysis.clientId || client.id,
      clientName: body.analysis.clientName || client.name,
      monthsAhead: Number(body.analysis.monthsAhead || state.aiMonthsAhead),
      createdAt: body.analysis.createdAt || new Date().toISOString(),
      user: body.analysis.user || state.user,
      result,
      input: body.analysis.input || payload,
    } : {
      id: crypto.randomUUID(),
      clientId: client.id,
      clientName: client.name,
      monthsAhead: Number(state.aiMonthsAhead),
      createdAt: new Date().toISOString(),
      user: state.user,
      result,
      input: payload,
    };
    state.ai.credits -= 10;
    state.ai.analyses.push(saved);
    state.aiSelectedAnalysisId = saved.id;
    saveAiState();
  } catch (error) {
    state.aiError = friendlyAiError(error);
  } finally {
    state.aiLoading = false;
    render();
  }
}

function deleteAiInsight() {
  if (!requirePermission("deleteAiInsights")) return;
  const selected = state.ai.analyses.find((item) => item.id === state.aiSelectedAnalysisId);
  if (!selected) return;
  if (!confirm(`Excluir a análise de ${selected.clientName}?`)) return;
  state.ai.analyses = state.ai.analyses.filter((item) => item.id !== selected.id);
  state.aiSelectedAnalysisId = state.ai.analyses[0]?.id || null;
  removeRemoteInsight(selected.id);
  saveAiState();
  render();
}

function buildAiPayload(client, monthsAhead) {
  const options = analysisOptions();
  const analysis = analyzeClient(client, state.method, options);
  const historicalData = client.records.map((record) => ({
    competencia: record.competencia,
    pedidos: record.quantity,
    origem: record.source || "importado",
  }));
  const startMonth = options.currentMonth + 1;
  const projections = Array.from({ length: monthsAhead }, (_, index) => {
    const monthIndex = startMonth + index;
    const year = options.year + Math.floor((monthIndex - 1) / 12);
    const month = ((monthIndex - 1) % 12) + 1;
    return { competencia: key(year, month), pedidosProjetados: forecastValue(client, year, month, state.method) };
  });
  return {
    clientId: client.id,
    clientName: client.name,
    monthsAhead,
    historicalData,
    projections,
    currentStatus: {
      annualStatus: analysis.status,
      monthStatus: analysis.monthAttainment.status,
      annualProjection: analysis.currentProjected,
      realizedAccumulated: analysis.realizedAccumulated,
      expectedAccumulated: analysis.expectedAccumulated,
      yoyPercent: analysis.yoy,
      monthVsProjectionPercent: analysis.monthAttainment.pct,
      trend3Percent: analysis.trend3,
      currentMonthRealized: analysis.monthAttainment.realized,
      currentMonthExpected: analysis.monthAttainment.expected,
    },
    tolerance: options.tolerance,
    activeYear: options.year,
    createdBy: state.user?.email || state.user?.name || "",
  };
}

function validateAiResult(result) {
  const required = ["executiveSummary", "expectedTrend", "risks", "opportunities", "recommendations", "attentionPoints", "forecastSummary"];
  if (!result || required.some((keyName) => !(keyName in result))) throw new Error("Resposta inválida da IA.");
  const summary = result.forecastSummary;
  if (!summary || !["baixo", "moderado", "alto", "critico"].includes(summary.riskStatus)) throw new Error("Resposta inválida da IA.");
  ["risks", "opportunities", "recommendations", "attentionPoints"].forEach((keyName) => {
    if (!Array.isArray(result[keyName])) throw new Error("Resposta inválida da IA.");
  });
}

function apiUrl(path) {
  if (location.protocol === "file:") return `http://localhost:4173${path}`;
  return path;
}

function saveAiState() {
  persistAiState(state.ai);
}

function friendlyAiError(error) {
  const message = error?.message || "";
  if (message === "Failed to fetch" || message.includes("fetch")) {
    return "Não foi possível conectar ao servidor de IA. Abra o servidor local na pasta da aplicação e mantenha esta tela pelo arquivo local.";
  }
  return message || "Erro ao gerar análise.";
}

function selectMonth(competencia) {
  const same = state.selectedMonth === competencia;
  state.selectedMonth = same && !state.editMode ? null : competencia;
  state.editingMonth = state.selectedMonth;
  if (state.selectedMonth && can("editMonthlyData")) {
    state.editMode = true;
  }
  render();
  setTimeout(() => {
    document.querySelector(`[data-month-cell="${competencia}"]`)?.scrollIntoView?.({ block: "nearest", inline: "center", behavior: "smooth" });
  }, 60);
}

function toggleSection(id) {
  const willExpand = !!state.collapsedSections[id];
  state.collapsedSections[id] = !state.collapsedSections[id];
  saveCollapsedSections();
  render();
  if (willExpand) {
    setTimeout(() => {
      const section = document.querySelector(`[data-section="${id}"]`);
      section?.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }, 60);
  }
}

function setSectionsCollapsed(collapsed) {
  state.collapsedSections.summary = collapsed;
  state.collapsedSections.support = collapsed;
  saveCollapsedSections();
  render();
  if (!collapsed) {
    setTimeout(() => document.querySelector(`[data-section="summary"]`)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 60);
  }
}

function toggleEditMode() {
  if (!requirePermission("editMonthlyData")) return;
  state.editMode = !state.editMode;
  if (state.editMode) {
    state.collapsedSections.summary = false;
    saveCollapsedSections();
    setTimeout(() => document.querySelector(`[data-section="monthly"]`)?.scrollIntoView?.({ block: "start", behavior: "smooth" }), 60);
  } else {
    state.editingMonth = state.selectedMonth;
  }
  render();
}

function login() {
  const email = document.getElementById("loginEmail")?.value || "";
  const password = document.getElementById("loginPassword")?.value || "";
  const session = authStore.login(email, password);
  if (!session) {
    const error = document.getElementById("loginError");
    if (error) error.style.display = "block";
    return;
  }
  state.user = session;
  state.view = "dashboard";
  render();
}

function logout() {
  authStore.logout();
  state.user = null;
  state.view = "dashboard";
  state.editingClient = false;
  state.editingMonth = null;
  render();
}

function can(permission) {
  return hasPermission(state.user, permission);
}

function requirePermission(permission) {
  if (can(permission)) return true;
  alert("Voce nao possui permissao para esta acao");
  return false;
}

async function handleImport(event) {
  if (!requirePermission("import")) return;
  const results = await importFiles([...event.target.files]);
  const imported = results.filter((r) => r.ok).map((r) => r.client);
  const cleanup = consolidateExistingClients(state.clients);
  state.clients = cleanup.clients;
  const plan = buildImportPlan(state.clients, imported);
  state.importMessages = [
    ...cleanup.messages,
    ...results.filter((r) => !r.ok).map((r) => ({ ok: false, text: `${r.file}: ${r.error}` })),
  ];
  state.importMessages.push(...plan.unchanged.map((client) => ({ ok: true, text: `${client.name}: dados iguais aos atuais; nenhuma alteração necessária.` })));
  if (plan.newClients.length) {
    state.clients.push(...plan.newClients);
    saveClients(state.clients);
    state.importMessages.push(...plan.newClients.map((client) => ({ ok: true, text: `${client.name}: novo cliente importado com ${client.records.length} competencias.` })));
    state.selectedId = plan.newClients[0].id;
  }
  if (plan.conflicts.length) {
    state.pendingImport = plan;
  } else {
    state.pendingImport = null;
  }
  event.target.value = "";
  render();
}

function saveClientForm() {
  if (!requirePermission(state.editingClient === "new" ? "createClient" : "editClient")) return;
  const data = {};
  document.querySelectorAll("[data-client-field]").forEach((el) => {
    data[el.dataset.clientField] = el.type === "checkbox" ? el.checked : el.value.trim();
  });
  if (!data.name) return alert("Informe o nome do cliente.");
  if (state.editingClient === "new") {
    data.dashboardActive = data.dashboardActive !== false;
    const client = { id: crypto.randomUUID(), ...data, records: [], comments: [], importedAt: new Date().toISOString() };
    state.clients.push(client);
    state.selectedId = client.id;
    syncRemoteClient(client);
  } else {
    Object.assign(currentClient(), data);
    syncRemoteClient(currentClient());
  }
  state.editingClient = false;
  saveClients(state.clients);
  render();
}

function toggleClient() {
  if (!requirePermission("editClient")) return;
  const client = currentClient();
  client.active = client.active === false;
  syncRemoteClient(client);
  saveClients(state.clients);
  render();
}

function toggleDashboardParticipation() {
  if (!requirePermission("editClient")) return;
  const client = currentClient();
  client.dashboardActive = client.dashboardActive === false;
  syncRemoteClient(client);
  saveClients(state.clients);
  render();
}

function deleteClient() {
  if (!requirePermission("deleteClient")) return;
  const client = currentClient();
  if (!client) return;
  if (!confirm(`Excluir o cliente "${client.name}"? Esta acao remove seus dados locais.`)) return;
  state.clients = state.clients.filter((item) => item.id !== client.id);
  state.selectedId = state.clients[0]?.id || null;
  removeRemoteClient(client.id);
  saveClients(state.clients);
  render();
}

function saveMonth(forceZero) {
  if (!requirePermission("editMonthlyData")) return;
  const client = currentClient();
  const competencia = document.getElementById("monthCompetence").value;
  const quantity = forceZero ? 0 : Number(document.getElementById("monthQuantity").value);
  if (!/^\d{4}-\d{2}$/.test(competencia)) return alert("Informe uma competencia valida.");
  if (!Number.isFinite(quantity) || quantity < 0) return alert("Informe uma quantidade valida.");
  const existing = client.records.find((r) => r.competencia === competencia);
  if (existing?.source === "importado" && existing.quantity !== quantity && !confirm("Este mes veio de importacao. Deseja substituir o valor importado?")) return;
  if (existing) {
    existing.quantity = quantity;
    existing.source = forceZero ? "ajustado" : document.getElementById("monthSource").value;
    existing.observation = document.getElementById("monthObservation").value.trim();
    syncRemoteMonthlyRecord(client.id, existing);
  } else {
    const record = {
      id: crypto.randomUUID(),
      competencia,
      quantity,
      source: forceZero ? "ajustado" : document.getElementById("monthSource").value,
      observation: document.getElementById("monthObservation").value.trim(),
    };
    client.records.push(record);
    syncRemoteMonthlyRecord(client.id, record);
  }
  client.records.sort((a, b) => a.competencia.localeCompare(b.competencia));
  state.editingMonth = competencia;
  state.selectedMonth = null;
  saveClients(state.clients);
  render();
}

function saveInlineMonth() {
  if (!requirePermission("editMonthlyData")) return;
  const client = currentClient();
  const competencia = state.selectedMonth;
  const input = document.getElementById("inlineMonthQuantity");
  const quantity = Number(input?.value);
  if (!/^\d{4}-\d{2}$/.test(competencia || "")) return alert("Selecione uma competencia valida.");
  if (!Number.isFinite(quantity) || quantity < 0) return alert("Informe uma quantidade valida.");
  const existing = client.records.find((r) => r.competencia === competencia);
  const previousSource = existing?.source;
  if (existing?.source === "importado" && existing.quantity !== quantity && !confirm("Este mes veio de importacao. Deseja substituir o valor importado?")) return;
  if (existing) {
    existing.quantity = quantity;
    existing.source = previousSource === "importado" ? "ajustado" : previousSource || "ajustado";
    syncRemoteMonthlyRecord(client.id, existing);
  } else {
    const record = {
      id: crypto.randomUUID(),
      competencia,
      quantity,
      source: "manual",
      observation: "",
    };
    client.records.push(record);
    syncRemoteMonthlyRecord(client.id, record);
  }
  client.records.sort((a, b) => a.competencia.localeCompare(b.competencia));
  state.editingMonth = competencia;
  state.inlineSavedMonth = competencia;
  saveClients(state.clients);
  setTimeout(() => {
    if (state.inlineSavedMonth === competencia) state.inlineSavedMonth = null;
    state.selectedMonth = null;
    render();
  }, 700);
}

function deleteMonth() {
  if (!requirePermission("editMonthlyData")) return;
  const client = currentClient();
  const competencia = document.getElementById("monthCompetence").value;
  const existing = client.records.find((r) => r.competencia === competencia);
  if (!existing) return alert("Nao ha valor salvo para esta competencia.");
  if (!confirm(`Excluir o valor de ${competencia} para ${client.name}?`)) return;
  client.records = client.records.filter((r) => r.competencia !== competencia);
  state.editingMonth = competencia;
  removeRemoteMonthlyRecord(client.id, competencia);
  saveClients(state.clients);
  render();
}

function saveComment() {
  if (!requirePermission("editComments")) return;
  const client = currentClient();
  if (!client) return;
  client.comments ||= [];
  const comment = {
    id: crypto.randomUUID(),
    competencia: document.getElementById("commentMonth").value,
    observation: document.getElementById("commentObservation").value,
    reason: document.getElementById("commentReason").value,
    owner: document.getElementById("commentOwner").value,
    nextAction: document.getElementById("commentNext").value,
    actionDate: document.getElementById("commentDate").value,
    createdAt: new Date().toISOString(),
  };
  client.comments.push(comment);
  syncRemoteComment(client.id, comment);
  saveClients(state.clients);
  render();
}

function filteredClients() {
  let list = state.clients.filter((client) => client.name.toLowerCase().includes(state.filters.client.toLowerCase()));
  if (state.filters.active === "active") list = list.filter((client) => client.active !== false);
  if (state.filters.active === "inactive") list = list.filter((client) => client.active === false);
  if (state.filters.status !== "all") list = list.filter((client) => analyzeClient(client, state.method, analysisOptions()).status === state.filters.status);
  const score = (client) => analyzeClient(client, state.method, analysisOptions());
  if (state.filters.order === "growth") list.sort((a, b) => score(b).yoy - score(a).yoy);
  else if (state.filters.order === "drop") list.sort((a, b) => score(a).yoy - score(b).yoy);
  else list.sort((a, b) => score(b).currentProjected - score(a).currentProjected);
  return list;
}

function buildImportPlan(existing, imported) {
  const importedUnique = consolidateImportedClients(imported);
  const byName = new Map(existing.map((client) => [clientKey(client.name), client]));
  return importedUnique.reduce((plan, client) => {
    const found = byName.get(clientKey(client.name));
    if (found && sameClientRecords(found, client)) plan.unchanged.push(found);
    else if (found) plan.conflicts.push({ existing: found, incoming: client });
    else plan.newClients.push(client);
    return plan;
  }, { newClients: [], conflicts: [], unchanged: [] });
}

function consolidateExistingClients(clients) {
  const byKey = new Map();
  const messages = [];
  clients.forEach((client) => {
    const key = clientKey(client.name);
    const found = byKey.get(key);
    if (!found) {
      byKey.set(key, client);
      return;
    }
    found.name = preferredClientName(found.name, client.name);
    found.records = mergeRecords(found.records, client.records);
    found.comments = [...(found.comments || []), ...(client.comments || [])];
    found.cnpj ||= client.cnpj || "";
    found.erp ||= client.erp || "";
    found.segment ||= client.segment || "";
    found.owner ||= client.owner || "";
    found.notes ||= client.notes || "";
    found.active = found.active !== false || client.active !== false;
    found.dashboardActive = found.dashboardActive !== false || client.dashboardActive !== false;
    messages.push({ ok: true, text: `${found.name}: cadastros duplicados consolidados antes da importação.` });
  });
  return { clients: [...byKey.values()], messages };
}

function applyPendingImportDecision(index, decision) {
  const pending = state.pendingImport;
  if (!pending) return;
  const item = pending.conflicts[index];
  if (!item) return;
  if (decision === "replace") replaceClientData(item.existing, item.incoming);
  state.importMessages.push(decision === "replace"
    ? { ok: true, text: `${item.existing.name}: dados substituidos com ${item.existing.records.length} competencias.` }
    : { ok: false, text: `${item.existing.name}: importacao ignorada; dados atuais mantidos.` });
  state.selectedId = item.existing.id;
  pending.conflicts.splice(index, 1);
  if (!pending.conflicts.length) state.pendingImport = null;
  saveClients(state.clients);
  render();
}

function applyPendingImport(mode) {
  const pending = state.pendingImport;
  if (!pending) return;
  pending.conflicts.forEach((item) => {
    if (mode === "replace-all") {
      replaceClientData(item.existing, item.incoming);
      state.importMessages.push({ ok: true, text: `${item.existing.name}: dados substituidos com ${item.existing.records.length} competencias.` });
      state.selectedId ||= item.existing.id;
    } else {
      state.importMessages.push({ ok: false, text: `${item.existing.name}: importacao ignorada; dados atuais mantidos.` });
    }
  });
  state.pendingImport = null;
  saveClients(state.clients);
  render();
}

function replaceClientData(existing, incoming) {
  const preserved = { comments: existing.comments, cnpj: existing.cnpj, erp: existing.erp, segment: existing.segment, owner: existing.owner, notes: existing.notes, active: existing.active, dashboardActive: existing.dashboardActive };
  const name = preferredClientName(existing.name, incoming.name);
  Object.assign(existing, incoming, preserved, { id: existing.id, name, records: mergeRecords(existing.records, incoming.records), importedAt: incoming.importedAt });
}

function consolidateImportedClients(imported) {
  const map = new Map();
  imported.forEach((client) => {
    const keyName = clientKey(client.name);
    const found = map.get(keyName);
    if (!found) {
      map.set(keyName, { ...client, records: [...client.records] });
      return;
    }
    found.records = mergeRecords(found.records, client.records);
    found.importedAt = client.importedAt || found.importedAt;
  });
  return [...map.values()];
}

function mergeRecords(current, incoming) {
  const map = new Map(current.map((record) => [record.competencia, record]));
  incoming.forEach((record) => map.set(record.competencia, { ...record }));
  return [...map.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

function sameClientRecords(existing, incoming) {
  const current = comparableRecords(existing.records);
  const next = comparableRecords(incoming.records);
  if (current.length !== next.length) return false;
  return current.every((record, index) => record.competencia === next[index].competencia && record.quantity === next[index].quantity);
}

function comparableRecords(records) {
  return [...(records || [])]
    .map((record) => ({ competencia: record.competencia, quantity: Number(record.quantity) || 0 }))
    .sort((a, b) => a.competencia.localeCompare(b.competencia));
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
    fcvnutriçãoanimal: "fcvnutricaoanimal",
    azeitesmallaguena: "azeitemalaguena",
    azeitemalaguena: "azeitemalaguena",
  };
  return aliases[normalized] || normalized;
}

function preferredClientName(existingName, incomingName) {
  if (String(incomingName || "").length > String(existingName || "").length) return incomingName;
  return existingName;
}

function drawCharts() {
  const selected = currentClient();
  const options = analysisOptions();
  if (selected && document.getElementById("historyChart")) {
    if (!state.collapsedSections.support) lineChart(document.getElementById("historyChart"), selected.records.map((r) => ({ label: r.competencia, value: r.quantity })), "#F28E26");
    const years = getYears(state.clients, options.year).map((year) => ({ label: year, value: year === options.year ? projectedYearTotal(selected, year, state.method, options) : yearTotal(selected, year) }));
    if (!state.collapsedSections.support) barChart(document.getElementById("yearChart"), years, "#476192");
    if (!state.collapsedSections.support) seasonalChart(document.getElementById("seasonChart"), analyzeClient(selected, state.method, options).seasonal);
  }
  const selectedAi = state.aiSelectedAnalysisId ? state.ai.analyses.find((item) => item.id === state.aiSelectedAnalysisId) : [...state.ai.analyses].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (selectedAi && document.getElementById("aiForecastChart")) {
    const actual = selectedAi.input.historicalData.slice(-12).map((item) => ({ label: item.competencia, value: item.pedidos }));
    const forecast = selectedAi.input.projections.map((item) => ({ label: item.competencia, value: item.pedidosProjetados }));
    forecastChart(document.getElementById("aiForecastChart"), actual, forecast);
  }
}

function currentClient() {
  return state.clients.find((client) => client.id === state.selectedId) || state.clients[0];
}

function activeClients() {
  return state.clients.filter((client) => client.active !== false);
}

function clientMeta(client) {
  return [
    client.cnpj && `CNPJ ${client.cnpj}`,
    client.erp && `ERP ${client.erp}`,
    client.segment,
    client.owner && `Resp. ${client.owner}`,
    client.active === false && "Inativo",
    client.dashboardActive === false && "Fora do dashboard",
  ].filter(Boolean).join(" | ") || "Sem dados cadastrais complementares.";
}

function statusLabel(status) {
  return { crescimento: "Crescimento", regular: "Regular", observacao: "Observacao", atencao: "Atencao", critico: "Critico" }[status] || status;
}

function roleLabel(role) {
  return { administrador: "Administrador", visualizador: "Visualizador" }[role] || role || "";
}

function statusExplanation(status) {
  return {
    crescimento: "Projecao anual acima de +10% vs ano anterior.",
    regular: "Projecao anual entre -10% e +10% vs ano anterior.",
    observacao: "Historico anterior curto para classificar com seguranca.",
    atencao: "Projecao anual entre -10% e -20% vs ano anterior.",
    critico: "Projecao anual abaixo de -20% ou sem pedidos recentes.",
  }[status] || "";
}

function attainmentLabel(status) {
  return {
    acima: "Acima da projecao",
    esperado: "Dentro do esperado",
    abaixo: "Abaixo da projecao",
    "critico-projecao": "Critico",
    "base-curta": "Historico curto",
    "sem-realizado": "Sem realizado",
  }[status] || status;
}

function methodLabel(method) {
  return {
    historicalMonthly: "media historica mensal",
    last12: "media dos ultimos 12 meses",
    last3Years: "media dos ultimos 3 anos",
  }[method] || method;
}

function trendShortLabel(trend) {
  return `${competenceRange(trend.current)} vs ${competenceRange(trend.previous)}`;
}

function competenceRange(records) {
  if (!records?.length) return "-";
  const first = records[0].competencia;
  const last = records[records.length - 1].competencia;
  return first === last ? formatCompetence(first) : `${formatCompetence(first)}-${formatCompetence(last)}`;
}

function formatCompetence(value) {
  const year = value.slice(0, 4);
  const month = Number(value.slice(5, 7));
  return `${MONTHS[month - 1]?.label || value}/${year}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function signClass(value) {
  if (!Number.isFinite(value)) return "";
  return value >= 0 ? "positive" : "negative";
}
