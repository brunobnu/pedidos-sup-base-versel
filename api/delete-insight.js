const { deleteInsight, error, readBody, send } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { insightId } = await readBody(req);
    return send(res, 200, await deleteInsight(insightId));
  } catch (err) {
    return error(res, err, "Nao foi possivel excluir analise.");
  }
};
