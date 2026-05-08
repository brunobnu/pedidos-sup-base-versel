import { key } from "./months.js";

const shapes = {
  "Alfa Distribuidora": [710, 520, 610, 780, 820, 760, 690, 740, 800, 840, 860, 910],
  "Beta Atacado": [420, 380, 410, 440, 500, 530, 490, 470, 455, 430, 410, 395],
  "Gamma Foods": [230, 260, 310, 340, 360, 390, 410, 430, 470, 510, 560, 620],
  "Delta Varejo": [590, 610, 580, 560, 540, 510, 490, 460, 430, 410, 360, 330],
  "Epsilon Farma": [180, 210, 190, 220, 260, 240, 280, 300, 270, 310, 340, 360],
};

export function createMockClients() {
  return Object.entries(shapes).map(([name, base], idx) => {
    const records = [];
    for (let year = 2022; year <= 2026; year += 1) {
      const limit = year === 2026 ? 4 : 12;
      for (let month = 1; month <= limit; month += 1) {
        const trend = 1 + (year - 2022) * (idx === 2 ? 0.1 : idx === 3 ? -0.07 : idx === 1 ? -0.02 : 0.04);
        const seasonal = 1 + Math.sin((month + idx) / 2) * 0.05;
        const value = Math.max(0, Math.round(base[month - 1] * trend * seasonal));
        records.push({ id: crypto.randomUUID(), competencia: key(year, month), quantity: value, source: "importado", observation: "" });
      }
    }
    if (name === "Delta Varejo") records.splice(records.findIndex((r) => r.competencia === "2026-04"), 1);
    return {
      id: crypto.randomUUID(),
      name,
      cnpj: "",
      erp: "",
      segment: idx % 2 ? "Distribuicao" : "Industria",
      owner: "Comercial",
      notes: "",
      active: true,
      dashboardActive: true,
      records,
      comments: idx === 3 ? [{
        id: crypto.randomUUID(),
        competencia: "2026-03",
        observation: "Queda concentrada no fechamento do trimestre.",
        reason: "Reducao de compras recorrentes",
        owner: "Comercial",
        nextAction: "Revisar carteira e confirmar previsao de maio",
        actionDate: "2026-05-06",
        createdAt: new Date().toISOString(),
      }] : [],
      importedAt: new Date().toISOString(),
    };
  });
}
