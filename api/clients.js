const { error, fetchClients, send } = require("./_supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, { error: "Metodo nao permitido." });
  try {
    return send(res, 200, await fetchClients());
  } catch (err) {
    return error(res, err, "Nao foi possivel listar clientes.");
  }
};
