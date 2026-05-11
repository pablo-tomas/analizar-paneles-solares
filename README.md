# Analizar Paneles Solares — v2

Aplicación web con **frontend** (HTML/CSS/JS) y **backend serverless** (Node.js) que:

1. Recibe una imagen de paneles solares y la envía a un modelo de **Roboflow** para detección de defectos.
2. Muestra los recuadros etiquetados sobre la imagen y la lista de detecciones con porcentaje de confianza.
3. Permite **gestionar varios modelos** (alta, edición, borrado) desde un panel de configuración con persistencia en `localStorage` + export/import a `models.json`.
4. **Oculta la API Key** de Roboflow en una variable de entorno del servidor (no viaja al navegador).

> **Proyecto TFM — Diagnóstico de fallos en paneles fotovoltaicos · UNIR 2026**

---

## Cambios respecto a la v1

| Aspecto | v1 | v2 |
|---|---|---|
| API Key | Guardada en `localStorage` del navegador (visible) | Variable de entorno del backend (oculta) |
| Arquitectura | Página estática pura (HTML único) | Frontend estático + función serverless |
| Hosting | GitHub Pages | Vercel (gratis, conectado a GitHub) |
| Navegación | Una sola vista | Pestañas: *Analizar* / *Configurar* |
| Persistencia modelos | localStorage | localStorage + export/import a `models.json` |
| Edición de modelos | No (solo eliminar) | Sí (editar + eliminar) |
| Campos del modelo | 4 obligatorios | 4 obligatorios + 8 opcionales |

---

## Estructura del proyecto

```
analizar-paneles-solares/
├── api/
│   ├── infer.js              ← Función serverless (proxy → Roboflow)
│   └── health.js             ← Endpoint de diagnóstico
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── models.example.json
├── package.json
├── vercel.json
├── .env.local.example
├── .gitignore
└── README.md
```

---

## Despliegue paso a paso en tu cuenta (`pablo-tomas`)

> Como pediste mantener disponibles **las dos versiones** (v1 y v2), las trataremos como repositorios separados. La v1 sigue funcionando tal cual, en GitHub Pages.

### A) Crear el repositorio de la v2

1. Entra a [github.com](https://github.com) con tu cuenta `pablo-tomas`.
2. Botón verde **New** → nombre: `analizar-paneles-solares` → **Public** → *Create repository*.
3. Pulsa **Add file → Upload files** y arrastra **el contenido del proyecto** (las carpetas `api/` y `public/`, y los ficheros `package.json`, `vercel.json`, `.gitignore`, `.env.local.example`, `README.md`).

   ⚠️ **Importante**: la carpeta `api/` debe quedar en la **raíz** del repo, no dentro de otra carpeta intermedia. Tras subir los archivos, en la portada del repo deberías ver directamente `api/`, `public/`, `package.json`, etc.

4. Mensaje de commit: `initial commit` → *Commit changes*.

Tu repo público quedará en:
`https://github.com/pablo-tomas/analizar-paneles-solares`

### B) Obtener tu API Key de Roboflow

1. Entra a [roboflow.com](https://roboflow.com), arriba a la derecha → **Settings** → **API Keys**.
2. Copia la **Private API Key**.

### C) Desplegar en Vercel (gratis, sin tarjeta)

1. Entra a [vercel.com](https://vercel.com) y pulsa **Sign up** → **Continue with GitHub**.
2. Dashboard → **Add New… → Project**.
3. Localiza `analizar-paneles-solares` y pulsa **Import**.
4. En la pantalla de configuración:
   - **Framework Preset**: *Other*
   - **Root Directory**: `./`
   - Despliega **Environment Variables** y añade:
     - **Key**: `ROBOFLOW_API_KEY`
     - **Value**: pega tu API Key de Roboflow → *Add*.
5. Pulsa **Deploy**. Espera 1-2 minutos.

### D) Verificar el despliegue ANTES de probar el analizador

Antes de pulsar "Analizar", abre estas dos URLs en el navegador (sustituye `tu-url` por la URL que te dio Vercel):

1. `https://tu-url.vercel.app/api/health`
   Debe devolver algo como:
   ```json
   { "ok": true, "apiKeyConfigured": true, "runtime": "v22.x.x", "timestamp": "..." }
   ```
   - Si `apiKeyConfigured` es `false` → no añadiste la variable de entorno (vuelve al paso C.4 y luego redespliega).
   - Si la página devuelve `404: NOT_FOUND` → la función serverless no se está sirviendo. Mira la sección de diagnóstico más abajo.

2. `https://tu-url.vercel.app/` debe cargar la app.

### E) Probar la app

1. Pestaña **⚙️ Configurar** → verás dos modelos de ejemplo cargados.
2. Pestaña **🔍 Analizar** → selecciona modelo → sube imagen → *Analizar*.

---

## Diagnóstico cuando aparece el error `Unexpected token 'T'...`

Ese error significa: el navegador esperaba JSON del backend pero recibió la **página 404 de Vercel** ("The page could not be found..."). En esta versión el frontend ya muestra un mensaje más claro que te orienta. Sigue estos pasos en orden:

1. **Comprueba `/api/health`** en tu URL de Vercel.
   - ¿Da 404? → La función no está desplegada. Pasa al punto 2.
   - ¿Funciona pero dice `apiKeyConfigured: false`? → Variable de entorno mal puesta. Pasa al punto 4.

2. **Verifica la estructura del repo en GitHub.**
   Entra a `github.com/pablo-tomas/analizar-paneles-solares`. En la pestaña **Code** debes ver directamente las carpetas `api/` y `public/`. Si están dentro de otra carpeta intermedia (por ejemplo `analizar-paneles-solares/api/`), Vercel no las encontrará.

   Si la estructura está mal: borra el repo, créalo de nuevo y al subir los archivos asegúrate de soltar el **contenido** del ZIP descomprimido, no la carpeta contenedora.

3. **Verifica que Vercel ha desplegado la función.**
   En Vercel → tu proyecto → pestaña **Deployments** → último deploy → pestaña **Source**. Debes ver `api/infer.js` y `api/health.js`. Si no aparecen, el repo no tiene la estructura correcta.

4. **Variable de entorno.**
   Vercel → tu proyecto → **Settings → Environment Variables** → comprueba que existe `ROBOFLOW_API_KEY` (escrito exactamente así, en mayúsculas) con tu API Key como valor.

   Tras añadir o cambiar la variable, **debes redesplegar**: pestaña **Deployments** → menú "⋯" del último deploy → **Redeploy**.

5. **Otros errores comunes:**
   - `Error de Roboflow — 401 / 403`: la API Key es inválida o no tiene acceso al modelo. Usa la *Private API Key*, no la *Publishable*.
   - `Error de Roboflow — 404`: el `project` o la `version` no coinciden con la URL real del modelo en Roboflow Universe.
   - Las cajas no se dibujan pero hay detecciones en la lista: CORS al pegar URL externa. Sube el fichero en lugar de pegar URL.

---

## ¿Cómo conviven la v1 y la v2?

Son dos repositorios y dos URLs independientes:

| Versión | Repo | Hosting | URL pública |
|---|---|---|---|
| **v1** | `pablo-tomas/analizador-paneles-solares` | GitHub Pages | `https://pablo-tomas.github.io/analizador-paneles-solares/` |
| **v2** | `pablo-tomas/analizar-paneles-solares` | Vercel | `https://analizar-paneles-solares.vercel.app` |

---

## Cómo añadir, editar y borrar modelos

Pestaña **Configurar**:

- **Añadir**: rellena el formulario y pulsa *Añadir modelo*.
- **Editar**: en la lista pulsa *Editar*. El formulario se rellena con sus valores y el botón cambia a *Guardar cambios*.
- **Eliminar**: botón *Eliminar* en la fila (pide confirmación).
- **Exportar JSON**: descarga `models.json`. Puedes versionarlo en Git o compartirlo con el equipo.
- **Importar JSON**: carga un `models.json` previamente exportado.
- **Recargar ejemplos**: vuelve a los modelos del fichero `public/models.example.json`.

### Campos del modelo

**Obligatorios:** Nombre, Workspace, Project ID, Versión, Descripciones por clase (JSON).

**Opcionales:** Tipo de imagen, Nº de imágenes, División train/valid/test, Tipo de modelo, mAP @50, Precisión, Recall, Tamaño de entrada.

Los opcionales se muestran como panel informativo cuando seleccionas el modelo en *Analizar*.

---

## Detalles técnicos

### Cómo viaja la API Key

```
Navegador  ──POST /api/infer──►  Función Vercel (servidor)  ──HTTPS──►  detect.roboflow.com
                                 │
                                 └── lee process.env.ROBOFLOW_API_KEY
                                     (variable de entorno, oculta al cliente)
```

### Redimensionado automático de imágenes

Antes de enviar, el navegador redimensiona la imagen a un máximo de **1280 px** de lado largo y la comprime a JPEG (calidad 88%). Así nunca rebasamos el límite de payload del backend.

### Capa gratis

- **Vercel** plan Hobby: ~100 GB de ancho de banda mensual.
- **Roboflow**: créditos gratis de inferencia hosted por mes. Mira el contador en `roboflow.com → Usage`.

---

## Desarrollo local (opcional)

```bash
npm install -g vercel
cp .env.local.example .env.local
# edita .env.local y pega tu API Key
vercel dev
# Abre http://localhost:3000
```
