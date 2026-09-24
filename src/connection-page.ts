/** The local editor callback's final state, shown after the token exchange. */
export function renderConnectionPage(connected: boolean): string {
  const title = connected ? 'Connected' : 'Connection failed';
  const icon = connected
    ? '<path d="m6 12 4 4 8-8" pathLength="1"/>'
    : '<path d="M12 8v4m0 4h.01"/><circle cx="12" cy="12" r="9"/>';
  const sparks = connected ? [
    [-34, -30, -35, 280], [0, -44, 20, 320], [36, -28, 55, 300],
    [43, 9, 110, 340], [24, 37, -45, 310], [-39, 24, 75, 330],
  ].map(([x, y, turn, delay]) => `<span class="status__spark" aria-hidden="true" style="--x:${x}px;--y:${y}px;--turn:${turn}deg;--delay:${delay}ms"></span>`).join('') : '';

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
    .status { position: relative; display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; margin: 0 auto 20px; border: 1px solid ${connected ? '#bbf7d0' : '#fecaca'}; border-radius: 50%; background: ${connected ? '#f0fdf4' : '#fef2f2'}; color: ${connected ? '#15803d' : '#b91c1c'}; }
    .status--connected { animation: success-pop 780ms cubic-bezier(.22,1,.36,1) both; }
    .status--connected::after { content: ''; position: absolute; inset: -1px; border: 1px solid #86efac; border-radius: inherit; opacity: 0; pointer-events: none; animation: success-ring 550ms cubic-bezier(.16,1,.3,1) 330ms both; }
    .status__check { position: relative; z-index: 1; animation: checkmark-enter 420ms cubic-bezier(.25,1,.5,1) 120ms both; }
    .status__check path { stroke-dasharray: 1; stroke-dashoffset: 0; animation: checkmark-draw 460ms cubic-bezier(.65,0,.35,1) 140ms both; }
    .status__spark { position: absolute; top: 50%; left: 50%; width: 5px; height: 9px; margin: -4.5px 0 0 -2.5px; border-radius: 2px; background: #22c55e; opacity: 0; pointer-events: none; animation: success-spark 600ms cubic-bezier(.16,1,.3,1) var(--delay) both; }
    .status__spark:nth-of-type(even) { width: 6px; height: 6px; margin: -3px 0 0 -3px; border-radius: 50%; background: #4ade80; }
    @keyframes success-pop {
      0% { transform: scale(.65) rotate(-14deg); }
      42% { transform: scale(1.15) rotate(5deg); }
      65% { transform: scale(.96) rotate(-2deg); }
      82% { transform: scale(1.04) rotate(1deg); }
      100% { transform: scale(1) rotate(0); }
    }
    @keyframes checkmark-enter {
      from { opacity: 0; transform: scale(.6); }
      to { opacity: 1; transform: scale(1); }
    }
    @keyframes checkmark-draw {
      from { stroke-dashoffset: 1; }
      to { stroke-dashoffset: 0; }
    }
    @keyframes success-ring {
      0% { opacity: 0; transform: scale(1); }
      15% { opacity: .65; }
      100% { opacity: 0; transform: scale(1.9); }
    }
    @keyframes success-spark {
      0% { opacity: 0; transform: translate(0,0) rotate(0) scale(.3); }
      20% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--x),var(--y)) rotate(var(--turn)) scale(.7); }
    }
    @media (prefers-reduced-motion: reduce) {
      .status--connected, .status--connected::after, .status__check, .status__check path, .status__spark { animation: none; }
    }
    h1 { margin: 0 0 8px; font-size: 20px; line-height: 1.3; font-weight: 700; color: #09090b; }
    p { margin: 0; font-size: 14px; line-height: 1.5; color: #4b5563; }
    .next-step { margin-top: 16px; }
  </style>
</head>
<body>
  <main aria-labelledby="result-title">
    <div class="status${connected ? ' status--connected' : ''}">
      <svg${connected ? ' class="status__check"' : ''} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
      ${sparks}
    </div>
    <h1 id="result-title">${title}</h1>
    <p>${connected ? 'Your editor is now connected to OverlayQA.' : 'Something went wrong while connecting your editor.'}</p>
    <p class="next-step">${connected ? 'You can close this tab and return to your editor.' : 'Restart the MCP server in your editor to try again.'}</p>
  </main>
</body>
</html>`;
}
