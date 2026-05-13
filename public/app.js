/* =========================================================
   app.js — Lógica del analizador (v3)

   Cambios respecto a v2:
   - Selección múltiple de modelos (checkboxes).
   - Llamadas en paralelo a /api/infer, una por modelo.
   - Cada modelo se identifica con un color asignado al vuelo.
   - Tres modos de visualización: Unión, Por modelo, Consenso (IoU).
   - Resumen por modelo (estado, nº detecciones, errores).
   - Aviso de coste estimado antes de inferir.
   ========================================================= */

// ---------- Constantes y estado --------------------------
const STORAGE_KEY = "rf_models_v2";   // mismo key que v2: compatibilidad
const EXAMPLES_URL = "models.example.json";
const IOU_DEFAULT = 0.40;

// Paleta para asignar colores a los modelos en cada inferencia.
// 8 colores bien diferenciados; si hay más modelos, se ciclan.
const MODEL_COLORS = [
  "#3182ce", // azul
  "#dd6b20", // naranja
  "#38a169", // verde
  "#805ad5", // morado
  "#d53f8c", // rosa
  "#319795", // turquesa
  "#d69e2e", // amarillo
  "#e53e3e"  // rojo
];

let editingId = null;
let lastResults = null;        // resultados completos de la última inferencia
let lastImageSrc = null;       // imagen de la última inferencia
let currentView = "union";     // "union" | "per-model" | "consensus"
let currentModelTab = null;    // id del modelo activo en vista "per-model"

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
function clearStatus(boxId) { $(boxId).className = ""; }

// Normalización suave de nombres de clase (lowercase + trim).
// NO unifica semánticamente "Dust" con "Dusty" — eso es trabajo del LLM.
function normalizeClass(cls) {
  return String(cls || "").trim().toLowerCase();
}

// Iniciales para el "pill" identificador del modelo en la imagen.
function modelInitials(name) {
  const parts = String(name || "?").split(/[\s\-_\/]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0] || "?").slice(0, 2).toUpperCase();
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
    if (Array.isArray(data.models)) saveModels(data.models);
  } catch (_) { /* sin ejemplos, seguimos */ }
}

// ---------- Pestañas principales -------------------------
document.querySelectorAll("#tabs .tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#tabs .tab").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    $("panel-" + btn.dataset.tab).classList.add("active");
  });
});

// ---------- Sub-pestañas de modos de visualización -------
document.querySelectorAll("#view-tabs .sub-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#view-tabs .sub-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;
    renderCurrentView();
  });
});

// ---------- Renderizado del listado en Configurar --------
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

// ---------- Renderizado de checkboxes en Analizar --------
function renderModelCheckboxes() {
  const models = loadModels();
  const box = $("model-checkboxes");
  box.innerHTML = "";

  if (models.length === 0) {
    box.innerHTML = '<p style="font-style:italic;color:#718096;">No hay modelos configurados. Ve a la pestaña ⚙️ Configurar para añadir uno.</p>';
    updateCostWarning();
    return;
  }

  // Recupera selección previa de localStorage para no perderla al recargar
  let selected = [];
  try { selected = JSON.parse(localStorage.getItem("rf_selected_v3") || "[]"); } catch (_) {}

  models.forEach((m, idx) => {
    const color = MODEL_COLORS[idx % MODEL_COLORS.length];
    const checked = selected.indexOf(m.id) >= 0;
    const div = document.createElement("label");
    div.className = "model-checkbox" + (checked ? " checked" : "");
    div.dataset.id = m.id;
    div.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      <span class="color-dot" style="background:${color}"></span>
      <div class="model-checkbox-body">
        <div class="model-name">${escapeHtml(m.name)}</div>
        <div class="model-meta">
          ${escapeHtml(m.workspace || "")}/${escapeHtml(m.project)} · v${escapeHtml(m.version)}
          ${m.imageType ? " · " + escapeHtml(m.imageType) : ""}
        </div>
      </div>
    `;
    const cb = div.querySelector("input[type=checkbox]");
    cb.addEventListener("change", () => {
      div.classList.toggle("checked", cb.checked);
      persistSelection();
      updateCostWarning();
      updateAnalyzeState();
    });
    box.appendChild(div);
  });

  updateCostWarning();
}

function getSelectedModels() {
  const ids = [];
  document.querySelectorAll(".model-checkbox input[type=checkbox]").forEach(cb => {
    if (cb.checked) ids.push(cb.closest(".model-checkbox").dataset.id);
  });
  const models = loadModels();
  return ids.map(id => models.find(m => m.id === id)).filter(Boolean);
}

function persistSelection() {
  const ids = getSelectedModels().map(m => m.id);
  localStorage.setItem("rf_selected_v3", JSON.stringify(ids));
}

// Color asignado a un modelo dentro del listado actual
function getColorForModel(modelId) {
  const models = loadModels();
  const idx = models.findIndex(m => m.id === modelId);
  return MODEL_COLORS[idx % MODEL_COLORS.length];
}

function updateCostWarning() {
  const sel = getSelectedModels();
  const box = $("cost-warning");
  if (sel.length <= 1) { box.classList.remove("visible"); return; }
  box.textContent = `⚠️ Vas a ejecutar ${sel.length} inferencias en paralelo. Cada análisis consumirá ${sel.length} créditos de Roboflow.`;
  box.classList.add("visible");
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
  renderModelCheckboxes();
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
  renderModelCheckboxes();
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
      renderModelCheckboxes();
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
  localStorage.removeItem("rf_selected_v3");
  await ensureExamplesLoaded();
  renderModelList();
  renderModelCheckboxes();
  updateAnalyzeState();
  showStatus("form-status", "Ejemplos recargados.", "success");
});

// ---------- Analizar -------------------------------------
$("image-file").addEventListener("change", updateAnalyzeState);
$("image-url").addEventListener("input", updateAnalyzeState);
$("confidence").addEventListener("input", () => {
  $("conf-display").textContent = $("confidence").value + " %";
});
$("iou-threshold").addEventListener("input", () => {
  const v = parseInt($("iou-threshold").value, 10) / 100;
  $("iou-display").textContent = v.toFixed(2);
  // Si ya hay resultados visibles en modo consenso, recalcular
  if (lastResults && currentView === "consensus") renderCurrentView();
});

function updateAnalyzeState() {
  const hasModel = getSelectedModels().length > 0;
  const hasImage = $("image-file").files.length > 0 || $("image-url").value.trim() !== "";
  $("analyze-btn").disabled = !(hasModel && hasImage);
}

$("analyze-btn").addEventListener("click", runInference);

// ---------- Redimensionado de imagen ---------------------
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

async function parseBackendResponse(r) {
  const text = await r.text();
  const ct = (r.headers.get("content-type") || "").toLowerCase();
  if (ct.indexOf("application/json") >= 0) {
    try { return { ok: true, json: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: `JSON inválido del backend (HTTP ${r.status}).` }; }
  }
  let hint = "";
  if (text.indexOf("The page could not be found") >= 0 || r.status === 404) {
    hint = "El endpoint /api/infer parece no existir. Comprueba que api/ está en la raíz del repo y que Vercel ha desplegado tras el último push.";
  }
  return { ok: false, error: `Respuesta inesperada (HTTP ${r.status}). ${hint}` };
}

// ---------- Inferencia ORQUESTADA en paralelo -----------
async function inferOne(model, imagePayload, conf) {
  // imagePayload: { type:"file", base64 } o { type:"url", url }
  const body = {
    project: model.project,
    version: model.version,
    confidence: conf
  };
  if (imagePayload.type === "file") body.image = imagePayload.base64;
  else body.imageUrl = imagePayload.url;

  const r = await fetch("/api/infer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const parsed = await parseBackendResponse(r);
  if (!parsed.ok) throw new Error(parsed.error);
  if (!r.ok) {
    const detail = (parsed.json && typeof parsed.json.details === "object")
      ? JSON.stringify(parsed.json.details)
      : (parsed.json && parsed.json.details) || "";
    throw new Error((parsed.json && parsed.json.error || "Error") + (detail ? " — " + detail : ""));
  }
  return parsed.json;
}

async function runInference() {
  const selectedModels = getSelectedModels();
  if (selectedModels.length === 0) return;
  const conf = parseInt($("confidence").value, 10);

  $("results-section").style.display = "block";
  $("detections-list").innerHTML = "";
  $("model-summary").innerHTML = "";
  $("result-canvas").classList.remove("visible");
  $("per-model-tabs").style.display = "none";
  showStatus("status",
    `Enviando imagen a ${selectedModels.length} modelo(s) en paralelo...`, "loading");
  $("analyze-btn").disabled = true;

  try {
    // 1) Preparar la imagen UNA SOLA VEZ y reutilizarla en todas las llamadas
    let imagePayload, displaySrc;
    if ($("image-file").files.length > 0) {
      const out = await resizeImage($("image-file").files[0]);
      displaySrc = out.displayUrl;
      imagePayload = { type: "file", base64: out.base64 };
    } else {
      const url = $("image-url").value.trim();
      displaySrc = url;
      imagePayload = { type: "url", url };
    }

    // 2) Lanzar N inferencias en paralelo. Usamos Promise.allSettled
    //    para que un fallo en un modelo NO rompa los demás.
    const t0 = performance.now();
    const settled = await Promise.allSettled(
      selectedModels.map(m => inferOne(m, imagePayload, conf))
    );
    const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

    // 3) Empaquetar resultados por modelo (con éxito o error)
    const perModel = selectedModels.map((m, i) => {
      const result = settled[i];
      const color = getColorForModel(m.id);
      if (result.status === "fulfilled") {
        const preds = (result.value.predictions || []).map(p => ({
          ...p,
          _modelId: m.id,
          _modelName: m.name,
          _color: color,
          _classNorm: normalizeClass(p.class)
        }));
        return {
          model: m,
          color,
          ok: true,
          predictions: preds,
          rawTime: result.value.time
        };
      } else {
        return {
          model: m,
          color,
          ok: false,
          error: result.reason && result.reason.message || String(result.reason),
          predictions: []
        };
      }
    });

    lastResults = { perModel, elapsed };
    lastImageSrc = displaySrc;
    currentView = "union";
    document.querySelectorAll("#view-tabs .sub-tab").forEach(b => {
      b.classList.toggle("active", b.dataset.view === "union");
    });

    renderCurrentView();
    renderModelSummary();

    const totalDetections = perModel.reduce((sum, x) => sum + x.predictions.length, 0);
    const errored = perModel.filter(x => !x.ok).length;
    let msg = `Completado en ${elapsed}s. Total: ${totalDetections} detección(es) en ${perModel.length} modelo(s).`;
    if (errored > 0) msg += ` ${errored} modelo(s) fallaron.`;
    showStatus("status", msg, errored === perModel.length ? "error" : (errored > 0 ? "info" : "success"));

  } catch (err) {
    showStatus("status", "Error: " + err.message, "error");
    console.error(err);
  } finally {
    updateAnalyzeState();
  }
}

// ---------- Geometría: IoU para consenso -----------------
function bboxToRect(p) {
  // Roboflow devuelve (x, y) como CENTRO
  return {
    x1: p.x - p.width / 2,
    y1: p.y - p.height / 2,
    x2: p.x + p.width / 2,
    y2: p.y + p.height / 2
  };
}

function iou(a, b) {
  const r1 = bboxToRect(a), r2 = bboxToRect(b);
  const xi1 = Math.max(r1.x1, r2.x1);
  const yi1 = Math.max(r1.y1, r2.y1);
  const xi2 = Math.min(r1.x2, r2.x2);
  const yi2 = Math.min(r1.y2, r2.y2);
  const iw = Math.max(0, xi2 - xi1);
  const ih = Math.max(0, yi2 - yi1);
  const inter = iw * ih;
  const area1 = (r1.x2 - r1.x1) * (r1.y2 - r1.y1);
  const area2 = (r2.x2 - r2.x1) * (r2.y2 - r2.y1);
  const union = area1 + area2 - inter;
  if (union <= 0) return 0;
  return inter / union;
}

// Agrupa detecciones que solapan (IoU ≥ threshold) Y comparten clase normalizada.
// Cada grupo representa una "detección consensuada" — uno o varios modelos
// detectaron lo mismo en la misma zona.
function buildConsensusGroups(allPreds, iouThreshold) {
  const groups = [];
  const used = new Array(allPreds.length).fill(false);

  for (let i = 0; i < allPreds.length; i++) {
    if (used[i]) continue;
    const seed = allPreds[i];
    const group = [seed];
    used[i] = true;
    for (let j = i + 1; j < allPreds.length; j++) {
      if (used[j]) continue;
      const cand = allPreds[j];
      // Para el consenso: misma clase normalizada Y suficiente solapamiento
      if (cand._classNorm !== seed._classNorm) continue;
      // Calcular IoU contra cualquiera del grupo (single-link clustering)
      let matches = false;
      for (const member of group) {
        if (iou(member, cand) >= iouThreshold) { matches = true; break; }
      }
      if (matches) {
        group.push(cand);
        used[j] = true;
      }
    }
    groups.push(group);
  }
  return groups;
}

// De cada grupo se construye una caja "media" y métricas agregadas
function summarizeGroup(group) {
  // Caja: promedio ponderado por confianza
  let sumW = 0, sx = 0, sy = 0, sw = 0, sh = 0;
  group.forEach(p => {
    const w = p.confidence;
    sumW += w; sx += p.x * w; sy += p.y * w;
    sw += p.width * w; sh += p.height * w;
  });
  const merged = {
    x: sx / sumW, y: sy / sumW,
    width: sw / sumW, height: sh / sumW,
    class: group[0].class,
    _classNorm: group[0]._classNorm
  };
  const confs = group.map(p => p.confidence);
  const modelIds = Array.from(new Set(group.map(p => p._modelId)));
  return {
    box: merged,
    members: group,
    nModels: modelIds.length,
    modelIds,
    confMax: Math.max.apply(null, confs),
    confAvg: confs.reduce((a, b) => a + b, 0) / confs.length
  };
}

// ---------- Renderizado de modos -------------------------
function renderCurrentView() {
  if (!lastResults) return;
  const desc = $("view-description");
  const perModelTabs = $("per-model-tabs");
  perModelTabs.style.display = "none";

  if (currentView === "union") {
    desc.textContent = "Todas las detecciones de todos los modelos. Cada modelo se identifica con su color.";
    renderUnion();
  } else if (currentView === "per-model") {
    desc.textContent = "Selecciona un modelo para ver únicamente sus detecciones.";
    renderPerModelTabs();
    renderPerModel();
  } else if (currentView === "consensus") {
    const iouThr = parseInt($("iou-threshold").value, 10) / 100;
    desc.textContent = `Detecciones agrupadas por solapamiento (IoU ≥ ${iouThr.toFixed(2)}) y clase. Cuantos más modelos coincidan, mayor confianza global.`;
    renderConsensus();
  }
}

function renderUnion() {
  const all = lastResults.perModel.flatMap(x => x.predictions);
  drawImage();
  drawBoxes(all.map(p => ({
    box: p,
    color: p._color,
    label: `${p.class} ${(p.confidence * 100).toFixed(0)}%`,
    sublabel: modelInitials(p._modelName)
  })));
  renderDetectionListUnion(all);
}

function renderPerModelTabs() {
  const tabsBox = $("per-model-tabs");
  tabsBox.innerHTML = "";
  tabsBox.style.display = "flex";
  // Inicializa la pestaña activa si no había
  if (!currentModelTab || !lastResults.perModel.some(x => x.model.id === currentModelTab)) {
    currentModelTab = lastResults.perModel[0].model.id;
  }
  lastResults.perModel.forEach(x => {
    const btn = document.createElement("button");
    btn.className = "per-model-tab" + (x.model.id === currentModelTab ? " active" : "");
    btn.innerHTML = `<span class="color-dot" style="background:${x.color}"></span>${escapeHtml(x.model.name)} (${x.predictions.length})`;
    btn.addEventListener("click", () => {
      currentModelTab = x.model.id;
      renderPerModelTabs();
      renderPerModel();
    });
    tabsBox.appendChild(btn);
  });
}

function renderPerModel() {
  const x = lastResults.perModel.find(p => p.model.id === currentModelTab);
  if (!x) return;
  drawImage();
  if (!x.ok) {
    $("detections-list").innerHTML =
      `<p style="color:#9b2c2c">Este modelo falló: ${escapeHtml(x.error)}</p>`;
    return;
  }
  drawBoxes(x.predictions.map(p => ({
    box: p,
    color: x.color,
    label: `${p.class} ${(p.confidence * 100).toFixed(0)}%`,
    sublabel: null
  })));
  renderDetectionListSimple(x.predictions, x.model.descriptions || {}, x.color);
}

function renderConsensus() {
  const iouThr = parseInt($("iou-threshold").value, 10) / 100;
  const all = lastResults.perModel.flatMap(x => x.predictions);
  const groups = buildConsensusGroups(all, iouThr).map(summarizeGroup);

  drawImage();
  drawBoxes(groups.map(g => {
    // Color: si los modelos coinciden, mezcla / neutro; si solo uno, su color
    const color = g.nModels === 1 ? g.members[0]._color : "#1e3a5f";
    return {
      box: g.box,
      color,
      label: `${g.box.class} ${(g.confAvg * 100).toFixed(0)}%`,
      sublabel: `${g.nModels}× modelo${g.nModels > 1 ? "s" : ""}`
    };
  }));
  renderConsensusList(groups);
}

// ---------- Lienzo: dibujo de cajas ----------------------
let baseImage = null;  // imagen ya cargada para no recargarla cada cambio de vista

function drawImage() {
  return new Promise((resolve) => {
    const canvas = $("result-canvas");
    const ctx = canvas.getContext("2d");
    const draw = (img) => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      canvas.classList.add("visible");
      resolve(img);
    };
    if (baseImage && baseImage._src === lastImageSrc) {
      draw(baseImage);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      img._src = lastImageSrc;
      baseImage = img;
      draw(img);
    };
    img.onerror = () => {
      showStatus("status",
        "No se pudo mostrar la imagen en el lienzo (suele ser CORS si usaste una URL externa). Los datos numéricos siguen siendo válidos.",
        "info");
      resolve(null);
    };
    img.src = lastImageSrc;
  });
}

async function drawBoxes(items) {
  const img = await drawImage();
  if (!img) return;
  const canvas = $("result-canvas");
  const ctx = canvas.getContext("2d");
  const fontSize = Math.max(14, Math.round(img.width / 70));
  const lineW = Math.max(2, Math.round(img.width / 400));

  items.forEach(it => {
    const x = it.box.x - it.box.width / 2;
    const y = it.box.y - it.box.height / 2;
    ctx.strokeStyle = it.color;
    ctx.lineWidth = lineW;
    ctx.strokeRect(x, y, it.box.width, it.box.height);

    // Label principal
    ctx.font = `bold ${fontSize}px sans-serif`;
    const m = ctx.measureText(it.label);
    const tH = fontSize + 6;
    ctx.fillStyle = it.color;
    ctx.fillRect(x, Math.max(0, y - tH), m.width + 10, tH);
    ctx.fillStyle = "#fff";
    ctx.fillText(it.label, x + 5, Math.max(fontSize + 1, y - 4));

    // Sublabel (iniciales del modelo o nº de modelos en consenso),
    // dibujado en la esquina inferior derecha de la caja
    if (it.sublabel) {
      const subSize = Math.max(11, Math.round(fontSize * 0.72));
      ctx.font = `bold ${subSize}px monospace`;
      const sm = ctx.measureText(it.sublabel);
      const sH = subSize + 4;
      const bx = x + it.box.width - sm.width - 8;
      const by = y + it.box.height - sH;
      ctx.fillStyle = it.color;
      ctx.fillRect(bx, by, sm.width + 8, sH);
      ctx.fillStyle = "#fff";
      ctx.fillText(it.sublabel, bx + 4, by + subSize);
    }
  });
}

// ---------- Listas de detecciones ------------------------
function renderDetectionListUnion(allPreds) {
  const list = $("detections-list");
  list.innerHTML = "";
  if (allPreds.length === 0) {
    list.innerHTML = '<p style="color:#718096;font-style:italic;">Sin detecciones por encima del umbral.</p>';
    return;
  }
  // Agrupar por clase normalizada
  const grouped = {};
  allPreds.forEach(p => {
    const key = p._classNorm;
    if (!grouped[key]) grouped[key] = { classDisplay: p.class, items: [] };
    grouped[key].items.push(p);
  });

  Object.keys(grouped).forEach(key => {
    const g = grouped[key];
    const confs = g.items.map(p => p.confidence);
    const max = (Math.max.apply(null, confs) * 100).toFixed(1);
    const avg = ((confs.reduce((a, b) => a + b, 0) / confs.length) * 100).toFixed(1);
    const modelIds = Array.from(new Set(g.items.map(p => p._modelId)));
    const modelNames = modelIds.map(id => {
      const x = lastResults.perModel.find(p => p.model.id === id);
      return x ? x.model : null;
    }).filter(Boolean);

    // Junta descripciones de todos los modelos que detectaron la clase
    const descSet = new Set();
    modelNames.forEach(m => {
      const d = (m.descriptions || {})[g.classDisplay];
      if (d) descSet.add(d);
    });

    const pills = modelNames.map(m => {
      const color = getColorForModel(m.id);
      return `<span class="model-pill" style="background:${color}" title="${escapeHtml(m.name)}">${escapeHtml(modelInitials(m.name))}</span>`;
    }).join("");

    const div = document.createElement("div");
    div.className = "detection";
    div.innerHTML = `
      <div class="detection-row">
        <span class="detection-label">${escapeHtml(g.classDisplay)}</span>
        <span class="detection-badge">${g.items.length} detección(es)</span>
        <span class="detection-badge">max ${max}%</span>
        <span class="detection-badge" style="background:#4a5568">avg ${avg}%</span>
        <span class="detection-models">${pills}</span>
      </div>
      ${descSet.size > 0
        ? `<div class="detection-desc">${Array.from(descSet).map(escapeHtml).join(" · ")}</div>`
        : ""}
    `;
    list.appendChild(div);
  });
}

function renderDetectionListSimple(preds, descriptions, color) {
  const list = $("detections-list");
  list.innerHTML = "";
  if (preds.length === 0) {
    list.innerHTML = '<p style="color:#718096;font-style:italic;">Sin detecciones por encima del umbral.</p>';
    return;
  }
  const grouped = {};
  preds.forEach(p => { (grouped[p.class] || (grouped[p.class] = [])).push(p.confidence); });
  for (const cls of Object.keys(grouped)) {
    const confs = grouped[cls];
    const max = (Math.max.apply(null, confs) * 100).toFixed(1);
    const avg = ((confs.reduce((a, b) => a + b, 0) / confs.length) * 100).toFixed(1);
    const desc = descriptions[cls] || "";
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

function renderConsensusList(groups) {
  const list = $("detections-list");
  list.innerHTML = "";
  if (groups.length === 0) {
    list.innerHTML = '<p style="color:#718096;font-style:italic;">Sin detecciones para mostrar.</p>';
    return;
  }
  // Orden: primero las que tienen más modelos coincidiendo, luego por confianza
  groups.sort((a, b) => (b.nModels - a.nModels) || (b.confAvg - a.confAvg));

  groups.forEach(g => {
    const pills = g.modelIds.map(id => {
      const x = lastResults.perModel.find(p => p.model.id === id);
      if (!x) return "";
      return `<span class="model-pill" style="background:${x.color}" title="${escapeHtml(x.model.name)}">${escapeHtml(modelInitials(x.model.name))}</span>`;
    }).join("");

    // Descripciones combinadas
    const descSet = new Set();
    g.modelIds.forEach(id => {
      const x = lastResults.perModel.find(p => p.model.id === id);
      if (!x) return;
      const d = (x.model.descriptions || {})[g.box.class];
      if (d) descSet.add(d);
    });

    const consensusLabel = g.nModels > 1
      ? `<span class="detection-badge" style="background:#22543d">${g.nModels}× modelos coinciden</span>`
      : `<span class="detection-badge" style="background:#a0aec0">solo 1 modelo</span>`;

    const div = document.createElement("div");
    div.className = "detection";
    div.style.borderLeftColor = g.nModels > 1 ? "#22543d" : "#a0aec0";
    div.innerHTML = `
      <div class="detection-row">
        <span class="detection-label">${escapeHtml(g.box.class)}</span>
        ${consensusLabel}
        <span class="detection-badge">max ${(g.confMax * 100).toFixed(1)}%</span>
        <span class="detection-badge" style="background:#4a5568">avg ${(g.confAvg * 100).toFixed(1)}%</span>
        <span class="detection-models">${pills}</span>
      </div>
      ${descSet.size > 0
        ? `<div class="detection-desc">${Array.from(descSet).map(escapeHtml).join(" · ")}</div>`
        : ""}
    `;
    list.appendChild(div);
  });
}

function renderModelSummary() {
  const box = $("model-summary");
  box.innerHTML = "<h3>Resumen por modelo</h3>";
  lastResults.perModel.forEach(x => {
    const row = document.createElement("div");
    row.className = "summary-row" + (x.ok ? "" : " error");
    if (x.ok) {
      row.innerHTML = `
        <span class="color-dot" style="background:${x.color}"></span>
        <b>${escapeHtml(x.model.name)}</b>:
        ${x.predictions.length} detección(es)
      `;
    } else {
      row.innerHTML = `
        <span class="color-dot" style="background:${x.color}"></span>
        <b>${escapeHtml(x.model.name)}</b>: ❌ ${escapeHtml(x.error)}
      `;
    }
    box.appendChild(row);
  });
}

// ---------- Inicialización -------------------------------
(async function init() {
  await ensureExamplesLoaded();
  renderModelList();
  renderModelCheckboxes();
  updateAnalyzeState();
  // Inicializar display del IoU
  $("iou-display").textContent = (IOU_DEFAULT).toFixed(2);
  $("iou-threshold").value = Math.round(IOU_DEFAULT * 100);
})();
