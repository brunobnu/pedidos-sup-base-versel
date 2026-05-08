import { CURRENT_MONTH, CURRENT_YEAR, MONTHS, key } from "./months.js";

export function normalizeRecords(records) {
  const map = new Map();
  records.forEach((record) => {
    if (!/^\d{4}-\d{2}$/.test(record.competencia)) return;
    const value = Number(record.quantity);
    if (!Number.isFinite(value)) return;
    const previous = map.get(record.competencia);
    map.set(record.competencia, {
      id: record.id || previous?.id || crypto.randomUUID(),
      competencia: record.competencia,
      quantity: (previous?.quantity || 0) + value,
      source: record.source || previous?.source || "importado",
      observation: record.observation || previous?.observation || "",
    });
  });
  return [...map.values()].sort((a, b) => a.competencia.localeCompare(b.competencia));
}

export function getYears(clients, activeYear = CURRENT_YEAR) {
  const years = new Set();
  clients.forEach((client) => client.records.forEach((r) => years.add(Number(r.competencia.slice(0, 4)))));
  years.add(activeYear);
  return [...years].sort((a, b) => a - b);
}

export function valueFor(client, year, month) {
  return client.records.find((r) => r.competencia === key(year, month))?.quantity ?? null;
}

export function yearTotal(client, year) {
  return MONTHS.reduce((sum, month) => sum + (valueFor(client, year, month.n) || 0), 0);
}

export function forecastValue(client, year, month, method = "historicalMonthly") {
  if (method === "last12") {
    const prior = activeRecords(client)
      .filter((r) => r.competencia < key(year, month))
      .slice(-12)
      .map((r) => r.quantity);
    return average(prior);
  }
  const values = activeRecords(client)
    .filter((r) => {
      const recordYear = Number(r.competencia.slice(0, 4));
      const recordMonth = Number(r.competencia.slice(5, 7));
      if (recordYear >= year) return false;
      if (method === "last3Years" && recordYear < year - 3) return false;
      return recordMonth === month;
    })
    .map((r) => r.quantity);
  return average(values);
}

export function projectedMonth(client, year, month, method, options = {}) {
  const activeYear = Number(options.activeYear || options.year || CURRENT_YEAR);
  const currentMonth = Number(options.currentMonth || CURRENT_MONTH);
  const actual = valueFor(client, year, month);
  if (actual !== null) return { value: actual, projected: false };
  if (year === activeYear && month > currentMonth) return { value: forecastValue(client, year, month, method), projected: true };
  return { value: null, projected: false };
}

export function projectedYearTotal(client, year = CURRENT_YEAR, method = "historicalMonthly", options = {}) {
  return MONTHS.reduce((sum, month) => {
    const item = projectedMonth(client, year, month.n, method, options);
    return sum + (item.value || 0);
  }, 0);
}

export function realizedYearToMonth(client, year = CURRENT_YEAR, currentMonth = CURRENT_MONTH) {
  return MONTHS.slice(0, currentMonth).reduce((sum, month) => sum + (valueFor(client, year, month.n) || 0), 0);
}

export function expectedYearToMonth(client, year = CURRENT_YEAR, currentMonth = CURRENT_MONTH, method = "historicalMonthly") {
  return MONTHS.slice(0, currentMonth).reduce((sum, month) => sum + forecastValue(client, year, month.n, "historicalMonthly"), 0);
}

export function attainmentForMonth(client, year = CURRENT_YEAR, month = CURRENT_MONTH, method = "historicalMonthly", tolerance = 10) {
  const realized = valueFor(client, year, month);
  const basis = historicalMonthValues(client, year, month);
  const expected = average(basis);
  const diff = realized === null ? null : realized - expected;
  const pct = realized === null ? null : percentChange(realized, expected);
  return {
    year,
    month,
    realized,
    expected,
    basisCount: basis.length,
    diff,
    pct,
    status: attainmentStatus(pct, tolerance, basis.length),
  };
}

export function analyzeClient(client, method = "historicalMonthly", options = {}) {
  const year = Number(options.year || CURRENT_YEAR);
  const currentMonth = Number(options.currentMonth || CURRENT_MONTH);
  const tolerance = Number(options.tolerance || 10);
  const recordsForAnalysis = activeRecords(client);
  const historicalAverage = average(recordsForAnalysis.map((r) => r.quantity));
  const last12Average = average(recordsForAnalysis.slice(-12).map((r) => r.quantity));
  const previousTotal = yearTotal(client, year - 1);
  const currentProjected = projectedYearTotal(client, year, method, { activeYear: year, currentMonth });
  const yoy = percentChange(currentProjected, previousTotal);
  const currentMonthActual = valueFor(client, year, currentMonth);
  const currentMonthHistorical = forecastValue(client, year, currentMonth, "historicalMonthly");
  const currentMonthVsHistory = percentChange(currentMonthActual || 0, currentMonthHistorical);
  const trend = trendDetails(recordsForAnalysis);
  const trend3 = percentChange(trend.currentAverage, trend.previousAverage);
  const seasonal = MONTHS.map((month) => ({
    month: month.label,
    value: forecastValue(client, year, month.n, "historicalMonthly"),
  }));
  const lastRecent = client.records.filter((r) => r.competencia >= key(year, Math.max(1, currentMonth - 2)));
  const noRecentOrders = lastRecent.length === 0 || lastRecent.every((r) => r.quantity <= 0);
  const annualBasisMonths = recordsForAnalysis.filter((r) => Number(r.competencia.slice(0, 4)) < year).length;
  const status = statusFrom(yoy, noRecentOrders, annualBasisMonths, previousTotal);
  const monthAttainment = attainmentForMonth(client, year, currentMonth, method, tolerance);
  const realizedAccumulated = realizedYearToMonth(client, year, currentMonth);
  const expectedAccumulated = expectedYearToMonth(client, year, currentMonth, method);
  return {
    historicalAverage,
    last12Average,
    yoy,
    currentProjected,
    previousTotal,
    annualBasisMonths,
    currentMonthVsHistory,
    trend3,
    trend,
    seasonal,
    status,
    currentMonthActual,
    monthAttainment,
    realizedAccumulated,
    expectedAccumulated,
    accumulatedDiff: realizedAccumulated - expectedAccumulated,
    accumulatedPct: percentChange(realizedAccumulated, expectedAccumulated),
  };
}

export function dashboard(clients, method = "historicalMonthly", options = {}) {
  const year = Number(options.year || CURRENT_YEAR);
  const currentMonth = Number(options.currentMonth || CURRENT_MONTH);
  const dashboardClients = clients.filter((client) => client.active !== false && client.dashboardActive !== false);
  const enriched = dashboardClients.map((client) => ({ client, analysis: analyzeClient(client, method, options) }));
  const totalCurrent = dashboardClients.reduce((sum, client) => {
    for (let month = 1; month <= currentMonth; month += 1) sum += valueFor(client, year, month) || 0;
    return sum;
  }, 0);
  const projectedTotal = dashboardClients.reduce((sum, client) => sum + projectedYearTotal(client, year, method, { activeYear: year, currentMonth }), 0);
  const lastYearTotal = dashboardClients.reduce((sum, client) => sum + yearTotal(client, year - 1), 0);
  const counts = enriched.reduce((acc, item) => {
    acc[item.analysis.status] = (acc[item.analysis.status] || 0) + 1;
    return acc;
  }, {});
  return {
    totalCurrent,
    projectedTotal,
    yoy: percentChange(projectedTotal, lastYearTotal),
    counts,
    rankingVolume: [...enriched].sort((a, b) => b.analysis.realizedAccumulated - a.analysis.realizedAccumulated),
    rankingGrowth: [...enriched].sort((a, b) => b.analysis.yoy - a.analysis.yoy),
    rankingDrop: [...enriched].sort((a, b) => a.analysis.yoy - b.analysis.yoy),
    noCurrentMonth: enriched.filter(({ client }) => !valueFor(client, year, currentMonth)),
    attainmentAbove: enriched.filter((item) => item.analysis.monthAttainment.status === "acima"),
    attainmentOk: enriched.filter((item) => item.analysis.monthAttainment.status === "esperado"),
    attainmentBelow: enriched.filter((item) => item.analysis.monthAttainment.status === "abaixo"),
    attainmentCritical: enriched.filter((item) => item.analysis.monthAttainment.status === "critico-projecao"),
    attainmentShort: enriched.filter((item) => item.analysis.monthAttainment.status === "base-curta"),
    attainmentPositive: enriched.filter((item) => item.analysis.monthAttainment.status === "acima").sort((a, b) => (b.analysis.monthAttainment.diff ?? -Infinity) - (a.analysis.monthAttainment.diff ?? -Infinity)),
    attainmentNegative: enriched.filter((item) => ["abaixo", "critico-projecao"].includes(item.analysis.monthAttainment.status)).sort((a, b) => (a.analysis.monthAttainment.diff ?? Infinity) - (b.analysis.monthAttainment.diff ?? Infinity)),
  };
}

export function buildClientTable(client, years, method, options = {}) {
  const activeYear = Number(options.year || CURRENT_YEAR);
  const currentMonth = Number(options.currentMonth || CURRENT_MONTH);
  const tolerance = Number(options.tolerance || 10);
  return MONTHS.map((month) => ({
    month: month.label,
    monthNumber: month.n,
    values: years.map((year) => ({
      year,
      ...projectedMonth(client, year, month.n, method, { year: activeYear, currentMonth }),
      record: client.records.find((r) => r.competencia === key(year, month.n)),
      attainment: year === activeYear ? attainmentForMonth(client, year, month.n, method, tolerance) : null,
      current: year === activeYear && month.n === currentMonth,
    })),
  }));
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Math.round(value).toLocaleString("pt-BR");
}

export function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(1).replace(".", ",")}%`;
}

export function percentChange(current, previous) {
  if (!previous) return current ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

function statusFrom(yoy, noRecentOrders, annualBasisMonths = 0, previousTotal = 0) {
  if (annualBasisMonths < 6 || !previousTotal) return "observacao";
  if (noRecentOrders || yoy < -20) return "critico";
  if (yoy < -10) return "atencao";
  if (yoy > 10) return "crescimento";
  return "regular";
}

function attainmentStatus(pct, tolerance, basisCount = 0) {
  if (!Number.isFinite(pct)) return "sem-realizado";
  if (basisCount < 2) return "base-curta";
  if (pct > tolerance) return "acima";
  if (pct >= -tolerance) return "esperado";
  if (pct >= -20) return "abaixo";
  return "critico-projecao";
}

function average(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (!clean.length) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function historicalMonthValues(client, year, month) {
  return activeRecords(client)
    .filter((r) => {
      const recordYear = Number(r.competencia.slice(0, 4));
      const recordMonth = Number(r.competencia.slice(5, 7));
      return recordYear < year && recordMonth === month;
    })
    .map((r) => r.quantity);
}

function activeRecords(client) {
  const sorted = [...client.records].sort((a, b) => a.competencia.localeCompare(b.competencia));
  const firstActiveIndex = sorted.findIndex((r) => r.quantity > 0);
  if (firstActiveIndex < 0) return sorted;
  return sorted.slice(firstActiveIndex);
}

function trendDetails(records) {
  const recent = [...records].sort((a, b) => a.competencia.localeCompare(b.competencia)).slice(-6);
  const previous = recent.slice(0, 3);
  const current = recent.slice(3);
  return {
    previous,
    current,
    previousAverage: average(previous.map((r) => r.quantity)),
    currentAverage: average(current.map((r) => r.quantity)),
  };
}
