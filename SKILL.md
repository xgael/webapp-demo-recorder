---
name: webapp-demo-recorder
description: Graba videos demo automatizados de aplicaciones web. Usa Playwright headless con video recording nativo + ffmpeg. Útil cuando el usuario pide "graba un video del demo", "haz un screencast del flujo", "genera un video que muestre cómo funciona X". Soporta captions overlay, highlights, agent-done detection, scroll suave, click-link-to-navigate.
---

# webapp-demo-recorder

Genera videos MP4 de aplicaciones web siguiendo un "guion" declarativo (lista de steps tipados). El video se renderiza **dentro del browser**, no captura la pantalla del macOS — esto significa:

- ✅ No depende del permiso Screen Recording de macOS
- ✅ No se rompe si otra ventana queda encima
- ✅ Funciona en CI/CD
- ✅ Resolución exacta del viewport (no del display físico)
- ✅ Reproducible — corre 10 veces y sale igual

## Cuándo usar este skill

Activación natural:
- "Graba un video del demo de mi app"
- "Haz un screencast mostrando el flujo X"
- "Necesito un video para mostrarle a mi cliente cómo funciona"
- "Genera un video que pase por estos pasos: login → consulta → ..."

NO usar para:
- Grabación con audio narrado en tiempo real (esto graba el browser, no el desktop)
- Grabación de apps nativas/desktop (esto es web-only)
- Screenshots estáticos (usar `screencapture` directo)

## Setup en cliente (una sola vez por máquina)

Si la skill aún no tiene `node_modules`:

```bash
cd ~/.claude/skills/webapp-demo-recorder
pnpm install   # o npm install
npx playwright install chromium
```

Comprobar `ffmpeg`:
```bash
which ffmpeg && ffmpeg -version | head -1
# Si no está: brew install ffmpeg
```

## API — `recordDemo(config)`

```ts
import { recordDemo, type DemoConfig } from "~/.claude/skills/webapp-demo-recorder/scripts/engine";

const config: DemoConfig = {
  baseUrl: "http://localhost:3000",
  output: "/Users/xgael/Documentos/mi-app/demo.mp4",
  viewport: { width: 1280, height: 800 },        // opcional
  deviceScaleFactor: 2,                          // opcional, retina
  accentColor: "#E30613",                        // opcional, color de captions/highlights
  crf: 22,                                       // opcional, calidad ffmpeg (18 alto, 28 bajo)
  steps: [ /* ver abajo */ ],
};

await recordDemo(config);
// → escribe: <output>.mp4 + <output>.webm (raw)
```

## Step types disponibles

```ts
| { type: "caption"; text: string; duration?: number }                    // overlay con subtítulo
| { type: "navigate"; url: string; waitUntil?: "load" | "networkidle" }   // relativa o absoluta
| { type: "fill"; selector: string; value: string }                       // input rápido
| { type: "type"; selector: string; value: string; perCharMs?: [n,n] }    // letra por letra (humano)
| { type: "click"; selector: string }
| { type: "press"; key: string }                                          // Enter, Escape, etc.
| { type: "wait"; ms: number }
| { type: "waitForAgentDone"; selector?: string; timeoutMs?: number }     // espera textarea !disabled
| { type: "waitForSelector"; selector: string; timeoutMs?: number }
| { type: "waitForUrl"; url: string | RegExp; timeoutMs?: number }
| { type: "highlight"; selector: string; duration?: number; color?: string }  // box-shadow rojo
| { type: "scrollToBottom"; speedPxPerFrame?: number }                    // scroll suave hasta el fin
| { type: "clickLink"; selector: string }                                 // click → navigate al href
```

## Workflow típico (cómo lo invocas como Claude)

1. **Preguntas al usuario lo necesario:**
   - URL del app (local o staging — NO prod sin pedir permiso)
   - Credenciales si requiere login
   - El "guion" de pasos en lenguaje natural

2. **Construyes el script `demo.ts`** copiando uno de `examples/` y modificando.
   Pones `cd <repo-de-app> && pnpm dev &` si es local — el app debe estar
   corriendo en `baseUrl`.

3. **Ejecutas**:
   ```bash
   cd ~/.claude/skills/webapp-demo-recorder
   pnpm tsx <ruta-a-demo.ts>
   ```

4. **Verificas un frame** con ffmpeg para confirmar que se ve bien:
   ```bash
   ffmpeg -y -i <output>.mp4 -ss 30 -frames:v 1 -update 1 /tmp/frame.png
   # Read /tmp/frame.png
   ```

5. **Entregas al usuario** el path absoluto del MP4. Mencionas tamaño y duración.

## Trucos y gotchas que aprendí escribiendo esta skill

### El selector del agente

Para apps con chat tipo Claude/JAVER donde el agente "piensa" y el input se
deshabilita durante streaming, usa `waitForAgentDone`. Detecta cuando un
`textarea`/`input` deja de estar `disabled`. Default: `textarea`. Si tu app usa
otro selector, pásalo:

```ts
{ type: "waitForAgentDone", selector: "#user-input", timeoutMs: 120000 }
```

### Captions overlay

Cada `caption` bloquea hasta que termina su animación (fade-in + display +
fade-out). El default es 2800ms. Si tienes captions seguidos sin espera entre
ellos, queda un ritmo natural — no necesitas `wait` extra.

### Resolución del WEBM

El WEBM raw que produce Playwright **NO siempre** respeta exactamente el
viewport (puede agregar 1-2px). El MP4 transcodificado sí queda en el tamaño
del viewport. Si necesitas exactitud absoluta, agrega `-vf "scale=W:H"` al
ffmpeg.

### Si el output expira o se "pierde" durante el demo

Si tu app guarda algo en memoria server-side (ej. preview de email,
documento generado), y entre el momento de crearlo y el momento de mostrarlo
hace Hot Module Reload (Next.js dev), se pierde. Solución: guardar el state en
`globalThis` para que sobreviva HMR. Ejemplo en código del JAVER project:

```ts
const globalRef = globalThis as unknown as { __myStore?: Map<...> };
const STORE = globalRef.__myStore ?? (globalRef.__myStore = new Map());
```

### URLs relativas

El step `navigate` resuelve URL relativas contra `baseUrl`. Pero si tu app
genera links con `href` relativo (sin `http://`), el step `clickLink` también
los resuelve.

### Selectores con texto

Playwright soporta `'button:has-text("Login")'` y `'a:has-text("Ver")'`. Útil
cuando los selectores CSS son frágiles.

## Examples

Mira `examples/`:

- **`basic-login-demo.ts`** — login + 1 query + caption. El "hello world".
- **`javer-multi-profile.ts`** — el demo real que armé para JAVER: 3 perfiles
  de usuario + envío de email + preview. Buena referencia de complejidad real.

## Output esperado

Después de correr:
- `<output>.mp4` — el video final (compatible WhatsApp, email, navegadores)
- `<output>.webm` — el raw de Playwright (mantenlo o bórralo según necesites)
- Stdout con logs por step: `[3/12] caption: "Login con admin"`

Tiempos típicos (~2-3 min de duración final):
- Demo de 12 steps con 3 queries a un agente Claude: **~3 minutos** de ejecución
- Demo simple de 5 steps: **~30 segundos**

## Anatomía de un demo bien hecho

Estructura sugerida (probada en JAVER):

```
1. caption "Intro" (3s)
2. navigate "/"
3. caption "Login"
4. fill/type credenciales
5. click submit
6. waitForUrl "/"
7. caption "Sección 1: X"
8. type pregunta
9. press Enter
10. waitForAgentDone
11. caption "✓ Resultado: ..."
12. ... (repetir 7-11 para cada sección)
13. caption "Demo completo"
```

Captions cortos (< 80 chars), específicos, sin pasivos. Cada caption debe
**explicar lo que el usuario está por ver** o **confirmar lo que acaba de
ver**.

## Si necesitas modificar el engine

Vive en `scripts/engine.ts`. Tipos exportados: `DemoConfig`, `DemoStep`. Para
agregar un nuevo step type:

1. Añade variante al union `DemoStep`.
2. Añade case en `executeStep`.
3. Documenta en este SKILL.md.

Mantén los pasos **declarativos** (no efectos secundarios escondidos), y la
API **chiquita** (no más de 15 step types — si necesitas más, probablemente la
skill está creciendo más allá de su propósito).
