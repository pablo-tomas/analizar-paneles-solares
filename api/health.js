// =========================================================
// api/health.js
// Endpoint trivial para verificar que las funciones serverless
// están desplegadas correctamente. Acceso: GET /api/health
// =========================================================

module.exports = async function handler(req, res) {
  return res.status(200).json({
    ok: true,
    apiKeyConfigured: Boolean(process.env.ROBOFLOW_API_KEY),
    runtime: process.version,
    timestamp: new Date().toISOString()
  });
};
