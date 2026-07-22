const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing app root');

root.innerHTML = `
  <style>
    :root { color-scheme: light dark; font: 16px system-ui, sans-serif; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 960px; margin: 0 auto; padding: 2rem; }
    nav { display: flex; gap: .5rem; flex-wrap: wrap; margin: 1.5rem 0; }
    button { padding: .55rem .8rem; border: 1px solid #888; border-radius: .35rem; background: transparent; color: inherit; }
    .card { border: 1px solid #8885; border-radius: .5rem; padding: 1rem; }
    code { font-family: ui-monospace, monospace; }
  </style>
  <h1>Pi Agent</h1>
  <p>Safe Home Assistant assistance, staged by default.</p>
  <nav>${['Chat', 'Changes', 'Tasks', 'Skills', 'Models', 'Settings'].map((item) => `<button type="button">${item}</button>`).join('')}</nav>
  <section class="card" aria-live="polite"><strong>Foundation status</strong><p id="status">Checking backend…</p></section>
`;

const status = document.querySelector<HTMLElement>('#status');
fetch(`${import.meta.env.BASE_URL}api/v1/status`)
  .then(async (response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<{
      appVersion: string;
      homeAssistantMount: string;
      integration: string;
    }>;
  })
  .then((value) => {
    if (status)
      status.innerHTML = `App <code>${value.appVersion}</code>; config mount <code>${value.homeAssistantMount}</code>; integration <code>${value.integration}</code>.`;
  })
  .catch(() => {
    if (status) status.textContent = 'Backend unavailable. Check the App logs.';
  });
