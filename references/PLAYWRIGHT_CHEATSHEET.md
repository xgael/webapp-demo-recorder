# Playwright cheatsheet (selectors útiles para demos)

Referencia rápida de selectores y patterns que aparecen seguido al armar demos.

## Selectores que casi siempre funcionan

| Selector | Caso de uso |
|---|---|
| `input[type="email"]` | Form de login |
| `input[type="password"]` | Form de login |
| `button[type="submit"]` | Botón enviar form |
| `textarea` | Chat principal de un agente |
| `button[aria-label*="X"]` | Botón con aria-label que contiene "X" |
| `button:has-text("Login")` | Botón con texto exacto/parcial |
| `a:has-text("Ver más")` | Link con texto |
| `div.bg-emerald-50` | Toast/badge de éxito (Tailwind verde) |
| `[data-testid="xyz"]` | El más recomendado si la app los expone |

## Esperas

```ts
// Network idle (cuando lo necesites para SSR/RSC)
await page.waitForLoadState("networkidle");

// URL específica (relativa o regex)
await page.waitForURL("http://localhost:3000/", { timeout: 15000 });
await page.waitForURL(/\/dashboard$/);

// Selector aparece en DOM
await page.waitForSelector(".chart", { timeout: 30000 });

// Función custom (¡cuidado con el bug de signature!)
await page.waitForFunction(
  () => document.querySelector("textarea")?.disabled === false,
  undefined,   // ← el segundo arg POSICIONAL es `arg`, no `options`
  { timeout: 90000 },   // ← options va de tercero
);
```

## Inyección de scripts en runtime

`page.evaluate(fn, arg)` corre `fn` dentro del browser. Útil para:

- Captions overlay (esta skill ya lo hace)
- Scroll programático
- Lectura de localStorage
- Animaciones custom

```ts
await page.evaluate(() => {
  const stored = JSON.parse(localStorage.getItem("mi-app:state") ?? "{}");
  return stored.userId;
});
```

## Click + navigate

Si el click dispara una navegación, mejor:
```ts
await Promise.all([
  page.waitForNavigation(),
  page.click("a.next"),
]);
```

O capturar el href del `<a>` y `page.goto()` directo (lo que hace `clickLink` de esta skill).

## File uploads

```ts
await page.setInputFiles('input[type="file"]', "/path/to/file.png");
```

## Drag & drop

```ts
await page.dragAndDrop("#source", "#target");
```

## Screenshots durante el demo

Si quieres un screenshot a la mitad del demo (no solo el video):

```ts
await page.screenshot({ path: "/tmp/midway.png", fullPage: true });
```

## Browser context options útiles

```ts
{
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,                        // Retina
  recordVideo: { dir: "videos/", size: viewport },
  recordHar: { path: "har.json" },             // network log
  userAgent: "Custom",
  locale: "es-MX",
  timezoneId: "America/Mexico_City",
  geolocation: { latitude: 19.43, longitude: -99.13 },
  permissions: ["geolocation"],
  ignoreHTTPSErrors: true,                     // self-signed certs
  storageState: "auth.json",                   // session pre-logged-in
}
```

## Conservar sesión entre runs (skip login en cada demo)

```ts
// 1. Una vez, hacer login y guardar storageState:
const context = await browser.newContext();
const page = await context.newPage();
await page.goto("https://app.com/login");
// ... fill, click ...
await context.storageState({ path: "auth.json" });

// 2. En los demos siguientes:
const context = await browser.newContext({ storageState: "auth.json" });
// ya estás logueado al abrir cualquier página
```

## Debugging

```ts
// Headed mode (ver el navegador en vivo) — útil cuando algo no funciona
const browser = await chromium.launch({ headless: false, slowMo: 500 });

// Pausa en cualquier punto (inspeccionar DOM)
await page.pause();

// Inspector visual
PWDEBUG=1 pnpm tsx tu-demo.ts
```

## Performance tips

- `deviceScaleFactor: 1` si no necesitas Retina (acelera 4x el render)
- Mantén `viewport` chico (1280×720 vs 1920×1080) — el WEBM crece cuadráticamente
- `crf: 28` en ffmpeg para videos más livianos (peor calidad pero acceptable)
- Si el demo es muy largo (>5 min), considera grabar en partes y concatenar:
  ```bash
  ffmpeg -i "concat:part1.mp4|part2.mp4" -c copy out.mp4
  ```
