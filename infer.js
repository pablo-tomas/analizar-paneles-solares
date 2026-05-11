// =========================================================
// api/infer.js
// Función serverless (Vercel) que actúa como proxy entre el
// navegador del usuario y la Hosted Inference API de Roboflow.
//
// La API Key se lee de una variable de entorno (ROBOFLOW_API_KEY)
// configurada en el panel de Vercel, así que nunca llega al cliente.
// =========================================================

export default async function handler(req, res) {
  // Solo aceptamos POST
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // 1) Leer la API Key del entorno (NO del cliente)
  const apiKey = process.env.ROBOFLOW_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "El backend no tiene configurada la variable ROBOFLOW_API_KEY."
    });
  }

  // 2) Leer y validar lo que envía el navegador
  const { project, version, confidence, image, imageUrl } = req.body || {};

  if (!project || !version) {
    return res.status(400).json({ error: "Faltan campos: project y version son obligatorios." });
  }
  if (!image && !imageUrl) {
    return res.status(400).json({ error: "Hay que enviar 'image' (base64) o 'imageUrl'." });
  }

  // 3) Construir la URL para Roboflow
  const qs = new URLSearchParams({
    api_key: apiKey,
    confidence: String(confidence ?? 40),
    format: "json"
  });
  if (imageUrl) qs.set("image", imageUrl);

  const url = `https://detect.roboflow.com/${encodeURIComponent(project)}/${encodeURIComponent(version)}?${qs.toString()}`;

  // 4) Llamar a Roboflow
  try {
    let rfResponse;
    if (imageUrl) {
      // Roboflow descarga la imagen por su cuenta
      rfResponse = await fetch(url, { method: "POST" });
    } else {
      // Le pasamos la imagen como base64 en el cuerpo
      rfResponse = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: image
      });
    }

    const text = await rfResponse.text();
    let payload;
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

    if (!rfResponse.ok) {
      return res.status(rfResponse.status).json({
        error: "Error de Roboflow",
        status: rfResponse.status,
        details: payload
      });
    }
    return res.status(200).json(payload);

  } catch (err) {
    return res.status(500).json({ error: "Fallo al llamar a Roboflow: " + err.message });
  }
}

// Subir el límite del cuerpo a 8 MB (por defecto Vercel acepta 4.5 MB).
// El frontend además redimensiona la imagen antes de enviarla.
export const config = {
  api: {
    bodyParser: { sizeLimit: "8mb" }
  }
};
