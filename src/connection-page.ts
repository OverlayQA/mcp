/** The local editor callback's final state, shown after the token exchange. */
export function renderConnectionPage(connected: boolean): string {
  const title = connected ? 'Connected' : 'Connection failed';
  const icon = connected
    ? '<path d="m6 12 4 4 8-8"/>'
    : '<path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/>';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>OverlayQA — ${title}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; min-height: 100svh; display: flex; align-items: center; justify-content: center; padding: 24px; background: linear-gradient(135deg,#1e3a8a 0%,#3468f8 100%); font-family: system-ui,-apple-system,sans-serif; }
    main { width: 100%; max-width: 460px; padding: 40px 24px; border-radius: 16px; background: #fff; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,.12); }
    .status { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0 auto 20px; border-radius: 50%; background: ${connected ? '#f0fdf4' : '#fef2f2'}; color: ${connected ? '#15803d' : '#b91c1c'}; }
    h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; font-weight: 700; color: #09090b; }
    p { margin: 0; font-size: 14px; line-height: 1.5; color: #4b5563; }
    .next-step { margin-top: 16px; }
  </style>
</head>
<body>
  <main aria-labelledby="result-title">
    <div class="status">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
    </div>
    <h1 id="result-title">${title}</h1>
    <p>${connected ? 'Your editor is now connected to OverlayQA.' : 'Something went wrong while connecting your editor.'}</p>
    <p class="next-step">${connected ? 'You can close this tab and return to your editor.' : 'Restart the MCP server in your editor to try again.'}</p>
  </main>
</body>
</html>`;
}
