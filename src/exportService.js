import { buildClientTable, formatNumber, projectedYearTotal, yearTotal } from "./calculations.js";
import { CURRENT_YEAR, MONTHS } from "./months.js";

export function exportDashboardPdf() {
  window.print();
}

export async function exportClientXlsx(client, years, method, options = {}) {
  const activeYear = options.year || CURRENT_YEAR;
  const table = buildClientTable(client, years, method, options);
  const rows = [["Mes", ...years.map(String)]];
  table.forEach((row) => rows.push([row.month, ...row.values.map((cell) => Math.round(cell.value || 0))]));
  rows.push(["Total", ...years.map((year) => Math.round(year === activeYear ? projectedYearTotal(client, year, method, options) : yearTotal(client, year)))]);
  await downloadWorkbook(`${safe(client.name)}_analise.xlsx`, [{ name: client.name.slice(0, 31), rows }]);
}

export async function exportAllClientsXlsx(clients, years, method, options = {}) {
  const activeYear = options.year || CURRENT_YEAR;
  const sheets = clients.map((client) => {
    const table = buildClientTable(client, years, method, options);
    const rows = [["Mes", ...years.map(String)]];
    table.forEach((row) => rows.push([row.month, ...row.values.map((cell) => Math.round(cell.value || 0))]));
    rows.push(["Total", ...years.map((year) => Math.round(year === activeYear ? projectedYearTotal(client, year, method, options) : yearTotal(client, year)))]);
    return { name: client.name.slice(0, 31), rows };
  });
  await downloadWorkbook("analise_todos_clientes.xlsx", sheets);
}

export function exportCsvSnapshot(clients, method) {
  const rows = [["Cliente", "Mes", "Ano", "Pedidos", "Tipo"]];
  clients.forEach((client) => {
    for (const year of [2022, 2023, 2024, 2025, 2026]) {
      MONTHS.forEach((month) => {
        const actual = client.records.find((r) => r.competencia === `${year}-${String(month.n).padStart(2, "0")}`);
        rows.push([client.name, month.label, year, actual?.quantity ?? "", actual ? "Real" : ""]);
      });
    }
  });
  const csv = rows.map((row) => row.map(escapeCsv).join(";")).join("\n");
  downloadBlob("base_clientes.csv", new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

async function downloadWorkbook(filename, sheets) {
  if (!window.JSZip) {
    const html = sheets.map((sheet) => tableHtml(sheet.rows)).join("<br>");
    downloadBlob(filename.replace(".xlsx", ".xls"), new Blob([html], { type: "application/vnd.ms-excel" }));
    return;
  }
  const zip = new window.JSZip();
  zip.file("[Content_Types].xml", contentTypes(sheets.length));
  zip.folder("_rels").file(".rels", rootRels());
  zip.file("xl/workbook.xml", workbookXml(sheets));
  zip.folder("xl").folder("_rels").file("workbook.xml.rels", workbookRels(sheets.length));
  zip.folder("xl").file("styles.xml", stylesXml());
  const worksheets = zip.folder("xl").folder("worksheets");
  sheets.forEach((sheet, index) => worksheets.file(`sheet${index + 1}.xml`, worksheetXml(sheet.rows)));
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  downloadBlob(filename, blob);
}

function worksheetXml(rows) {
  const body = rows.map((row, r) => {
    const cells = row.map((value, c) => {
      const ref = `${columnName(c + 1)}${r + 1}`;
      const style = r === 0 ? 1 : r === rows.length - 1 ? 2 : 0;
      if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xml(value)}</t></is></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><sheetData>${body}</sheetData></worksheet>`;
}

function workbookXml(sheets) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${xml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`;
}

function workbookRels(count) {
  const rels = Array.from({ length: count }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}<Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function contentTypes(count) {
  const sheets = Array.from({ length: count }, (_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17324D"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEF5"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB8C2CC"/></left><right style="thin"><color rgb="FFB8C2CC"/></right><top style="thin"><color rgb="FFB8C2CC"/></top><bottom style="thin"><color rgb="FFB8C2CC"/></bottom></border></borders><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1"/></cellXfs></styleSheet>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function tableHtml(rows) {
  return `<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</table>`;
}

function downloadBlob(filename, blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function columnName(index) {
  let name = "";
  while (index > 0) {
    const mod = (index - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    index = Math.floor((index - mod) / 26);
  }
  return name;
}

function xml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function safe(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "_");
}
