/**
 * Demo narrado: el mismo flow que basic-login-demo, pero con voz de
 * ElevenLabs leyendo cada caption. Cada caption queda sincronizado con
 * su audio (el `duration` se ajusta automáticamente al largo de la voz).
 *
 * Setup de la API key (escoge una):
 *   - cp .env.example .env && edita .env con tu key (recomendado)
 *   - export ELEVENLABS_API_KEY=tu_api_key
 *
 * Correr:
 *   cd <directorio-de-tu-app> && pnpm dev &
 *   cd ~/.claude/skills/webapp-demo-recorder
 *   pnpm tsx examples/narrated-demo.ts
 *
 * Costo aproximado: ~$0.15-0.30 por demo (eleven_multilingual_v2,
 * ~500-1500 chars). Re-runs son gratis: hay cache SHA1 en
 * <outDir>/.demo-audio-cache/.
 */
import { recordDemo, type DemoConfig } from "../scripts/engine";

const config: DemoConfig = {
  baseUrl: "http://localhost:3000",
  output: "/tmp/narrated-demo.mp4",
  viewport: { width: 1280, height: 800 },
  accentColor: "#3B82F6",

  narration: {
    // apiKey: lee process.env.ELEVENLABS_API_KEY por default
    voiceId: "EXAVITQu4vr4xnSDxMaL", // Sarah — natural, narradora calma
    modelId: "eleven_multilingual_v2",
    stability: 0.5,
    similarityBoost: 0.75,
  },

  steps: [
    { type: "navigate", url: "/" },
    { type: "wait", ms: 600 },

    {
      type: "caption",
      text: "My App · Demo",
      // El texto en pantalla es corto, la narración expandida:
      narrationText:
        "Hola, en este video te muestro cómo funciona mi aplicación de punta a punta.",
    },

    { type: "caption", text: "Primero, login con admin" },
    { type: "fill", selector: 'input[type="email"]', value: "admin@example.com" },
    { type: "fill", selector: 'input[type="password"]', value: "secret-123" },
    { type: "click", selector: 'button[type="submit"]' },
    { type: "waitForUrl", url: "http://localhost:3000/" },

    {
      type: "caption",
      text: "Ahora le pregunto al agente",
      narrationText:
        "Una vez dentro, le hago una pregunta al agente sobre métricas del negocio.",
    },
    { type: "type", selector: "textarea", value: "¿Cuántos usuarios activos tenemos?" },
    { type: "press", key: "Enter" },
    { type: "waitForAgentDone", timeoutMs: 60000 },

    {
      type: "caption",
      text: "Respuesta del agente",
      narrationText: "El agente respondió en streaming. Eso es todo, gracias por mirar.",
    },

    // Ejemplo de caption sin voz (sólo subtítulo):
    { type: "caption", text: "Fin.", mute: true, duration: 1500 },
  ],
};

export default config;

if (require.main === module || process.argv[1]?.endsWith("narrated-demo.ts")) {
  recordDemo(config).catch((err) => {
    console.error("✗", err);
    process.exit(1);
  });
}
