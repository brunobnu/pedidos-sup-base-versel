const { error, readBody, send, upsertRecord } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { clientId, record } = await readBody(req);
    return send(res, 200, await upsertRecord(clientId, record));
  } catch (err) {
    return error(res, err, "Nao foi possivel salvar competencia.");
  }
};

