/**
 * Demo básico: login + 1 query + caption final.
 * Reemplaza las constantes y los selectores según tu app.
 *
 * Uso:
 *   cd <directorio-de-tu-app>
 *   pnpm dev &                                 # debe servir en BASE_URL
 *   cd ~/.claude/skills/webapp-demo-recorder
 *   pnpm tsx examples/basic-login-demo.ts
 */
import { recordDemo, type DemoConfig } from "../scripts/engine";

const config: DemoConfig = {
  baseUrl: "http://localhost:3000",
  output: "/tmp/basic-demo.mp4",
  viewport: { width: 1280, height: 800 },
  accentColor: "#3B82F6",

  steps: [
    { type: "navigate", url: "/" },
    { type: "wait", ms: 600 },
    { type: "caption", text: "Demo: My App · Login + primer uso", duration: 2800 },

    // ── Login ─────────────────────────────────────────────────────────────
    { type: "caption", text: "1. Login con admin", duration: 1800 },
    { type: "fill", selector: 'input[type="email"]', value: "admin@example.com" },
    { type: "fill", selector: 'input[type="password"]', value: "secret-123" },
    { type: "click", selector: 'button[type="submit"]' },
    { type: "waitForUrl", url: "http://localhost:3000/" },
    { type: "wait", ms: 800 },

    // ── Primer uso ────────────────────────────────────────────────────────
    { type: "caption", text: "2. Pregunta al agente", duration: 2200 },
    { type: "type", selector: "textarea", value: "¿Cuántos usuarios activos tenemos?" },
    { type: "press", key: "Enter" },
    { type: "waitForAgentDone", timeoutMs: 60000 },
    { type: "caption", text: "✓ Listo — el agente respondió en streaming", duration: 3000 },

    { type: "caption", text: "Demo completo.", duration: 2500 },
  ],
};

export default config;

// Permite ejecutar directamente con tsx
if (require.main === module || process.argv[1]?.endsWith("basic-login-demo.ts")) {
  recordDemo(config).catch((err) => {
    console.error("✗", err);
    process.exit(1);
  });
}
