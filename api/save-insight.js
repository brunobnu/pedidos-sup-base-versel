const { error, readBody, saveInsight, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    return send(res, 200, await saveInsight(await readBody(req)));
  } catch (err) {
    return error(res, err, "Nao foi possivel salvar analise.");
  }
};

