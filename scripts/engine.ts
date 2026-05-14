/**
 * webapp-demo-recorder — engine.
 *
 * Graba un video MP4 de una aplicación web siguiendo un "guion" declarativo.
 * Usa Playwright headless con video recorder nativo (no depende del Screen
 * Recording permission del macOS WindowServer, no captura ventanas perdidas
 * detrás de otras apps, y es 100% reproducible en CI).
 *
 * Después de grabar transcode WEBM → MP4 H.264 (compatible con WhatsApp,
 * email, navegadores, todo).
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { renameSync, readdirSync, mkdirSync, existsSync, writeFileSync, statSync, readFileSync } from "fs";
import { join, dirname, basename, resolve } from "path";
import { execSync } from "child_process";
import { createHash } from "crypto";

// ── Tipos del guion ─────────────────────────────────────────────────────────

export type DemoStep =
  /** Muestra un caption overlay durante `duration` ms. Bloquea hasta que termina.
   *  Si la config tiene `narration`, se sintetiza este caption en voz y se mezcla
   *  con el video al final. `narrationText` permite que la voz diga algo distinto
   *  al texto en pantalla (útil para captions cortos con narración expandida).
   *  `mute: true` desactiva la narración sólo para este caption. */
  | { type: "caption"; text: string; duration?: number; narrationText?: string; mute?: boolean }
  /** Navega a una URL relativa o absoluta. */
  | { type: "navigate"; url: string; waitUntil?: "load" | "networkidle" }
  /** Llena un input con un valor. Limpia primero. */
  | { type: "fill"; selector: string; value: string }
  /** Escribe en un input letra por letra (efecto humano). */
  | { type: "type"; selector: string; value: string; perCharMs?: [number, number] }
  /** Click en un selector. */
  | { type: "click"; selector: string }
  /** Pulsa una tecla (Enter, Escape, etc.) */
  | { type: "press"; key: string }
  /** Espera tiempo fijo. */
  | { type: "wait"; ms: number }
  /** Espera a que el textarea/input principal del agente NO esté disabled
   *  (patrón "agente terminó de stream-ear"). */
  | { type: "waitForAgentDone"; selector?: string; timeoutMs?: number }
  /** Espera a que aparezca un selector. */
  | { type: "waitForSelector"; selector: string; timeoutMs?: number }
  /** Espera a que la URL cumpla un pattern. */
  | { type: "waitForUrl"; url: string | RegExp; timeoutMs?: number }
  /** Resalta un selector con un box-shadow rojo durante `duration` ms. */
  | { type: "highlight"; selector: string; duration?: number; color?: string }
  /** Scroll suave hasta el bottom (útil para mostrar un mail/página largo). */
  | { type: "scrollToBottom"; speedPxPerFrame?: number }
  /** Click sobre un link y navega a su href (resuelto contra baseUrl si relativo). */
  | { type: "clickLink"; selector: string };

export interface DemoConfig {
  /** URL base del app a grabar. */
  baseUrl: string;
  /** Pasos a ejecutar en orden. */
  steps: DemoStep[];
  /** Path final del MP4. */
  output: string;
  /** Viewport del browser. Default: 1280x800. */
  viewport?: { width: number; height: number };
  /** Device scale factor. Default: 2 (Retina). */
  deviceScaleFactor?: number;
  /** Color de acento para captions y highlights. Default: #E30613 (rojo JAVER). */
  accentColor?: string;
  /** CRF de ffmpeg (calidad). 18 = casi lossless, 22 = bueno, 28 = aceptable. Default: 22. */
  crf?: number;
  /** Narración via ElevenLabs TTS. Si se provee, los captions se sintetizan en
   *  voz, sus `duration` se ajustan al largo del audio, y el audio se mezcla
   *  al MP4 final. */
  narration?: NarrationConfig;
}

export interface NarrationConfig {
  /** API key de ElevenLabs. Si no se provee, lee `ELEVENLABS_API_KEY` del env. */
  apiKey?: string;
  /** Voice ID. Requerido. Ej: "21m00Tcm4TlvDq8ikWAM" (Rachel),
   *  "EXAVITQu4vr4xnSDxMaL" (Sarah), "pNInz6obpgDQGcFmaJgB" (Adam). */
  voiceId: string;
  /** Modelo. Default: "eleven_multilingual_v2" (soporta español). */
  modelId?: string;
  /** Voice settings — stability 0-1. Default: 0.5. */
  stability?: number;
  /** Voice settings — similarity boost 0-1. Default: 0.75. */
  similarityBoost?: number;
  /** Voice settings — use_speaker_boost. Default: false. */
  speakerBoost?: boolean;
  /** Cachear síntesis en `<outDir>/.demo-audio-cache/`. Default: true. */
  cache?: boolean;
}

// ── Helpers que viven dentro del browser ────────────────────────────────────

async function showCaption(
  page: Page,
  text: string,
  durationMs: number,
  accentColor: string,
) {
  await page.evaluate(
    ({ text, durationMs, accentColor }) => {
      const existing = document.getElementById("__demo_caption__");
      if (existing) existing.remove();
      const el = document.createElement("div");
      el.id = "__demo_caption__";
      el.textContent = text;
      el.style.cssText = `
        position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
        background:rgba(20,20,25,0.95); color:#fff;
        padding:14px 28px; border-radius:12px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
        font-size:18px; font-weight:600;
        z-index:2147483647; box-shadow:0 8px 32px rgba(0,0,0,0.4);
        border-left:4px solid ${accentColor};
        max-width:900px; line-height:1.4; text-align:left;
        opacity:0; transition:opacity 0.3s ease;
      `;
      document.body.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 400);
      }, durationMs);
    },
    { text, durationMs, accentColor },
  );
  await page.waitForTimeout(durationMs + 400);
}

async function highlight(
  page: Page,
  selector: string,
  durationMs: number,
  color: string,
) {
  await page.evaluate(
    ({ selector, durationMs, color }) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const prev = el.style.boxShadow;
      const prevTrans = el.style.transition;
      el.style.transition = "box-shadow 0.3s ease";
      el.style.boxShadow = `0 0 0 4px ${color}`;
      setTimeout(() => {
        el.style.boxShadow = prev;
        el.style.transition = prevTrans;
      }, durationMs);
    },
    { selector, durationMs, color },
  );
  await page.waitForTimeout(durationMs + 300);
}

async function typeLikeHuman(
  page: Page,
  selector: string,
  text: string,
  perCharMs: [number, number],
) {
  await page.click(selector);
  await page.fill(selector, "");
  for (const ch of text) {
    await page.keyboard.type(ch);
    const [min, max] = perCharMs;
    await page.waitForTimeout(min + Math.random() * (max - min));
  }
}

async function waitForAgentDone(
  page: Page,
  selector: string,
  timeoutMs: number,
) {
  // Bug fix Playwright API: page.waitForFunction(fn, arg?, options?) — pasar
  // undefined como arg para que el 3er param sea options.
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel) as
        | HTMLInputElement
        | HTMLTextAreaElement
        | null;
      return el != null && !el.disabled;
    },
    selector,
    { timeout: timeoutMs },
  );
  await page.waitForTimeout(800);
}

async function scrollToBottom(page: Page, speed: number) {
  await page.evaluate(
    (speed) =>
      new Promise<void>((resolve) => {
        const target = document.body.scrollHeight - window.innerHeight;
        let scrolled = 0;
        const interval = setInterval(() => {
          window.scrollBy(0, speed);
          scrolled += speed;
          if (scrolled >= target) {
            clearInterval(interval);
            resolve();
          }
        }, 16);
      }),
    speed,
  );
  await page.waitForTimeout(500);
}

// ── .env loader ─────────────────────────────────────────────────────────────

/**
 * Carga un .env (formato `KEY=value` por línea) en `process.env`.
 * No sobreescribe variables que ya estén definidas en el entorno — así el
 * shell siempre gana sobre el archivo. Silencioso si el archivo no existe.
 *
 * Parser deliberadamente simple: soporta comentarios con `#`, ignora líneas
 * vacías, hace strip de comillas envolventes. No soporta expansión ni
 * multilínea — si necesitas eso, instala `dotenv`.
 */
function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Raíz del repo/skill: este archivo vive en `<root>/scripts/engine.ts`. */
const SKILL_ROOT = resolve(__dirname, "..");

// ── ElevenLabs TTS ──────────────────────────────────────────────────────────

interface NarrationClip {
  /** Index del step en cfg.steps. */
  stepIndex: number;
  /** Path absoluto al .mp3 sintetizado. */
  audioPath: string;
  /** Duración del audio en ms (medida con ffprobe). */
  durationMs: number;
}

function getAudioDurationMs(audioPath: string): number {
  const out = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
    { encoding: "utf8" },
  ).trim();
  const seconds = parseFloat(out);
  if (!isFinite(seconds)) throw new Error(`ffprobe: duración inválida para ${audioPath}: ${out}`);
  return Math.round(seconds * 1000);
}

async function synthesizeText(
  text: string,
  cfg: NarrationConfig,
  cacheDir: string,
): Promise<string> {
  const apiKey = cfg.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      `narration: falta ELEVENLABS_API_KEY. Tres opciones (en orden de preferencia):
  1. Crea ${join(SKILL_ROOT, ".env")} con ELEVENLABS_API_KEY=tu_key
     (cp .env.example .env y edita)
  2. Exporta en tu shell: export ELEVENLABS_API_KEY=tu_key
  3. Pasa narration.apiKey directo en la config (no recomendado: queda en código)`,
    );
  }
  const modelId = cfg.modelId ?? "eleven_multilingual_v2";
  const stability = cfg.stability ?? 0.5;
  const similarityBoost = cfg.similarityBoost ?? 0.75;
  const speakerBoost = cfg.speakerBoost ?? false;
  const useCache = cfg.cache !== false;

  const cacheKey = createHash("sha1")
    .update(
      JSON.stringify({
        text,
        voiceId: cfg.voiceId,
        modelId,
        stability,
        similarityBoost,
        speakerBoost,
      }),
    )
    .digest("hex");
  const cachePath = join(cacheDir, `${cacheKey}.mp3`);

  if (useCache && existsSync(cachePath) && statSync(cachePath).size > 0) {
    return cachePath;
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${cfg.voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: {
          stability,
          similarity_boost: similarityBoost,
          use_speaker_boost: speakerBoost,
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "<no body>");
    throw new Error(`ElevenLabs ${res.status}: ${body}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!existsSync(dirname(cachePath))) mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, buf);
  return cachePath;
}

/**
 * Pre-sintetiza todas las narraciones y muta `duration` en los captions
 * para que sea al menos tan largo como el audio + 400ms de cola.
 * Devuelve los clips indexados por stepIndex para el muxing final.
 */
async function preSynthesizeNarrations(
  cfg: DemoConfig,
  cacheDir: string,
): Promise<NarrationClip[]> {
  if (!cfg.narration) return [];
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

  const clips: NarrationClip[] = [];
  for (let i = 0; i < cfg.steps.length; i++) {
    const step = cfg.steps[i];
    if (step.type !== "caption") continue;
    if (step.mute) continue;
    const text = (step.narrationText ?? step.text).trim();
    if (!text) continue;

    console.log(`▶ TTS [${i + 1}]: "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}"`);
    const audioPath = await synthesizeText(text, cfg.narration, cacheDir);
    const durationMs = getAudioDurationMs(audioPath);

    // Audio gana: extender el duration del caption para que dure al menos lo
    // que dura la voz, con 400ms de cola antes del fade-out.
    const originalDuration = step.duration ?? 2800;
    step.duration = Math.max(originalDuration, durationMs + 400);

    clips.push({ stepIndex: i, audioPath, durationMs });
  }
  return clips;
}

/**
 * Mezcla los clips de audio sobre el MP4 final usando ffmpeg adelay + amix.
 * Reemplaza el MP4 in-place.
 */
function muxNarration(
  mp4Path: string,
  clips: Array<{ audioPath: string; offsetMs: number }>,
): void {
  if (clips.length === 0) return;

  const tmpOut = mp4Path + ".tmp.mp4";
  const inputs = clips.map((c) => `-i "${c.audioPath}"`).join(" ");
  const delayParts = clips
    .map((c, idx) => `[${idx + 1}:a]adelay=${c.offsetMs}|${c.offsetMs}[a${idx}]`)
    .join("; ");
  const aLabels = clips.map((_, idx) => `[a${idx}]`).join("");
  // normalize=0 mantiene volumen — sin esto, amix divide por N inputs y queda muy bajo.
  const filter = `${delayParts}; ${aLabels}amix=inputs=${clips.length}:duration=longest:normalize=0[aout]`;

  console.log(`▶ Mux ${clips.length} narration clip(s) into MP4…`);
  execSync(
    `ffmpeg -y -i "${mp4Path}" ${inputs} -filter_complex "${filter}" ` +
      `-map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 192k "${tmpOut}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  renameSync(tmpOut, mp4Path);
}

// ── Step executor ──────────────────────────────────────────────────────────

async function executeStep(
  page: Page,
  step: DemoStep,
  cfg: Required<Pick<DemoConfig, "baseUrl" | "accentColor">>,
) {
  switch (step.type) {
    case "caption":
      return showCaption(page, step.text, step.duration ?? 2800, cfg.accentColor);
    case "navigate": {
      const url = step.url.startsWith("http")
        ? step.url
        : new URL(step.url, cfg.baseUrl).toString();
      await page.goto(url, { waitUntil: step.waitUntil ?? "networkidle" });
      await page.waitForTimeout(400);
      return;
    }
    case "fill":
      await page.fill(step.selector, step.value);
      return page.waitForTimeout(200);
    case "type":
      return typeLikeHuman(page, step.selector, step.value, step.perCharMs ?? [20, 60]);
    case "click":
      await page.click(step.selector);
      return page.waitForTimeout(300);
    case "press":
      await page.keyboard.press(step.key);
      return page.waitForTimeout(200);
    case "wait":
      return page.waitForTimeout(step.ms);
    case "waitForAgentDone":
      return waitForAgentDone(page, step.selector ?? "textarea", step.timeoutMs ?? 90000);
    case "waitForSelector":
      await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? 30000 });
      return;
    case "waitForUrl":
      await page.waitForURL(step.url, { timeout: step.timeoutMs ?? 15000 });
      return;
    case "highlight":
      return highlight(
        page,
        step.selector,
        step.duration ?? 1500,
        step.color ?? cfg.accentColor,
      );
    case "scrollToBottom":
      return scrollToBottom(page, step.speedPxPerFrame ?? 4);
    case "clickLink": {
      const el = await page.$(step.selector);
      if (!el) throw new Error(`clickLink: no encontré ${step.selector}`);
      const href = await el.getAttribute("href");
      if (!href) throw new Error(`clickLink: el elemento no tiene href`);
      const full = href.startsWith("http")
        ? href
        : new URL(href, cfg.baseUrl).toString();
      await page.goto(full, { waitUntil: "load" });
      await page.waitForTimeout(500);
      return;
    }
    default: {
      const _exhaustive: never = step;
      void _exhaustive;
      throw new Error(`Step type desconocido: ${JSON.stringify(step)}`);
    }
  }
}

// ── Main API ────────────────────────────────────────────────────────────────

export async function recordDemo(cfg: DemoConfig): Promise<{ mp4: string; webm: string }> {
  // Auto-load .env desde la raíz de la skill. Si el shell ya tiene la var
  // exportada, gana. Si no, llenamos desde el archivo. Silencioso si no existe.
  loadEnvFile(join(SKILL_ROOT, ".env"));

  const viewport = cfg.viewport ?? { width: 1280, height: 800 };
  const accentColor = cfg.accentColor ?? "#E30613";
  const crf = cfg.crf ?? 22;

  const outDir = dirname(cfg.output);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const videoDir = join(outDir, ".demo-videos");
  if (!existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });

  // Phase 1 — pre-síntesis de narraciones (si están configuradas).
  // Esto muta `step.duration` para captions narrados, así la grabación
  // ya queda con el timing correcto.
  const narrationCacheDir = join(outDir, ".demo-audio-cache");
  const narrationClips = await preSynthesizeNarrations(cfg, narrationCacheDir);
  // Map de stepIndex → clip, para resolver offsets durante el recording.
  const clipByStep = new Map(narrationClips.map((c) => [c.stepIndex, c]));
  /** Offsets relativos al inicio de la grabación, en ms. */
  const muxClips: Array<{ audioPath: string; offsetMs: number }> = [];

  console.log(`▶ Launching Chromium (viewport ${viewport.width}x${viewport.height})…`);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: cfg.deviceScaleFactor ?? 2,
      recordVideo: { dir: videoDir, size: viewport },
    });
    const page = await context.newPage();

    // t=0 del audio mux. Aproximación de cuándo Playwright empezó a grabar.
    const recordingStartMs = Date.now();

    console.log(`▶ Running ${cfg.steps.length} steps…`);
    for (let i = 0; i < cfg.steps.length; i++) {
      const step = cfg.steps[i];
      const label =
        step.type === "caption"
          ? `caption: "${step.text.slice(0, 60)}"`
          : step.type;
      console.log(`  [${i + 1}/${cfg.steps.length}] ${label}`);
      // Si este caption tiene narración pre-sintetizada, marca su offset
      // justo antes de mostrar el subtítulo (el audio arranca con el fade-in).
      const clip = clipByStep.get(i);
      if (clip) {
        muxClips.push({
          audioPath: clip.audioPath,
          offsetMs: Date.now() - recordingStartMs,
        });
      }
      await executeStep(page, step, { baseUrl: cfg.baseUrl, accentColor });
    }

    // Close context FIRST — Playwright finishes the webm only on context close.
    await context.close();
    context = undefined;
    await browser.close();
    browser = undefined;
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  // Move the latest webm
  const webms = readdirSync(videoDir).filter((f) => f.endsWith(".webm"));
  if (webms.length === 0) throw new Error("Playwright no produjo .webm — algo falló");
  webms.sort();
  const latest = webms[webms.length - 1];
  const rawWebm = join(outDir, basename(cfg.output, ".mp4") + ".webm");
  renameSync(join(videoDir, latest), rawWebm);
  console.log(`✓ WEBM raw: ${rawWebm}`);

  // Transcode WEBM → MP4 H.264 (universal compat)
  console.log(`▶ Transcoding to MP4 (crf=${crf})…`);
  execSync(
    `ffmpeg -y -i "${rawWebm}" -c:v libx264 -preset slow -crf ${crf} -pix_fmt yuv420p -movflags +faststart "${cfg.output}"`,
    { stdio: ["ignore", "ignore", "inherit"] },
  );

  // Phase 3 — mezcla narración (si hay).
  muxNarration(cfg.output, muxClips);

  console.log(`✓ MP4: ${cfg.output}`);
  return { mp4: cfg.output, webm: rawWebm };
}

// ── CLI entrypoint (opcional) ───────────────────────────────────────────────
// Si se ejecuta directamente con tsx scripts/engine.ts <demo-file.ts>,
// importa el archivo y espera que export default sea un DemoConfig.

async function cli() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Uso: tsx scripts/engine.ts <archivo-demo.ts>");
    console.error("  El archivo debe export default un DemoConfig.");
    process.exit(1);
  }
  const mod = await import(arg.startsWith("/") ? arg : join(process.cwd(), arg));
  const cfg: DemoConfig = mod.default ?? mod.config;
  if (!cfg) {
    console.error(`✗ ${arg} no exporta default ni 'config'`);
    process.exit(1);
  }
  await recordDemo(cfg);
}

const isMain =
  typeof require !== "undefined" && require.main === module
    ? true
    : typeof process !== "undefined" &&
      process.argv[1] &&
      (process.argv[1].endsWith("engine.ts") || process.argv[1].endsWith("engine.js"));

if (isMain) {
  cli().catch((err) => {
    console.error("✗ Demo failed:", err);
    process.exit(1);
  });
}
