import { normalizeRecords } from "./calculations.js";
import { CURRENT_MONTH, CURRENT_YEAR, key } from "./months.js";

const REQUIRED = ["Competencia", "Quantidade de Pedidos Negociados"];
const SKIP_SHEETS = new Set(["consolidado", "baseoriginal", "dashboard", "dashboarddeperformance"]);
const MONTH_LOOKUP = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

export async function importFiles(files) {
  const results = [];
  for (const file of files) {
    try {
      const clients = await readFile(file);
      clients.forEach((client) => results.push({ ok: true, client, file: `${file.name} / ${client.name}` }));
    } catch (error) {
      results.push({ ok: false, file: file.name, error: error.message });
    }
  }
  return results;
}

async function readFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".csv")) return [clientFromRows(cleanClientName(file.name), await readCsv(file))];
  if (lower.endsWith(".xlsx")) return readXlsx(file);
  throw new Error("Formato nao suportado. Use CSV ou XLSX.");
}

async function readCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) throw new Error("Arquivo vazio.");
  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line, delimiter);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  });
}

async function readXlsx(file) {
  await ensureXlsxReader();
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const workbookXml = await text(zip, "xl/workbook.xml");
  const relsXml = await text(zip, "xl/_rels/workbook.xml.rels");
  const shared = await sharedStrings(zip);
  const relMap = Object.fromEntries([...relsXml.matchAll(/<Relationship[^>]+Id="([^"]+)"[^>]+Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const sheets = [...workbookXml.matchAll(/<sheet[^>]+name="([^"]+)"[^>]+r:id="([^"]+)"/g)].map((m) => ({
    name: decodeXml(m[1]),
    path: `xl/${relMap[m[2]].replace(/^\/?xl\//, "")}`,
  }));

  const clients = [];
  for (const sheet of sheets) {
    if (SKIP_SHEETS.has(normalizeText(sheet.name))) continue;
    const rows = sheetXmlToArrays(await text(zip, sheet.path), shared);
    try {
      clientsFromSheet(sheet.name, rows).forEach((client) => {
        if (client.records.length) clients.push(client);
      });
    } catch {
      // Auxiliary sheets that are not in either supported layout are ignored.
    }
  }

  if (clients.length) return combineClientsByName(clients);
  const firstSheet = sheets[0];
  if (!firstSheet) throw new Error("Nenhuma aba encontrada no XLSX.");
  return [clientFromRows(cleanClientName(file.name), arraysToObjects(sheetXmlToArrays(await text(zip, firstSheet.path), shared)))];
}

async function ensureXlsxReader() {
  if (window.JSZip) return;
  await loadScript("./vendor/jszip.min.js").catch(() => loadScript("https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"));
  if (!window.JSZip) throw new Error(`Leitor XLSX indisponivel. Versao do portal: ${window.APP_VERSION || "desconhecida"}. Confirme se dist/app.bundle.js foi atualizado e se voce esta abrindo o dominio Pages correto.`);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src.endsWith(src.replace("./", "")) || script.src === src);
    if (existing && window.JSZip) return resolve();
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function clientsFromSheet(name, rows) {
  const yearlyClients = rowsToYearlyClientRecords(name, rows);
  if (yearlyClients.length) return yearlyClients.map((client) => makeClient(client.name, client.records));
  const matrixRecords = rowsToMatrixRecords(rows);
  if (matrixRecords.length) return [makeClient(name, matrixRecords)];
  return [clientFromRows(name, arraysToObjects(rows))];
}

function rowsToYearlyClientRecords(sheetName, rows) {
  const year = Number(String(sheetName || "").match(/20\d{2}/)?.[0]);
  if (!year) return [];
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "clientes") &&
    row.some((cell) => monthNumber(cell))
  );
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex];
  const clientColumn = headers.findIndex((cell) => normalizeText(cell) === "clientes");
  const monthColumns = headers
    .map((header, index) => ({ month: monthNumber(header), index }))
    .filter((item) => item.month);
  if (clientColumn < 0 || !monthColumns.length) return [];

  return rows.slice(headerIndex + 1).map((row) => {
    const name = String(row[clientColumn] || "").trim();
    if (!name || normalizeText(name) === "total") return null;
    const records = monthColumns.flatMap(({ month, index }) => {
      if (year === CURRENT_YEAR && month > CURRENT_MONTH) return [];
      const quantity = parseNumber(row[index]);
      if (!Number.isFinite(quantity)) return [];
      return [{ competencia: key(year, month), quantity, source: "importado", observation: "" }];
    });
    return { name, records };
  }).filter(Boolean);
}

function rowsToMatrixRecords(rows) {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => normalizeText(cell) === "mes") &&
    row.some((cell) => /^\d{4}$/.test(String(cell || "").trim()))
  );
  if (headerIndex < 0) return [];

  const headers = rows[headerIndex].map((cell) => String(cell || "").trim());
  const yearColumns = headers
    .map((header, index) => ({ year: Number(header), index }))
    .filter((item) => Number.isInteger(item.year) && item.year >= 2000 && item.year <= CURRENT_YEAR);
  const records = [];

  rows.slice(headerIndex + 1).forEach((row) => {
    const month = monthNumber(row[0]);
    if (!month) return;
    yearColumns.forEach(({ year, index }) => {
      if (year === CURRENT_YEAR && month > CURRENT_MONTH) return;
      const quantity = parseNumber(row[index]);
      if (Number.isFinite(quantity)) records.push({ competencia: key(year, month), quantity, source: "importado", observation: "" });
    });
  });

  return records;
}

function clientFromRows(name, rows) {
  return makeClient(name, rowsToRecords(rows));
}

function makeClient(name, records) {
  return {
    id: crypto.randomUUID(),
    name,
    cnpj: "",
    erp: "",
    segment: "",
    owner: "",
    notes: "",
    active: true,
    records: normalizeRecords(records),
    comments: [],
    importedAt: new Date().toISOString(),
  };
}

function combineClientsByName(clients) {
  const map = new Map();
  clients.forEach((client) => {
    const id = normalizeText(client.name);
    const existing = map.get(id);
    if (!existing) {
      map.set(id, client);
      return;
    }
    existing.records = normalizeRecords([...existing.records, ...client.records]);
    existing.importedAt = new Date().toISOString();
  });
  return [...map.values()];
}

function sheetXmlToArrays(xml, shared) {
  return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rowMatch) => {
    const row = [];
    [...rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].forEach((cellMatch) => {
      const ref = cellMatch[1].match(/r="([A-Z]+)\d+"/)?.[1];
      const type = cellMatch[1].match(/t="([^"]+)"/)?.[1];
      const raw = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const inline = [...cellMatch[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");
      row[columnToIndex(ref)] = type === "s" ? shared[Number(raw)] || "" : inline || raw;
    });
    return row;
  });
}

function arraysToObjects(rows) {
  const headerIndex = rows.findIndex((row) => row.some(Boolean));
  if (headerIndex < 0) return [];
  const headers = rows[headerIndex].map((header) => String(header || "").trim());
  return rows.slice(headerIndex + 1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function rowsToRecords(rows) {
  const headerMap = headerAliases(Object.keys(rows[0] || {}));
  const missing = REQUIRED.filter((name) => !headerMap[name]);
  if (missing.length) throw new Error(`Colunas obrigatorias ausentes: ${missing.join(", ")}.`);
  const records = rows.map((row) => ({
    competencia: normalizeCompetencia(row[headerMap["Competencia"]]),
    quantity: parseNumber(row[headerMap["Quantidade de Pedidos Negociados"]]),
  }));
  if (!records.some((r) => r.competencia && Number.isFinite(r.quantity))) throw new Error("Nenhum registro valido encontrado.");
  return records;
}

function headerAliases(headers) {
  const map = {};
  headers.forEach((header) => {
    const normalized = normalizeText(header);
    if (normalized === "competencia" || normalized === "mesano") map["Competencia"] = header;
    if ((normalized.includes("quantidade") && normalized.includes("pedidos")) || normalized.includes("pedidosnegociados")) {
      map["Quantidade de Pedidos Negociados"] = header;
    }
  });
  return map;
}

function normalizeCompetencia(value) {
  const textValue = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(textValue)) return textValue;
  const serial = Number(textValue);
  if (Number.isFinite(serial) && serial > 25000) {
    const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
    return key(date.getUTCFullYear(), date.getUTCMonth() + 1);
  }
  return textValue;
}

async function sharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("text");
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) =>
    [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("")
  );
}

async function text(zip, name) {
  const file = zip.file(name);
  if (!file) throw new Error(`Estrutura XLSX invalida: ${name} nao encontrado.`);
  return file.async("text");
}

function monthNumber(value) {
  return MONTH_LOOKUP[normalizeText(value)] || null;
}

function parseNumber(value) {
  if (typeof value === "number") return value;
  const clean = String(value || "").trim();
  if (!clean) return NaN;
  return Number(clean.replace(/\./g, "").replace(",", "."));
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function columnToIndex(name) {
  if (!name) return 0;
  return name.split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function detectDelimiter(header) {
  return header.includes(";") ? ";" : ",";
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function cleanClientName(name) {
  return name.replace(/\.(csv|xlsx)$/i, "").replace(/[_-]+/g, " ").trim();
}

function decodeXml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
}
