const { error, getLatestSettings, readBody, saveSettings, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  try {
    if (req.method === "GET") return send(res, 200, await getLatestSettings());
    if (req.method === "POST") {
      const { settings } = await readBody(req);
      return send(res, 200, await saveSettings(settings || {}));
    }
    return send(res, 405, { error: "Metodo nao permitido." });
  } catch (err) {
    return error(res, err, "Nao foi possivel salvar configuracoes.");
  }
};

