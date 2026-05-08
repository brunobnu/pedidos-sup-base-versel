const { error, insertComment, readBody, send } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { clientId, comment } = await readBody(req);
    return send(res, 200, await insertComment(clientId, comment || {}));
  } catch (err) {
    return error(res, err, "Nao foi possivel salvar comentario.");
  }
};
