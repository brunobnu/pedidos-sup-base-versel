const { error, fetchInsights, readBody, saveInsight, send } = require("./_supabase");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return send(res, 200, await fetchInsights());
    if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return send(res, 500, { error: "Chave Gemini nao configurada." });
    if (/sua_chave|cole_sua_chave|chave_real_aqui|your_api_key|api_key/i.test(apiKey)) {
      return send(res, 500, { error: "Chave Gemini nao configurada." });
    }

    const payload = await readBody(req);
    const validation = validatePayload(payload);
    if (validation) return send(res, 400, { error: validation });

    const prompt = buildPrompt(payload);
    const text = await callGemini(apiKey, prompt);
    const result = normalizeResult(parseJsonText(text));
    const resultError = validateResult(result);
    if (resultError) return send(res, 502, { error: resultError });

    const saved = await saveInsight({
      insight: {
        clientId: payload.clientId,
        monthsAhead: payload.monthsAhead,
        result,
        input: payload,
        creditsUsed: 10,
        createdBy: payload.createdBy || "",
      },
    });
    return send(res, 200, { result, analysis: saved.analysis });
  } catch (err) {
    return error(res, normalizeGeminiError(err), "Nao foi possivel gerar a analise.");
  }
};

async function callGemini(apiKey, prompt) {
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    });
    const text = typeof response.text === "function" ? response.text() : response.text;
    if (!text) throw new Error("Resposta invalida da IA.");
    return text;
  } catch (err) {
    if (/Cannot find package|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i.test(err?.message || "")) {
      return callGeminiRest(apiKey, prompt);
    }
    throw err;
  }
}

async function callGeminiRest(apiKey, prompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.2,
      },
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error?.message || "Falha na Gemini API.");
    err.statusCode = response.status;
    err.geminiStatus = body.error?.status;
    throw err;
  }
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Resposta invalida da IA.");
  return text;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") return "Payload invalido.";
  if (!payload.clientId || !payload.clientName) return "Cliente obrigatorio.";
  if (![3, 6, 12].includes(Number(payload.monthsAhead))) return "Periodo invalido.";
  if (!Array.isArray(payload.historicalData) || payload.historicalData.length < 3) return "Cliente sem dados suficientes.";
  if (!Array.isArray(payload.projections) || !payload.projections.length) return "Projecoes invalidas.";
  if (!Number.isFinite(Number(payload.activeYear))) return "Ano ativo invalido.";
  return "";
}

function buildPrompt(payload) {
  return `Voce e um analista executivo de pedidos B2B.
Responda em portugues do Brasil, com linguagem profissional, direta, objetiva e pratica.
Use somente os dados enviados abaixo.
Nao invente contexto externo.
Cite numeros reais do cliente quando fizer recomendacoes.
Se houver pouco historico, indique incerteza.

Retorne somente JSON valido neste formato:
{
  "executiveSummary": "",
  "expectedTrend": "",
  "risks": [],
  "opportunities": [],
  "recommendations": [],
  "attentionPoints": [],
  "forecastSummary": {
    "predictedOrders": 0,
    "historicalMonthlyAverage": 0,
    "projectedMonthlyAverage": 0,
    "projectedGrowthPercent": 0,
    "riskStatus": "baixo"
  }
}

Valores permitidos para riskStatus: "baixo", "moderado", "alto", "critico".

Cliente: ${payload.clientName}
Periodo solicitado: proximos ${payload.monthsAhead} meses
Ano ativo: ${payload.activeYear}
Tolerancia de atingimento: ${payload.tolerance}%
Status atual e indicadores calculados: ${JSON.stringify(payload.currentStatus)}

Historico mensal:
${JSON.stringify(payload.historicalData)}

Projecoes calculadas pela aplicacao:
${JSON.stringify(payload.projections)}

Considere historico mensal, projecoes, tendencia dos ultimos meses, sazonalidade, variacao vs ano anterior, realizado vs projetado, meses criticos, risco de queda e proximos meses. O campo forecastSummary.predictedOrders deve ser a soma das projecoes enviadas para o periodo solicitado.`;
}

function parseJsonText(text) {
  const clean = String(text || "")
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(clean);
}

function normalizeResult(result) {
  if (!result || typeof result !== "object") return {};
  result.forecastSummary ||= {};
  result.risks ||= [];
  result.opportunities ||= [];
  result.recommendations ||= [];
  result.attentionPoints ||= [];
  ["predictedOrders", "historicalMonthlyAverage", "projectedMonthlyAverage", "projectedGrowthPercent"].forEach((field) => {
    result.forecastSummary[field] = Number(result.forecastSummary[field]) || 0;
  });
  return result;
}

function validateResult(result) {
  const required = ["executiveSummary", "expectedTrend", "risks", "opportunities", "recommendations", "attentionPoints", "forecastSummary"];
  if (!result || typeof result !== "object" || required.some((field) => !(field in result))) return "Resposta invalida da IA.";
  if (!["baixo", "moderado", "alto", "critico"].includes(result.forecastSummary?.riskStatus)) return "Status de risco invalido na resposta da IA.";
  if (["risks", "opportunities", "recommendations", "attentionPoints"].some((field) => !Array.isArray(result[field]))) return "Resposta invalida da IA.";
  return "";
}

function normalizeGeminiError(err) {
  const raw = err?.message || "";
  const status = err?.statusCode || err?.status || 500;
  const normalized = new Error("Nao foi possivel gerar a analise.");
  normalized.statusCode = status;
  if (status === 429 || /quota|limit|rate|RESOURCE_EXHAUSTED/i.test(raw)) {
    normalized.message = "Limite gratuito da IA atingido.";
    normalized.statusCode = 429;
  } else if (status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(raw)) {
    normalized.message = "Nao foi possivel gerar a analise. Detalhe Gemini: UNAVAILABLE - modelo temporariamente indisponivel por alta demanda.";
    normalized.statusCode = 503;
  } else if (status === 400 || status === 401 || status === 403 || /API key|permission|PERMISSION_DENIED|UNAUTHENTICATED/i.test(raw)) {
    normalized.message = "Nao foi possivel gerar a analise. Verifique se a chave Gemini e valida.";
    normalized.statusCode = status;
  } else if (/Resposta invalida|JSON/i.test(raw)) {
    normalized.message = "Resposta invalida da IA.";
    normalized.statusCode = 502;
  }
  return normalized;
}
