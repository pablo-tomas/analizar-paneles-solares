/* =========================================================
   app.js — Lógica del analizador (v2)

   - Navegación por pestañas
   - CRUD de modelos (alta, edición, borrado) con persistencia
     en localStorage + import/export a JSON
   - Llamada de inferencia a /api/infer (proxy serverless)
   ========================================================= */

// ---------- Constantes y estado --------------------------
const STORAGE_KEY = "rf_models_v2";
const EXAMPLES_URL = "models.example.json";  // se carga la 1ª vez

let editingId = null;  // id del modelo en edición, o null si es alta

// ---------- Helpers --------------------------------------
const $ = (id) => document.getElementById(id);

const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));

function showStatus(boxId, msg, type) {
  if (type == null) type = "info";
  const box = $(boxId);
  box.textContent = msg;
  box.className = "visible status-" + type;
}
function clearStatus(boxId) {
  $(boxId).className = "";
}

function colorForClass(cls) {
  const palette = ["#e53e3e","#dd6b20","#d69e2e","#38a169","#319795","#3182ce","#805ad5","#d53f8c"];
  let h = 0;
  for (let i = 0; i < cls.length; i++) h = cls.charCodeAt(i) + ((h << 5) - h);
  return palette[Math.abs(h) % palette.length];
}

// ---------- Almacén de modelos ---------------------------
function loadModels() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch (_) { return []; }
}
function saveModels(models) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models));
}

async function ensureExamplesLoaded() {
  if (loadModels().length > 0) return;
  try {
    const res = await fetch(EXAMPLES_URL);
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data.models)) {
      saveModels(data.models);
    }
  } catch (_) { /* sin ejemplos, seguimos */ }
}

// ---------- Pestañas -------------------------------------
document.querySelectorAll("#tabs .tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs .tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------- Renderizado del listado y del selector --------
function renderModelList() {
  const models = loadModels();
  const ul = $("model-list");
  ul.innerHTML = "";
  if (models.length === 0) {
    ul.innerHTML = '<li style="font-style:italic;color:#718096;">Sin modelos. Añade uno en el formulario de abajo o importa un JSON.</li>';
    return;
  }
  models.forEach(m => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <div><b>${escapeHtml(m.name)}</b></div>
        <div class="model-meta">
          ${escapeHtml(m.workspace || "")}/${escapeHtml(m.project)} · v${escapeHtml(m.version)}
          ${m.imageType ? " · " + escapeHtml(m.imageType) : ""}
          ${m.modelType ? " · " + escapeHtml(m.modelType) : ""}
        </div>
      </div>
      <div class="row-buttons">
        <button class="btn-small" data-action="edit"   data-id="${m.id}">Editar</button>
        <button class="btn-danger" data-action="delete" data-id="${m.id}">Eliminar</button>
      </div>
    `;
    ul.appendChild(li);
  });
  ul.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.id;
      if (btn.dataset.action === "edit")   startEdit(id);
      if (btn.dataset.action === "delete") deleteModel(id);
    });
  });
}

function renderModelSelector() {
  const models = loadModels();
  const sel = $("model-selector");
  const current = sel.value;
  sel.innerHTML = '<option value="">— Selecciona un modelo configurado —</option>';
  models.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    sel.appendChild(opt);
  });
  if (models.some(m => m.id === current)) sel.value = current;
  renderModelInfo();
}

function renderModelInfo() {
  const sel = $("model-selector");
  const info = $("model-info");
  const m = loadModels().find(x => x.id === sel.value);
  if (!m) { info.classList.remove("visible"); info.innerHTML = ""; return; }

  const rows = [
    ["Workspace / Project", (m.workspace || "?") + "/" + m.project + " · v" + m.version],
    ["Tipo de imagen", m.imageType],
    ["Nº de imágenes", m.totalImages],
    ["División train/valid/test", m.split],
    ["Tipo de modelo", m.modelType],
    ["mAP @50", m.metrics && m.metrics.mAP50],
    ["Precisión", m.metrics && m.metrics.precision],
    ["Recall", m.metrics && m.metrics.recall],
    ["Tamaño de entrada", m.metrics && m.metrics.inputSize]
  ].filter(([_, v]) => v !== undefined && v !== null && v !== "");

  if (rows.length === 0) { info.classList.remove("visible"); return; }
  info.innerHTML = "<dl>" + rows.map(
    ([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`
  ).join("") + "</dl>";
  info.classList.add("visible");
}

// ---------- Formulario: alta y edición -------------------
function readForm() {
  let descriptions;
  const descRaw = $("f-descriptions").value.trim();
  try { descriptions = JSON.parse(descRaw); }
  catch (_) { return { error: "El JSON de descripciones no es válido." }; }
  if (typeof descriptions !== "object" || Array.isArray(descriptions)) {
    return { error: "Las descripciones deben ser un objeto JSON {clase: texto, ...}." };
  }

  const model = {
    id: editingId || ("m_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7)),
    name:        $("f-name").value.trim(),
    workspace:   $("f-workspace").value.trim(),
    project:     $("f-project").value.trim(),
    version:     parseInt($("f-version").value, 10),
    descriptions,
    imageType:   $("f-image-type").value,
    totalImages: $("f-total-images").value ? parseInt($("f-total-images").value, 10) : null,
    split:       $("f-split").value.trim(),
    modelType:   $("f-model-type").value.trim(),
    metrics: {
      mAP50:     $("f-map50").value.trim(),
      precision: $("f-precision").value.trim(),
      recall:    $("f-recall").value.trim(),
      inputSize: $("f-input-size").value.trim()
    }
  };
  if (!model.name || !model.workspace || !model.project || !model.version) {
    return { error: "Faltan campos obligatorios: nombre, workspace, project y versión." };
  }
  return { model };
}

function fillForm(m) {
  $("f-name").value         = m.name || "";
  $("f-workspace").value    = m.workspace || "";
  $("f-project").value      = m.project || "";
  $("f-version").value      = m.version || "";
  $("f-descriptions").value = JSON.stringify(m.descriptions || {}, null, 2);
  $("f-image-type").value   = m.imageType || "";
  $("f-total-images").value = m.totalImages || "";
  $("f-split").value        = m.split || "";
  $("f-model-type").value   = m.modelType || "";
  $("f-map50").value        = (m.metrics && m.metrics.mAP50) || "";
  $("f-precision").value    = (m.metrics && m.metrics.precision) || "";
  $("f-recall").value       = (m.metrics && m.metrics.recall) || "";
  $("f-input-size").value   = (m.metrics && m.metrics.inputSize) || "";
}

function clearForm() {
  ["f-name","f-workspace","f-project","f-version","f-descriptions",
   "f-total-images","f-split","f-model-type","f-map50","f-precision",
   "f-recall","f-input-size"].forEach(id => { $(id).value = ""; });
  $("f-image-type").value = "";
}

function startEdit(id) {
  const m = loadModels().find(x => x.id === id);
  if (!m) return;
  editingId = id;
  fillForm(m);
  $("form-title").textContent = "Editar modelo";
  $("save-btn").textContent = "Guardar cambios";
  $("cancel-btn").style.display = "inline-block";
  $("form-section").scrollIntoView({ behavior: "smooth" });
}

function cancelEdit() {
  editingId = null;
  clearForm();
  $("form-title").textContent = "Añadir un nuevo modelo";
  $("save-btn").textContent = "Añadir modelo";
  $("cancel-btn").style.display = "none";
  clearStatus("form-status");
}

function deleteModel(id) {
  const models = loadModels();
  const m = models.find(x => x.id === id);
  if (!m) return;
  if (!confirm(`¿Eliminar el modelo "${m.name}"?`)) return;
  saveModels(models.filter(x => x.id !== id));
  renderModelList();
  renderModelSelector();
  updateAnalyzeState();
  if (editingId === id) cancelEdit();
}

$("save-btn").addEventListener("click", () => {
  const r = readForm();
  if (r.error) { showStatus("form-status", r.error, "error"); return; }
  const models = loadModels();
  const idx = models.findIndex(x => x.id === r.model.id);
  if (idx >= 0) models[idx] = r.model;
  else models.push(r.model);
  saveModels(models);

  const wasEdit = editingId !== null;
  cancelEdit();
  renderModelList();
  renderModelSelector();
  updateAnalyzeState();
  showStatus("form-status", wasEdit ? "Modelo actualizado." : "Modelo añadido.", "success");
});

$("cancel-btn").addEventListener("click", cancelEdit);

// ---------- Exportar / Importar / Reset ------------------
$("export-btn").addEventListener("click", () => {
  const payload = { exportedAt: new Date().toISOString(), models: loadModels() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "models.json";
  document.body.appendChild(a); a.click(); a.remove();
});

$("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const incoming = Array.isArray(data) ? data : data.models;
      if (!Array.isArray(incoming)) throw new Error("El JSON no contiene un array 'models'.");
      incoming.forEach(m => { if (!m.id) m.id = "m_" + Date.now() + "_" + Math.random().toString(36).slice(2,7); });
      saveModels(incoming);
      renderModelList();
      renderModelSelector();
      updateAnalyzeState();
      showStatus("form-status", `Importados ${incoming.length} modelos.`, "success");
    } catch (err) {
      showStatus("form-status", "Error al importar: " + err.message, "error");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

$("reset-btn").addEventListener("click", async () => {
  if (!confirm("Esto descarta tus modelos actuales y recarga los ejemplos. ¿Continuar?")) return;
  localStorage.removeItem(STORAGE_KEY);
  await ensureExamplesLoaded();
  renderModelList();
  renderModelSelector();
  updateAnalyzeState();
  showStatus("form-status", "Ejemplos recargados.", "success");
});

// ---------- Analizar -------------------------------------
$("model-selector").addEventListener("change", () => { renderModelInfo(); updateAnalyzeState(); });
$("image-file").addEventListener("change", updateAnalyzeState);
$("image-url").addEventListener("input", updateAnalyzeState);
$("confidence").addEventListener("input", () => {
  $("conf-display").textContent = $("confidence").value + " %";
});

function updateAnalyzeState() {
  const hasModel = $("model-selector").value !== "";
  const hasImage = $("image-file").files.length > 0 || $("image-url").value.trim() !== "";
  $("analyze-btn").disabled = !(hasModel && hasImage);
}

$("analyze-btn").addEventListener("click", runInference);

// Redimensiona la imagen a un máximo de lado largo para evitar
// payloads enormes (límite del proxy y de Roboflow).
function resizeImage(file, maxSide) {
  if (maxSide == null) maxSide = 1280;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL("image/jpeg", 0.88);
      resolve({ base64: dataUrl.split(",")[1], displayUrl: dataUrl });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// Parseo robusto de la respuesta del backend:
// si no es JSON, mensaje claro al usuario en lugar de "Unexpected token..."
async function parseBackendResponse(r) {
  const text = await r.text();
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("application/json") >= 0) {
    try { return { ok: true, json: JSON.parse(text) }; }
    catch (e) {
      return { ok: false, error:
        `El backend dijo que devolvía JSON pero no se pudo parsear (HTTP ${r.status}).` };
    }
  }
  // Respuesta NO-JSON: típicamente la página 404 de Vercel
  let hint = "";
  if (text.indexOf("The page could not be found") >= 0 || r.status === 404) {
    hint =
      "Parece que el endpoint /api/infer no existe en este despliegue. Comprueba que:\n" +
      "  1) La carpeta 'api/' está en la RAÍZ del repo en GitHub (no dentro de otra carpeta).\n" +
      "  2) Vercel ha completado un deploy DESPUÉS de subir api/infer.js.\n" +
      "  3) Visita /api/health en tu URL de Vercel: debería devolver JSON con ok:true.";
  }
  return { ok: false, error:
    `Respuesta inesperada (HTTP ${r.status}, content-type: ${ct || "desconocido"}).\n` +
    hint + "\n\nCuerpo recibido (primeros 200 caracteres):\n" + text.slice(0, 200) };
}

async function runInference() {
  const model = loadModels().find(x => x.id === $("model-selector").value);
  if (!model) return;
  const conf = parseInt($("confidence").value, 10);

  $("detections-list").innerHTML = "";
  $("result-canvas").classList.remove("visible");
  showStatus("status", "Enviando imagen al backend...", "loading");
  $("analyze-btn").disabled = true;

  try {
    let body, displaySrc;
    if ($("image-file").files.length > 0) {
      const out = await resizeImage($("image-file").files[0]);
      displaySrc = out.displayUrl;
      body = {
        project: model.project,
        version: model.version,
        confidence: conf,
        image: out.base64
      };
    } else {
      const url = $("image-url").value.trim();
      displaySrc = url;
      body = {
        project: model.project,
        version: model.version,
        confidence: conf,
        imageUrl: url
      };
    }

    const r = await fetch("/api/infer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const parsed = await parseBackendResponse(r);
    if (!parsed.ok) throw new Error(parsed.error);
    const result = parsed.json;

    if (!r.ok) {
      const detail = (result && typeof result.details === "object")
        ? JSON.stringify(result.details)
        : (result && result.details) || "";
      throw new Error(((result && result.error) || "Error") + (detail ? " — " + detail : ""));
    }

    await drawResults(displaySrc, result, model.descriptions || {});

    const n = (result.predictions || []).length;
    showStatus("status",
      n === 0 ? "Análisis completado. Sin detecciones por encima del umbral."
              : `Análisis completado. ${n} detección(es).`,
      n === 0 ? "info" : "success");
  } catch (err) {
    showStatus("status", "Error: " + err.message, "error");
    console.error(err);
  } finally {
    updateAnalyzeState();
  }
}

function drawResults(src, result, descriptions) {
  return new Promise((resolve) => {
    const canvas = $("result-canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const preds = result.predictions || [];
      const fontSize = Math.max(14, Math.round(img.width / 70));
      preds.forEach(p => {
        const x = p.x - p.width / 2;
        const y = p.y - p.height / 2;
        const color = colorForClass(p.class);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(2, Math.round(img.width / 400));
        ctx.strokeRect(x, y, p.width, p.height);

        const label = `${p.class} ${(p.confidence * 100).toFixed(0)}%`;
        ctx.font = `bold ${fontSize}px sans-serif`;
        const m = ctx.measureText(label);
        const tH = fontSize + 6;
        ctx.fillStyle = color;
        ctx.fillRect(x, Math.max(0, y - tH), m.width + 10, tH);
        ctx.fillStyle = "#fff";
        ctx.fillText(label, x + 5, Math.max(fontSize + 1, y - 4));
      });
      canvas.classList.add("visible");

      const list = $("detections-list");
      list.innerHTML = "";
      if (preds.length === 0) {
        list.innerHTML = '<p style="color:#718096;font-style:italic;">Sin detecciones por encima del umbral. Prueba a bajar la confianza.</p>';
      } else {
        const grouped = {};
        preds.forEach(p => { (grouped[p.class] || (grouped[p.class] = [])).push(p.confidence); });
        for (const cls of Object.keys(grouped)) {
          const confs = grouped[cls];
          const max = (Math.max.apply(null, confs) * 100).toFixed(1);
          const avg = ((confs.reduce((a, b) => a + b, 0) / confs.length) * 100).toFixed(1);
          const desc = descriptions[cls] || "";
          const color = colorForClass(cls);
          const div = document.createElement("div");
          div.className = "detection";
          div.style.borderLeftColor = color;
          div.innerHTML = `
            <div class="detection-row">
              <span class="detection-label">${escapeHtml(cls)}</span>
              <span class="detection-badge">${confs.length} detección(es)</span>
              <span class="detection-badge" style="background:${color}">max ${max}%</span>
              <span class="detection-badge" style="background:#4a5568">avg ${avg}%</span>
            </div>
            ${desc ? `<div class="detection-desc">${escapeHtml(desc)}</div>` : ""}
          `;
          list.appendChild(div);
        }
      }
      resolve();
    };
    img.onerror = () => {
      showStatus("status",
        "No se pudo mostrar la imagen en el lienzo (suele ser CORS si usaste una URL externa). Los datos numéricos siguen siendo válidos.",
        "info");
      resolve();
    };
    img.src = src;
  });
}

// ---------- Inicialización -------------------------------
(async function init() {
  await ensureExamplesLoaded();
  renderModelList();
  renderModelSelector();
  updateAnalyzeState();
})();
