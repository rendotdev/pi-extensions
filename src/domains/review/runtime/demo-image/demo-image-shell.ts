import type { DemoImageTheme } from "./demo-image.ts";

const demoImageShellTemplate = `<!doctype html>
<html lang="en" data-theme="__THEME__">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>lgtm review preview</title>
    <style>
      :root {
        color-scheme: light;
        --canvas: #08090a;
        --floor: #d0d6e0;
        --floor-shade: rgba(8, 9, 10, 0.5);
        --shell: #ffffff;
        --toolbar: rgba(248, 248, 249, 0.96);
        --border: rgba(31, 29, 39, 0.14);
        --divider: rgba(31, 29, 39, 0.1);
        --address: rgba(31, 29, 39, 0.055);
        --address-border: rgba(31, 29, 39, 0.08);
        --address-text: rgba(31, 29, 39, 0.58);
        --shadow: 0 38px 100px rgba(30, 25, 50, 0.2), 0 8px 28px rgba(30, 25, 50, 0.12);
      }

      :root[data-theme="dark"] {
        color-scheme: dark;
        --shell: #111214;
        --toolbar: rgba(21, 22, 24, 0.97);
        --border: rgba(255, 255, 255, 0.14);
        --divider: rgba(255, 255, 255, 0.09);
        --address: rgba(255, 255, 255, 0.055);
        --address-border: rgba(255, 255, 255, 0.075);
        --address-text: rgba(255, 255, 255, 0.52);
        --shadow: 0 42px 110px rgba(0, 0, 0, 0.56), 0 10px 34px rgba(0, 0, 0, 0.38);
      }

      * {
        box-sizing: border-box;
      }

      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
      }

      body {
        position: relative;
        display: grid;
        place-items: center;
        background: var(--canvas);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      body::before {
        position: absolute;
        top: 52.7%;
        right: 0;
        left: 0;
        height: 83.2%;
        background:
          radial-gradient(
            52.53% 57.5% at 50% 100%,
            transparent 0%,
            var(--floor-shade) 100%
          ),
          linear-gradient(var(--canvas) 10%, var(--floor) 100%);
        content: "";
        pointer-events: none;
      }

      .browser {
        position: relative;
        z-index: 1;
        width: min(1280px, calc(100vw - 160px));
        height: calc(100vh - 288px);
        overflow: hidden;
        border: 1px solid var(--border);
        border-radius: 18px;
        background: var(--shell);
        box-shadow: var(--shadow);
        transform: translateY(-48px);
      }

      .browser::before {
        position: absolute;
        inset: 0;
        z-index: 2;
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: inherit;
        content: "";
        pointer-events: none;
      }

      .toolbar {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: 1fr minmax(320px, 560px) 1fr;
        align-items: center;
        height: 52px;
        padding: 0 18px;
        border-bottom: 1px solid var(--divider);
        background: var(--toolbar);
        backdrop-filter: blur(18px);
      }

      .traffic-lights {
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .traffic-light {
        width: 12px;
        height: 12px;
        border: 0.5px solid rgba(0, 0, 0, 0.12);
        border-radius: 999px;
        box-shadow: inset 0 0.5px 0 rgba(255, 255, 255, 0.45);
      }

      .traffic-light.close {
        background: #ff5f57;
      }

      .traffic-light.minimize {
        background: #febc2e;
      }

      .traffic-light.maximize {
        background: #28c840;
      }

      .address {
        display: flex;
        gap: 8px;
        align-items: center;
        justify-content: center;
        height: 30px;
        border: 1px solid var(--address-border);
        border-radius: 8px;
        background: var(--address);
        color: var(--address-text);
        font-size: 12px;
        font-weight: 500;
        letter-spacing: 0.01em;
      }

      .address svg {
        width: 11px;
        height: 11px;
        opacity: 0.72;
      }

      .review {
        display: block;
        width: 100%;
        height: calc(100% - 52px);
        border: 0;
        background: var(--shell);
      }
    </style>
  </head>
  <body>
    <main class="browser" aria-label="macOS browser preview">
      <header class="toolbar">
        <div class="traffic-lights" aria-hidden="true">
          <span class="traffic-light close"></span>
          <span class="traffic-light minimize"></span>
          <span class="traffic-light maximize"></span>
        </div>
        <div class="address">
          <svg aria-hidden="true" viewBox="0 0 16 16" fill="none">
            <path d="M4.75 7V5.25a3.25 3.25 0 0 1 6.5 0V7M3.5 7h9v6.5h-9V7Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span>lgtm review</span>
        </div>
        <div></div>
      </header>
      <iframe class="review" title="lgtm review" src="__URL__"></iframe>
    </main>
  </body>
</html>`;

export function createDemoImageShellMarkup(params: { theme: DemoImageTheme; url: string }): string {
  const escapedUrl = params.url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return demoImageShellTemplate.replace("__THEME__", params.theme).replace("__URL__", escapedUrl);
}
