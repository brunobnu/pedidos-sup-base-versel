const { bulkUpsertClients, error, readBody, send } = require("../lib/supabaseApi");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    const { clients } = await readBody(req);
    if (!Array.isArray(clients)) return send(res, 400, { error: "Lista de clientes invalida." });
    return send(res, 200, await bulkUpsertClients(clients));
  } catch (err) {
    return error(res, err, "Nao foi possivel importar clientes.");
  }
};

