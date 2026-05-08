const { deleteRecord, error, readBody, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { clientId, competencia } = await readBody(req);
    return send(res, 200, await deleteRecord(clientId, competencia));
  } catch (err) {
    return error(res, err, "Nao foi possivel excluir competencia.");
  }
};

