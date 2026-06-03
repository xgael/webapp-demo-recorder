/**
 * Example: Ken Burns zoom + intro/outro title cards.
 *
 * Muestra cómo:
 *  - abrir con una placa de branding (logo + título)
 *  - acercar la "cámara" a indicadores/campos concretos (zoom)
 *  - quedarse acercado mientras se interactúa (zoom reset:false → type → resetZoom)
 *  - cerrar con una placa de CTA
 *
 * Ajusta `baseUrl`, los selectores y el `logo` a tu app. El archivo DEBE llamar
 * a recordDemo(config) al final (no basta export default).
 *
 * Correr:  npx tsx examples/zoom-branding-demo.ts
 */
import { recordDemo, type DemoConfig } from "../scripts/engine";

const config: DemoConfig = {
  baseUrl: process.env.DEMO_URL ?? "http://localhost:3000",
  output: "./output/zoom-branding-demo.mp4",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  accentColor: "#764ff9",
  steps: [
    // ── INTRO (branding) ──
    // logo: ruta a un archivo local (se incrusta base64) o una URL/data-uri. Opcional.
    {
      type: "titleCard",
      title: "Mi App · ERP",
      subtitle: "Demo de funcionalidades",
      // logo: "./assets/logo.png",
      duration: 3000,
    },

    { type: "navigate", url: "/" },
    { type: "caption", text: "Panel de control en tiempo real", duration: 2600 },

    // ── Ken Burns: acercar a un dato clave (se centra con precisión) ──
    { type: "caption", text: "Acercamos a un indicador clave 🔍", duration: 2200 },
    { type: "zoom", selector: "#kpi-principal", scale: 2.0, hold: 1800 },

    // ── Zoom que se queda acercado mientras se captura un formulario ──
    { type: "caption", text: "Captura de un registro", duration: 2200 },
    { type: "zoom", selector: "#form", scale: 1.7, hold: 600, reset: false },
    { type: "type", selector: "#form input", value: "Texto de ejemplo", perCharMs: [55, 110] },
    { type: "wait", ms: 500 },
    { type: "resetZoom" },

    // ── OUTRO (CTA / contacto) ──
    {
      type: "titleCard",
      title: "¿Listo para empezar?",
      subtitle: "ventas@miapp.com · miapp.com",
      duration: 3200,
      bg: "radial-gradient(circle at 70% 30%, #2a1d4d 0%, #0c0e16 70%)",
    },
  ],
};

recordDemo(config).catch((e) => {
  console.error("✗", e);
  process.exit(1);
});
