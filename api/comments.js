const { error, fetchComments, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const url = new URL(req.url, "http://localhost");
    return send(res, 200, await fetchComments(url.searchParams.get("clientId")));
  } catch (err) {
    return error(res, err, "Nao foi possivel listar comentarios.");
  }
};

