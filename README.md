# Analizar Paneles Solares — v3

Aplicación web con **frontend** (HTML/CSS/JS) y **backend serverless** (Node.js) que:

1. Recibe una imagen de paneles solares y la envía **en paralelo a varios modelos** de Roboflow para detección de defectos.
2. Muestra los recuadros etiquetados sobre la imagen y la lista de detecciones con porcentaje de confianza.
3. Permite **gestionar varios modelos** (alta, edición, borrado) con persistencia en `localStorage` + export/import a `models.json`.
4. **Oculta la API Key** de Roboflow en una variable de entorno del servidor.

> **Proyecto TFM — Diagnóstico de fallos en paneles fotovoltaicos · UNIR 2026**

---

## Novedades de la v3 (Sprint 1 del roadmap)

| Aspecto | v2 | v3 |
|---|---|---|
| Selección de modelos | Uno (selector `<select>`) | **Múltiple (casillas)** |
| Inferencia | Una llamada | **N llamadas en paralelo** (`Promise.allSettled`) |
| Tolerancia a fallos | Un fallo aborta todo | **Un modelo caído no rompe los demás** |
| Visualización del resultado | Vista única | **Tres modos: Unión / Por modelo / Consenso** |
| Identificación visual | — | **Color por modelo + iniciales en cada caja** |
| Consenso entre modelos | — | **Cálculo IoU con umbral configurable** |
| Aviso de coste | — | **Advierte al seleccionar varios modelos** |
| Resumen por modelo | — | **Estado, nº detecciones, errores específicos** |
| Estandarización de clases | — | **Diccionario de Clases Sinónimas: homologa las clases de cada modelo a una taxonomía estándar de 6 clases** |

---

## Los tres modos de visualización

Tras analizar una imagen, aparecen tres sub-pestañas:

### Unión (por defecto)
Todas las detecciones de todos los modelos, dibujadas con el color de cada modelo. Cada caja lleva en su esquina las iniciales del modelo que la generó. La lista agrupa por **clase normalizada** (lowercase + trim) y muestra qué modelos detectaron cada clase mediante "pills" de colores.

### Por modelo
Sub-pestañas, una por modelo. Permite ver solo las detecciones de un modelo concreto, útil para depurar o comparar visualmente.

### Consenso
Las detecciones se agrupan por **solapamiento (IoU ≥ umbral configurable)** y **misma clase homologada**. Cada grupo se muestra como una sola caja:
- Si **varios modelos** detectaron lo mismo en la misma zona → caja en color oscuro con etiqueta "N× modelos coinciden". **Alta confianza.**
- Si **solo un modelo** detectó algo → caja en color gris, etiqueta "solo 1 modelo". **Confianza menor.**
- Si la clase **no está en el diccionario** → caja con borde discontinuo y color de aviso, etiqueta "Sin homologar".

**Estandarización de clases (Diccionario de Clases Sinónimas)**: cada modelo puede nombrar sus clases de forma distinta (`Dust`, `Dirty`, `Soiling`, `Dusty`...). La herramienta homologa todas esas variantes a una taxonomía estándar de 6 clases antes de agrupar por consenso. Así, una detección `Dirty` de un modelo y una `Dust` de otro, si solapan espacialmente, se consolidan en un único hallazgo `Dust`. La homologación es insensible a mayúsculas, espacios y guiones. Las clases no presentes en el diccionario se conservan y se marcan visualmente como "sin homologar" — nunca se descartan.

---

## Estructura del proyecto

```
analizar-paneles-solares/
├── api/
│   ├── infer.js              ← Función serverless (proxy → Roboflow) - SIN CAMBIOS
│   └── health.js             ← Endpoint de diagnóstico - SIN CAMBIOS
├── public/
│   ├── index.html            ← Multi-selección, modos, slider IoU, gestión de taxonomía
│   ├── styles.css            ← Estilos: checkboxes, sub-pestañas, pills, homologación
│   ├── app.js                ← Orquestación paralela, IoU, modos, homologación de clases
│   ├── models.example.json   ← Modelos de ejemplo
│   └── taxonomy.example.json ← Diccionario de Clases Sinónimas por defecto (NUEVO)
├── package.json
├── vercel.json
├── .env.local.example
├── .gitignore
└── README.md
```

El backend **no ha cambiado** respecto a v2. Toda la lógica de orquestación y homologación vive en el navegador.

---

## Despliegue

Si vienes de una v3 anterior, **reemplaza los archivos del frontend** (`public/index.html`, `public/styles.css`, `public/app.js`) y **añade el nuevo** `public/taxonomy.example.json`. La variable de entorno `ROBOFLOW_API_KEY` ya configurada en Vercel sigue siendo válida.

Vercel detectará el push y redesplegará en 1-2 minutos.

Para un despliegue desde cero, sigue las instrucciones de la v2 (subir a un repo nuevo de GitHub, conectar con Vercel, añadir la variable de entorno `ROBOFLOW_API_KEY`).

---

## El Diccionario de Clases Sinónimas

La herramienta mantiene una **taxonomía estándar de 6 clases** para imágenes RGB:

| Clase estándar | Significado / acción |
|---|---|
| `Snow` | Nieve. Programar limpieza. |
| `Dust` | Suciedad acumulada sobre el panel. Programar limpieza. |
| `Bird Drop` | Excremento de ave. Programar limpieza. |
| `Physical Damage` | Fisura visible. Riesgo de degradación acelerada. |
| `Defective` | Algún tipo de defecto. Programar siguiente revisión presencial. |
| `Non Defective` | Panel sano. Programar siguiente revisión con IA. |

Cada modelo nombra sus clases a su manera. El **Diccionario de Clases Sinónimas** (un JSON editable en la pestaña *Configurar*) indica qué nombres equivalen a cada clase estándar. Ejemplo: `Dust`, `Dusty`, `Dirty` y `Soiling` se homologan todos a `Dust`; `Cracked` se homologa a `Physical Damage`; `Panel` a `Non Defective`.

- La homologación es **insensible a mayúsculas, espacios y guiones** (bajos o medios): no hace falta enumerar `Physical_Damage`, `Physical-Damage` y `Physical Damage` por separado.
- El diccionario se gestiona como los modelos: persistencia en `localStorage`, export/import a `taxonomy.json` y opción de recargar el de por defecto.
- Las clases **no presentes** en el diccionario **se conservan y se muestran** con borde discontinuo y la etiqueta "Sin homologar". Nunca se descartan: ocultar un defecto real sería peligroso.
- En las listas de detecciones, cuando la etiqueta original difiere de la estándar, se muestra una línea de trazabilidad `homologado desde: "..."`.

El consenso agrupa por la **clase homologada**, de modo que detecciones con nombres distintos pero sinónimos (`Dust` de un modelo, `Dirty` de otro) que solapen espacialmente se consolidan en un único hallazgo.

---

## Compatibilidad con la v2

- **Misma clave de localStorage** (`rf_models_v2`) → los modelos guardados en la v2 funcionan sin migración.
- **Mismo formato `models.json`** → los archivos exportados con la v2 se pueden importar en la v3 directamente.
- **Mismo endpoint `/api/infer`** → si tienes el repo de la v2 ya desplegado, no toca tocar nada del backend.
- El Diccionario de Clases Sinónimas se carga automáticamente la primera vez desde `taxonomy.example.json`; no requiere ninguna acción del usuario.

---

## Cómo se usa el modo multi-modelo

1. En la pestaña **🔍 Analizar**, marca con casillas los modelos que quieras usar (uno o varios).
2. Si seleccionas más de uno, aparece un aviso amarillo recordando que cada inferencia consume créditos de Roboflow.
3. Sube la imagen y pulsa **Analizar imagen**.
4. Cuando termine (típicamente 2-5 segundos), navega entre las tres sub-pestañas:
   - **Unión**: visión global.
   - **Por modelo**: enfoque uno a uno.
   - **Consenso**: prueba diferentes umbrales de IoU con el slider para ver cómo cambia el agrupamiento.
5. En la parte inferior, el **Resumen por modelo** muestra el estado de cada inferencia (verde si OK, rojo si falló, con el motivo).

---

## Decisiones técnicas relevantes

### Orquestación desde el cliente
Las N llamadas a `/api/infer` se hacen desde el navegador con `Promise.allSettled`. Ventajas:
- El backend serverless no necesita cambios.
- No hay timeout acumulado (cada llamada independiente).
- Si un modelo falla, los demás siguen mostrando resultados.

### Colores asignados por posición
Los colores se asignan en el orden en que aparecen los modelos en `models.json` (índice 0 → azul, índice 1 → naranja…). No están en el JSON para no añadir campos al formulario de configuración. Si reordenas los modelos, los colores cambian, pero la identificación visual sigue funcionando.

### Algoritmo de consenso
Se usa **single-link clustering**: una detección se añade al grupo si solapa lo suficiente (IoU ≥ umbral) con **cualquier** miembro del grupo, no necesariamente con todos. Es el comportamiento más natural cuando varios modelos producen cajas ligeramente diferentes para el mismo defecto.

### Caja consensuada
Cuando se fusionan N detecciones en una sola caja, las coordenadas se calculan como **media ponderada por confianza**. Da más peso a los modelos más seguros.

---

## Próximos pasos del roadmap

Esta v3 completa el **Sprint 1**. Los siguientes sprints planeados:

- **Sprint 2**: histórico de inferencias (Supabase).
- **Sprint 3**: integración con LLM para diagnósticos en lenguaje natural.
- **Sprint 4**: análisis por lotes (10-20 imágenes de una instalación).
- **Sprint 5**: evaluación cuantitativa contra ground truth.

---

## Solución de problemas

- **"El backend no tiene configurada ROBOFLOW_API_KEY"** → Vercel → tu proyecto → *Settings → Environment Variables* → verifica que la variable existe. Después *Deployments → Redeploy* en el último despliegue.
- **Algunos modelos fallan con 401/403** → la API Key no tiene acceso a esos modelos en concreto. Comprueba que pertenecen a tu workspace o son públicos.
- **El análisis tarda mucho con varios modelos** → es esperado: la duración total es la del modelo más lento, no la suma. Roboflow Hosted suele responder en 1-3 segundos por modelo.
- **El modo Consenso no muestra agrupaciones esperadas** → baja el umbral de IoU (slider) o comprueba si los modelos están devolviendo nombres de clase distintos (puedes verlo en la vista "Por modelo"). En el caso de nombres distintos, el reconciliador semántico llegará con el LLM del Sprint 3.
