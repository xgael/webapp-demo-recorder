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
import { renameSync, readdirSync, mkdirSync, existsSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { execSync } from "child_process";

// ── Tipos del guion ─────────────────────────────────────────────────────────

export type DemoStep =
  /** Muestra un caption overlay durante `duration` ms. Bloquea hasta que termina. */
  | { type: "caption"; text: string; duration?: number }
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
  | { type: "clickLink"; selector: string }
  /** Ejecuta JS arbitrario en el contexto de la página (window/document). */
  | { type: "evaluate"; code: string }
  /** Punto de narración: registra el offset real en el video y mantiene la pantalla
   *  visible mientras dura el audio (+ padMs, default 700). El audio se mezcla en post. */
  | { type: "narrate"; audio: string; padMs?: number };

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
  /** JS inyectado en cada documento antes de cargar (page.addInitScript). Útil para ocultar elementos del UI durante toda la navegación. */
  initScript?: string;
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

// ── Step executor ──────────────────────────────────────────────────────────

/** Duración de un archivo de audio en ms, vía ffprobe. Fallback 3000ms. */
function audioDurationMs(file: string): number {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${file}"`,
    )
      .toString()
      .trim();
    const s = parseFloat(out);
    return Number.isFinite(s) ? Math.round(s * 1000) : 3000;
  } catch {
    return 3000;
  }
}

type RecCtx = { t0: number; cues: { audio: string; atMs: number; durMs: number }[] };

async function executeStep(
  page: Page,
  step: DemoStep,
  cfg: Required<Pick<DemoConfig, "baseUrl" | "accentColor">>,
  rec?: RecCtx,
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
    case "evaluate":
      await page.evaluate(step.code);
      return page.waitForTimeout(150);
    case "narrate": {
      // Registra el offset real (wall-clock = tiempo de video) y mantiene la
      // pantalla visible mientras "suena" la voz. El audio se mezcla en post.
      const durMs = audioDurationMs(step.audio);
      if (rec) rec.cues.push({ audio: step.audio, atMs: Date.now() - rec.t0, durMs });
      await page.waitForTimeout(durMs + (step.padMs ?? 700));
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
  const viewport = cfg.viewport ?? { width: 1280, height: 800 };
  const accentColor = cfg.accentColor ?? "#E30613";
  const crf = cfg.crf ?? 22;

  const outDir = dirname(cfg.output);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const videoDir = join(outDir, ".demo-videos");
  if (!existsSync(videoDir)) mkdirSync(videoDir, { recursive: true });

  console.log(`▶ Launching Chromium (viewport ${viewport.width}x${viewport.height})…`);
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  const rec: RecCtx = { t0: 0, cues: [] };
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: cfg.deviceScaleFactor ?? 2,
      recordVideo: { dir: videoDir, size: viewport },
    });
    const page = await context.newPage();
    if (cfg.initScript) await page.addInitScript(cfg.initScript);
    rec.t0 = Date.now(); // inicio efectivo de grabación → base de offsets de narración

    console.log(`▶ Running ${cfg.steps.length} steps…`);
    for (let i = 0; i < cfg.steps.length; i++) {
      const step = cfg.steps[i];
      const label =
        step.type === "caption"
          ? `caption: "${step.text.slice(0, 60)}"`
          : step.type;
      console.log(`  [${i + 1}/${cfg.steps.length}] ${label}`);
      await executeStep(page, step, { baseUrl: cfg.baseUrl, accentColor }, rec);
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

  console.log(`✓ MP4: ${cfg.output}`);

  if (rec.cues.length > 0) {
    const cuesPath = join(outDir, basename(cfg.output, ".mp4") + ".cues.json");
    writeFileSync(cuesPath, JSON.stringify(rec.cues, null, 2));
    console.log(`✓ Narration cues (${rec.cues.length}): ${cuesPath}`);
  }
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
