const { deleteClient, error, readBody, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { clientId } = await readBody(req);
    return send(res, 200, await deleteClient(clientId));
  } catch (err) {
    return error(res, err, "Nao foi possivel excluir cliente.");
  }
};

