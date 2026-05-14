# webapp-demo-recorder

> Graba videos demo de aplicaciones web siguiendo un guion declarativo en TypeScript. Diseñado para [Claude Code](https://claude.com/claude-code) como skill, pero usable como librería standalone.

![Playwright](https://img.shields.io/badge/Playwright-1.48-2EAD33) ![Node](https://img.shields.io/badge/Node-18%2B-339933) ![License](https://img.shields.io/badge/license-MIT-blue)

## ¿Qué hace?

Toma un app web que estás corriendo (localhost, staging) y un guion de pasos (login, click, type, wait, etc.) y produce un **MP4** del flujo, con captions overlay, highlights y detección automática de "el agente terminó".

A diferencia de grabar la pantalla con QuickTime, esto:

- ✅ **No necesita Screen Recording permission** en macOS
- ✅ **No se rompe** si otra ventana queda encima
- ✅ **Funciona en CI/CD** (headless)
- ✅ **Reproducible** — corre 10 veces y sale igual
- ✅ Resolución exacta del viewport, no del display
- ✅ Captions y highlights inyectados al DOM (no son edición post-hoc)
- ✅ **Voz opcional** vía ElevenLabs — narración sincronizada con cada caption

## Quick start

```bash
git clone https://github.com/xgael/webapp-demo-recorder.git
cd webapp-demo-recorder
pnpm install
pnpm setup                # instala Chromium para Playwright

# Asegúrate que tu app esté corriendo
cd ../mi-app && pnpm dev &

cd ../webapp-demo-recorder
pnpm tsx examples/basic-login-demo.ts
```

Te queda `/tmp/basic-demo.mp4`.

## Como skill de Claude Code

Clona el repo en `~/.claude/skills/`:

```bash
git clone https://github.com/xgael/webapp-demo-recorder.git \
  ~/.claude/skills/webapp-demo-recorder
cd ~/.claude/skills/webapp-demo-recorder
pnpm install && pnpm setup
```

Después, le dices a Claude algo como *"graba un video del demo de mi app, pasando por login → consulta X → resultado"* y Claude activa la skill automáticamente, genera el script con tus credenciales, lo ejecuta y te entrega el MP4.

Lee [SKILL.md](./SKILL.md) para los detalles que Claude usa.

## API

```ts
import { recordDemo, type DemoConfig } from "webapp-demo-recorder/scripts/engine";

await recordDemo({
  baseUrl: "http://localhost:3000",
  output: "/tmp/demo.mp4",
  viewport: { width: 1280, height: 800 },     // opcional
  deviceScaleFactor: 2,                       // opcional
  accentColor: "#E30613",                     // captions/highlights
  crf: 22,                                    // calidad ffmpeg
  steps: [
    { type: "navigate", url: "/" },
    { type: "caption", text: "Login con admin", duration: 2000 },
    { type: "fill", selector: 'input[type="email"]', value: "admin@x.com" },
    { type: "fill", selector: 'input[type="password"]', value: "secret" },
    { type: "click", selector: 'button[type="submit"]' },
    { type: "waitForUrl", url: "http://localhost:3000/" },
    { type: "type", selector: "textarea", value: "Hola, ¿cuántos usuarios hay?" },
    { type: "press", key: "Enter" },
    { type: "waitForAgentDone" },             // espera textarea !disabled
    { type: "highlight", selector: ".badge" },
    { type: "scrollToBottom" },
    { type: "caption", text: "Listo." },
  ],
});
```

## Step types

| Type | Descripción |
|---|---|
| `caption` | Overlay con subtítulo (fade-in + display + fade-out). |
| `navigate` | Va a una URL relativa (vs `baseUrl`) o absoluta. |
| `fill` | Llena un input rápido. |
| `type` | Escribe letra por letra (efecto humano). |
| `click` | Click en un selector. |
| `press` | Pulsa una tecla (`Enter`, `Escape`, etc.). |
| `wait` | Espera ms fijos. |
| `waitForAgentDone` | Espera a que un textarea/input deje de estar `disabled` (patrón "agente terminó"). |
| `waitForSelector` | Espera a que aparezca un selector. |
| `waitForUrl` | Espera a que la URL coincida. |
| `highlight` | Box-shadow temporal sobre un selector. |
| `scrollToBottom` | Scroll suave hasta el final. |
| `clickLink` | Click sobre un `<a>` y navega a su `href`. |

## Output

Después de correr:
- `<output>.mp4` — video final H.264 (compatible WhatsApp, email, navegadores)
- `<output>.webm` — raw de Playwright (puedes borrarlo)

Tamaño típico: ~4-8 MB para 2-3 min en 1280×800.

## Narración con voz (ElevenLabs)

Opcional. Si pasas un bloque `narration`, cada `caption` se sintetiza con
ElevenLabs y se mezcla al MP4 final. La duración del caption en pantalla se
ajusta automáticamente al largo del audio (audio gana — nunca se corta voz).

```ts
import { recordDemo } from "../scripts/engine";

await recordDemo({
  baseUrl: "http://localhost:3000",
  output: "/tmp/demo.mp4",
  narration: {
    // apiKey: lee process.env.ELEVENLABS_API_KEY por default
    voiceId: "EXAVITQu4vr4xnSDxMaL",        // Sarah — narradora natural
    modelId: "eleven_multilingual_v2",       // soporta español
    stability: 0.5,
    similarityBoost: 0.75,
  },
  steps: [
    { type: "navigate", url: "/" },
    // Texto corto en pantalla, narración expandida:
    {
      type: "caption",
      text: "Login",
      narrationText: "Primero ingresamos con la cuenta de admin.",
    },
    { type: "fill", selector: 'input[type="email"]', value: "admin@x.com" },
    // ...
    // Caption sin voz:
    { type: "caption", text: "Fin", mute: true, duration: 1500 },
  ],
});
```

**Setup de la API key** (tres opciones, en orden de preferencia):

1. **`.env` en la raíz de la skill** — pega una vez, funciona siempre:
   ```bash
   cp .env.example .env
   # edita .env y pon ELEVENLABS_API_KEY=tu_key
   ```
   Está en `.gitignore`. El engine lo auto-carga; el shell siempre gana sobre
   el archivo (no sobreescribe vars ya exportadas).

2. **Variable de entorno** — útil para CI/CD:
   ```bash
   export ELEVENLABS_API_KEY=tu_key
   ```

3. **`narration.apiKey` directo en la config** — sólo como override puntual.
   No recomendado: el script de demo se puede commitear por accidente.

> ⚠️ No pegues la key en un chat con Claude ni en mensajes. Queda en historial
> y se puede filtrar al compartir conversaciones. Usa `.env` y olvídate.

**Costo:** `eleven_multilingual_v2` cuesta ~$0.30/1k chars. Un demo típico
(500-1500 chars de captions) sale ~$0.15-0.45. Re-runs son **gratis**: hay
cache SHA1 en `<outDir>/.demo-audio-cache/`. Para invalidar, borra ese
directorio.

**Voice IDs útiles** (públicos de ElevenLabs):
- `21m00Tcm4TlvDq8ikWAM` — Rachel (inglés, calma)
- `EXAVITQu4vr4xnSDxMaL` — Sarah (multilingüe, natural)
- `pNInz6obpgDQGcFmaJgB` — Adam (inglés, profesional)
- Custom: clónate tu propia voz en app.elevenlabs.io y usa su ID

## Examples

- [`examples/basic-login-demo.ts`](./examples/basic-login-demo.ts) — hello world, login + 1 query.
- [`examples/narrated-demo.ts`](./examples/narrated-demo.ts) — el mismo flow con voz de ElevenLabs.
- [`examples/javer-multi-profile.ts`](./examples/javer-multi-profile.ts) — caso real: 3 perfiles + envío de email + preview HTML. Buena referencia de complejidad real.

## Requisitos

- Node 18+
- macOS / Linux (Windows debería funcionar pero no se ha probado)
- `ffmpeg` en el PATH (`brew install ffmpeg`)
- Playwright Chromium (instalado por `pnpm setup`)

## Troubleshooting

### El video sale en negro / wallpaper

No te pasa con esta skill — la grabación es del browser context, no del screen. Si te pasara, revisa que el `output` no esté siendo sobreescrito.

### `Timeout 30000ms exceeded` en `waitForAgentDone`

El agente tarda más de 30s. Sube el timeout:
```ts
{ type: "waitForAgentDone", timeoutMs: 120000 }
```

### El preview/state se pierde durante el demo

Si tu app guarda state en memoria server-side y Next.js dev hace HMR entre requests, el state se pierde. Solución en tu app:

```ts
const globalRef = globalThis as unknown as { __myStore?: Map<...> };
const STORE = globalRef.__myStore ?? (globalRef.__myStore = new Map());
```

### Quiero el video en 4K / 60fps

`viewport: { width: 3840, height: 2160 }` para 4K. Playwright graba al framerate que pueda (~25-30 en headless). Si necesitas 60fps fluído, considera grabar con QuickTime + ventana visible.

## License

MIT — usa, modifica, distribuye.

## Author

xgael · [@xgael](https://github.com/xgael)

Construido como abstracción del demo recorder armado para [JAVER Analytics](https://github.com/luisvargasfdz/JAVER) (chatbot BI sobre Power BI con Claude Sonnet 4.6).
