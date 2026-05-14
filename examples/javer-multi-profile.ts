/**
 * Demo real usado para JAVER Analytics (caso de uso original de esta skill):
 *
 *   - 3 perfiles de usuario (Ejecutivo / Marketing / Solo gráfica)
 *   - Cada perfil contesta la MISMA pregunta de forma distinta
 *   - El agente puede mandar el reporte por correo → preview del email HTML
 *
 * Para correrlo:
 *   cd ~/JAVER && pnpm dev &        # POWERBI_MODE=mock en .env.local
 *   cd ~/.claude/skills/webapp-demo-recorder
 *   pnpm tsx examples/javer-multi-profile.ts
 *
 * Tiempo total: ~3 minutos.
 */
import { recordDemo, type DemoConfig } from "../scripts/engine";

const Q = "Top 5 proyectos con más ventas este año";

const config: DemoConfig = {
  baseUrl: "http://localhost:3000",
  output: "/Users/xgael/Documentos/javer-demo/javer-demo-flow.mp4",
  viewport: { width: 1280, height: 800 },
  accentColor: "#E30613", // rojo JAVER

  steps: [
    { type: "navigate", url: "/" },
    { type: "wait", ms: 800 },
    {
      type: "caption",
      text: "JAVER Analytics · Demo de perfiles y envío por correo",
      duration: 2800,
    },

    // ── Login ─────────────────────────────────────────────────────────────
    { type: "caption", text: "1. Login con usuario JAVER", duration: 1800 },
    { type: "fill", selector: 'input[type="email"]', value: "poc.ia@javer.com.mx" },
    { type: "fill", selector: 'input[type="password"]', value: "Javer$2026!Analytics" },
    { type: "click", selector: 'button[type="submit"]' },
    { type: "waitForUrl", url: "http://localhost:3000/" },
    { type: "wait", ms: 800 },

    // ── Perfil EJECUTIVO ──────────────────────────────────────────────────
    { type: "click", selector: 'button[aria-label*="Ejecutivo"]' },
    { type: "wait", ms: 400 },
    {
      type: "caption",
      text: "2. Perfil EJECUTIVO — reporte completo con montos, tabla, gráfica y recomendaciones",
      duration: 3200,
    },
    { type: "type", selector: "textarea", value: Q },
    { type: "press", key: "Enter" },
    { type: "caption", text: `Pregunta: "${Q}"`, duration: 2400 },
    { type: "waitForAgentDone", timeoutMs: 90000 },
    {
      type: "caption",
      text: "✓ Reporte ejecutivo: tabla completa con montos en pesos + gráfica de barras + recomendaciones",
      duration: 3800,
    },

    // ── Perfil MARKETING ──────────────────────────────────────────────────
    { type: "click", selector: 'button[aria-label*="Marketing"]' },
    { type: "wait", ms: 400 },
    {
      type: "caption",
      text: "3. Cambio a perfil MARKETING — sin acceso a montos en pesos",
      duration: 3000,
    },
    { type: "type", selector: "textarea", value: Q },
    { type: "press", key: "Enter" },
    {
      type: "caption",
      text: "Misma pregunta — Marketing solo ve cantidades, no montos $",
      duration: 3000,
    },
    { type: "waitForAgentDone", timeoutMs: 90000 },
    {
      type: "caption",
      text: "✓ Marketing: tabla por # de ventas. Mismo dato, sin información financiera",
      duration: 3800,
    },

    // ── Perfil SOLO GRÁFICA ───────────────────────────────────────────────
    { type: "click", selector: 'button[aria-label*="Solo gráfica"]' },
    { type: "wait", ms: 400 },
    {
      type: "caption",
      text: "4. Perfil SOLO GRÁFICA — dashboard rápido, mínimo texto",
      duration: 3000,
    },
    { type: "type", selector: "textarea", value: Q },
    { type: "press", key: "Enter" },
    { type: "waitForAgentDone", timeoutMs: 90000 },
    {
      type: "caption",
      text: "✓ Solo gráfica: contexto en 1 frase + chart + 2 bullets",
      duration: 3800,
    },

    // ── Envío por correo ──────────────────────────────────────────────────
    { type: "click", selector: 'button[aria-label*="Ejecutivo"]' },
    { type: "wait", ms: 400 },
    {
      type: "caption",
      text: "5. Plus: el agente puede mandar el reporte por correo a tu email",
      duration: 3200,
    },
    {
      type: "type",
      selector: "textarea",
      value: Q + " y mándamelo por correo",
    },
    { type: "press", key: "Enter" },
    {
      type: "caption",
      text: `Pregunta: "${Q} y mándamelo por correo"`,
      duration: 2800,
    },
    { type: "waitForAgentDone", timeoutMs: 90000 },
    {
      type: "caption",
      text: "✓ El agente generó el reporte + invocó la tool de email",
      duration: 3000,
    },
    {
      type: "highlight",
      selector: "div.bg-emerald-50",
      duration: 2000,
    },
    {
      type: "caption",
      text: "Badge verde: 'Vista previa generada' con link al HTML del email",
      duration: 3500,
    },

    // ── Preview del email HTML ────────────────────────────────────────────
    { type: "clickLink", selector: 'a:has-text("Ver vista previa")' },
    {
      type: "caption",
      text: "6. Preview del email — branding JAVER, tabla, gráficos como barras CSS, filtros con checkboxes",
      duration: 4500,
    },
    { type: "scrollToBottom", speedPxPerFrame: 4 },
    {
      type: "caption",
      text: "El botón 'Abrir filtrado en JAVER' regresa a la app con la query precargada",
      duration: 3500,
    },

    {
      type: "caption",
      text: "Demo completo. JAVER Analytics — IA conversacional sobre Power BI.",
      duration: 3500,
    },
  ],
};

export default config;

if (require.main === module || process.argv[1]?.endsWith("javer-multi-profile.ts")) {
  recordDemo(config).catch((err) => {
    console.error("✗", err);
    process.exit(1);
  });
}
