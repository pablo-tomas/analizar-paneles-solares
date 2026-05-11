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
│   └── infer.js              ← Función serverless (proxy → Roboflow)
├── public/
│   ├── index.html            ← Estructura HTML con pestañas
│   ├── styles.css            ← Estilos
│   ├── app.js                ← Lógica del frontend
│   └── models.example.json   ← Modelos precargados de ejemplo
├── package.json              ← Metadatos del proyecto (Node 18+)
├── vercel.json               ← Configuración de Vercel
├── .env.local.example        ← Plantilla de variables de entorno
├── .gitignore
└── README.md                 ← Este archivo
```

---

## Despliegue paso a paso en tu cuenta (`pablo-tomas`)

> Como pediste mantener disponibles **las dos versiones** (v1 y v2), las trataremos como repositorios separados. La v1 sigue funcionando tal cual, en GitHub Pages.

### A) Crear el repositorio de la v2

1. Entra a [github.com](https://github.com) con tu cuenta `pablo-tomas`.
2. Botón verde **New** → nombre: `analizar-paneles-solares` → **Public** → *Create repository*.
3. Pulsa **Add file → Upload files** y arrastra **todos los ficheros y carpetas** del proyecto (la carpeta `api/`, la carpeta `public/`, `package.json`, `vercel.json`, `.gitignore`, `.env.local.example`, `README.md`).
4. Mensaje de commit: `initial commit` → *Commit changes*.

Tu repo público quedará en:
`https://github.com/pablo-tomas/analizar-paneles-solares`

### B) Obtener tu API Key de Roboflow

1. Entra a [roboflow.com](https://roboflow.com), arriba a la derecha → **Settings** → **API Keys**.
2. Copia la **Private API Key**. La vas a pegar en el siguiente paso.

### C) Desplegar en Vercel (gratis, sin tarjeta)

1. Entra a [vercel.com](https://vercel.com) y pulsa **Sign up** → elige **Continue with GitHub** (login con tu cuenta `pablo-tomas`). Acepta los permisos solicitados.
2. En el dashboard de Vercel, pulsa **Add New… → Project**.
3. Verás la lista de tus repos de GitHub. Localiza `analizar-paneles-solares` y pulsa **Import**.
4. En la pantalla de configuración del proyecto:
   - **Project Name**: déjalo como está (o cambiarlo si quieres).
   - **Framework Preset**: *Other* (Vercel lo detecta automáticamente).
   - **Root Directory**: déjalo en `./`.
   - Despliega **Environment Variables** y añade:
     - **Key**: `ROBOFLOW_API_KEY`
     - **Value**: pega tu API Key de Roboflow.
   - Pulsa **Add**.
5. Pulsa **Deploy**. En 1-2 minutos verás un mensaje de éxito y un enlace tipo:
   `https://analizar-paneles-solares.vercel.app`

¡Ya está en producción!

### D) Probar la app

1. Abre la URL pública.
2. Pestaña **⚙️ Configurar** → verás dos modelos de ejemplo cargados (los de tus URLs originales).
3. Edita cada uno para rellenar los datos opcionales que vayas obteniendo de Roboflow Universe (mAP, precisión, etc.).
4. Pulsa **Exportar JSON** para guardar la configuración como `models.json` (te la puedes pasar entre máquinas o compartirla con el equipo).
5. Pestaña **🔍 Analizar** → selecciona modelo → sube imagen → *Analizar*.

---

## ¿Cómo conviven la v1 y la v2?

Son dos repositorios y dos URLs independientes:

| Versión | Repo | Hosting | URL pública |
|---|---|---|---|
| **v1** | `pablo-tomas/analizador-paneles-solares` | GitHub Pages | `https://pablo-tomas.github.io/analizador-paneles-solares/` |
| **v2** | `pablo-tomas/analizar-paneles-solares` | Vercel | `https://analizar-paneles-solares.vercel.app` |

No interfieren entre sí. Puedes seguir mostrando la v1 en defensas o reuniones donde no quieras depender de Vercel, y usar la v2 cuando quieras la versión con backend.

---

## Cómo añadir, editar y borrar modelos

Pestaña **Configurar**:

- **Añadir**: rellena el formulario y pulsa *Añadir modelo*.
- **Editar**: en la lista de arriba pulsa *Editar* en el modelo deseado. El formulario se rellena con sus valores y el botón cambia a *Guardar cambios*. Pulsa *Cancelar edición* si quieres descartar.
- **Eliminar**: botón *Eliminar* en la fila correspondiente (pide confirmación).
- **Exportar JSON**: descarga `models.json` con toda la configuración. Puedes versionarlo en Git, compartirlo con Emma y Lucas, o subirlo a Google Drive.
- **Importar JSON**: pega aquí un `models.json` previamente exportado para sustituir la configuración actual.
- **Recargar ejemplos**: borra todo y vuelve a cargar los modelos del fichero `models.example.json` del servidor.

### Campos del modelo

**Obligatorios:**
- Nombre para mostrar al usuario
- Workspace
- Project ID (slug)
- Versión
- Descripciones por clase (formato JSON)

**Opcionales (para documentación):**
- Tipo de imagen (RGB / IR / Térmica / Mixta)
- Nº total de imágenes
- División train/valid/test
- Tipo de modelo (YOLOv8, YOLOv11, Roboflow 3.0…)
- Métricas: mAP @50, Precisión, Recall, Tamaño de entrada

Los opcionales aparecen como un panel informativo cuando seleccionas el modelo en la pestaña *Analizar*.

---

## Detalles técnicos

### Cómo viaja la API Key

```
Navegador  ──POST /api/infer──►  Función Vercel (servidor)  ──HTTPS──►  detect.roboflow.com
                                 │
                                 └── lee process.env.ROBOFLOW_API_KEY
                                     (variable de entorno, oculta al cliente)
```

La API Key nunca sale del backend. El usuario final no la ve, no puede leerla desde DevTools, y no aparece en el código fuente del repositorio.

### Redimensionado automático de imágenes

Antes de enviar una imagen al backend, el navegador la redimensiona a un máximo de **1600 px** de lado largo y la comprime a JPEG (calidad 90%). Esto evita:
- Llegar al límite de 8 MB de payload de la función serverless.
- Pagar ancho de banda innecesario.
- Que Roboflow rechace la inferencia por imagen demasiado grande.

### Capa gratis de Vercel

Plan Hobby (gratis, sin tarjeta): suficiente para un PoC académico. Los límites relevantes son ~100 GB de ancho de banda mensual y 100 GB-h de ejecución de funciones serverless. Para que llegues a tocar esos límites tendrías que hacer miles de inferencias al día.

### Capa gratis de Roboflow

Roboflow tiene créditos gratis de inferencia hosted por mes. Comprueba el contador en `roboflow.com → Usage`. Para el TFM va sobrado.

---

## Desarrollo local (opcional)

Si quieres probar la app en tu máquina antes de desplegar:

```bash
# Una sola vez: instala Vercel CLI
npm install -g vercel

# En la carpeta del proyecto:
cp .env.local.example .env.local
# edita .env.local y pega tu API Key

vercel dev
# Abre http://localhost:3000
```

---

## Solución de problemas

- **"El backend no tiene configurada ROBOFLOW_API_KEY"** → Vercel → tu proyecto → *Settings → Environment Variables* → comprueba que la variable existe con ese nombre exacto. Después *Deployments* → *Redeploy* en el último despliegue.
- **"Error de Roboflow — 401 / 403"** → la API Key es inválida o no tiene acceso al modelo. Asegúrate de usar la *Private* y de que el workspace del modelo es accesible para ti.
- **"Error de Roboflow — 404"** → el `project` o la `version` no coinciden con la URL real del modelo en Roboflow Universe.
- **Las cajas no se dibujan pero hay detecciones en la lista** → suele ser CORS si pegaste una URL externa. Sube el fichero en lugar de pegar URL.
