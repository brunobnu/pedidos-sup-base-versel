const { error, readBody, send, upsertClient } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { client } = await readBody(req);
    const saved = await upsertClient(client || {});
    return send(res, 200, { client: saved });
  } catch (err) {
    return error(res, err, "Nao foi possivel salvar cliente.");
  }
};

