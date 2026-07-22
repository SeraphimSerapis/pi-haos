const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing app root');

root.innerHTML = `
  <style>
    :root { color-scheme: light dark; font: 15px system-ui, sans-serif; --accent: #7c5cff; }
    body { margin: 0; background: Canvas; color: CanvasText; }
    main { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    nav { display: flex; gap: .4rem; flex-wrap: wrap; margin: 1.5rem 0; border-bottom: 1px solid #8885; padding-bottom: .8rem; }
    button { padding: .55rem .8rem; border: 1px solid #8888; border-radius: .35rem; background: transparent; color: inherit; cursor: pointer; }
    button[aria-selected="true"], button[type="submit"] { background: var(--accent); border-color: var(--accent); color: white; }
    .card { border: 1px solid #8885; border-radius: .5rem; padding: 1rem; margin: 1rem 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; }
    label { display: grid; gap: .35rem; margin: .7rem 0; }
    input, select, textarea { padding: .55rem; border: 1px solid #8888; border-radius: .35rem; background: Canvas; color: inherit; font: inherit; }
    .muted { opacity: .72; }
    code { font-family: ui-monospace, monospace; }
  </style>
  <h1>Pi Agent</h1>
  <p>Safe Home Assistant assistance, staged by default.</p>
  <nav id="navigation" aria-label="Pi Agent sections">${['Chat', 'Changes', 'Tasks', 'Skills', 'Models', 'Settings'].map((item, index) => `<button type="button" data-section="${item.toLowerCase()}" aria-selected="${index === 0}">${item}</button>`).join('')}</nav>
  <section id="content" aria-live="polite"></section>
`;

const base = import.meta.env.BASE_URL;
const content = document.querySelector<HTMLElement>('#content');
const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ] ?? character,
  );

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}api/v1${path}`, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

function renderSection(section: string): void {
  if (!content) return;
  if (section === 'models') {
    void renderModels();
    return;
  }
  if (section === 'skills') {
    void renderSkills();
    return;
  }
  if (section === 'changes' || section === 'tasks') {
    void renderTransactions(section);
    return;
  }
  content.innerHTML = `<section class="card"><h2>${escapeHtml(section[0]?.toUpperCase() + section.slice(1))}</h2><p class="muted">This section is scaffolded for the staged, auditable workflow.</p></section>`;
  if (section === 'chat') void renderChat();
}

async function renderStatus(): Promise<void> {
  if (!content) return;
  try {
    const value = await api<{
      appVersion: string;
      homeAssistantMount: string;
      integration: string;
    }>('/status');
    content.innerHTML = `<section class="card"><strong>Foundation status</strong><p>App <code>${escapeHtml(value.appVersion)}</code>; config mount <code>${escapeHtml(value.homeAssistantMount)}</code>; integration <code>${escapeHtml(value.integration)}</code>.</p></section>`;
  } catch {
    content.innerHTML =
      '<section class="card"><p>Backend unavailable. Check the App logs.</p></section>';
  }
}

let chatSessionId: string | null = null;

async function renderChat(): Promise<void> {
  if (!content) return;
  content.innerHTML = `<section class="card"><h2>Chat</h2><p class="muted">Pi works in an isolated workspace. Configuration changes remain staged for review.</p><form id="chat-form"><label>Message<textarea name="message" rows="5" required maxlength="8192" placeholder="Ask Pi to inspect your Home Assistant instance…"></textarea></label><button type="submit">Send</button></form><pre id="chat-output" class="card" aria-live="polite"></pre></section>`;
  document
    .querySelector<HTMLFormElement>('#chat-form')
    ?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget as HTMLFormElement);
      const message = String(form.get('message') ?? '').trim();
      const output = document.querySelector<HTMLElement>('#chat-output');
      if (!message || !output) return;
      output.textContent = 'Pi is thinking…';
      try {
        if (!chatSessionId) {
          const session = await api<{ id: string }>('/chat/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          });
          chatSessionId = session.id;
        }
        const result = await api<{
          events: Array<{
            type: string;
            delta?: string;
            status?: string;
            toolName?: string;
            message?: string;
          }>;
        }>(`/chat/sessions/${encodeURIComponent(chatSessionId)}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        output.textContent = result.events
          .map((event) =>
            event.type === 'text_delta'
              ? event.delta
              : event.type === 'tool_start'
                ? `[tool: ${event.toolName ?? 'unknown'}]`
                : event.type === 'error'
                  ? event.message
                  : '',
          )
          .join('');
        (event.currentTarget as HTMLFormElement).reset();
      } catch {
        output.textContent =
          'Pi could not complete the request. Check the App logs and model configuration.';
      }
    });
}

async function renderModels(): Promise<void> {
  if (!content) return;
  content.innerHTML =
    '<section class="card"><p>Loading model providers…</p></section>';
  try {
    const providers = await api<
      Array<{
        id: string;
        name: string;
        kind: string;
        endpoint: string;
        models: string[];
        hasApiKey: boolean;
        enabled: boolean;
      }>
    >('/models/providers');
    content.innerHTML = `<section class="grid">${providers.length ? providers.map((provider) => `<article class="card"><h2>${escapeHtml(provider.name)}</h2><p class="muted">${escapeHtml(provider.kind)} · ${escapeHtml(provider.endpoint)}</p><p>${provider.models.map(escapeHtml).join(', ')}</p><p>${provider.hasApiKey ? 'API key saved' : 'No API key'} · ${provider.enabled ? 'Enabled' : 'Disabled'}</p></article>`).join('') : '<article class="card"><p>No providers configured yet.</p></article>'}</section>
      <section class="card"><h2>Add provider</h2><form id="provider-form"><div class="grid"><label>Provider ID<input name="id" required pattern="[A-Za-z0-9_-]+" placeholder="openai" /></label><label>Name<input name="name" required placeholder="OpenAI" /></label><label>Type<select name="kind"><option value="openai">OpenAI</option><option value="openai-compatible">OpenAI-compatible</option><option value="local">Local</option></select></label><label>Endpoint<input name="endpoint" type="url" required value="https://api.openai.com/v1" /></label><label>Models (comma-separated)<input name="models" required placeholder="gpt-4.1" /></label><label>API key<input name="apiKey" type="password" autocomplete="new-password" /></label></div><button type="submit">Save provider</button><p id="provider-result" class="muted"></p></form></section>`;
    document
      .querySelector<HTMLFormElement>('#provider-form')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const id = String(form.get('id'));
        const result = document.querySelector<HTMLElement>('#provider-result');
        try {
          await api(`/models/providers/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              id,
              name: form.get('name'),
              kind: form.get('kind'),
              endpoint: form.get('endpoint'),
              models: String(form.get('models')).split(','),
              ...(form.get('apiKey') ? { apiKey: form.get('apiKey') } : {}),
            }),
          });
          await renderModels();
        } catch {
          if (result) result.textContent = 'Provider could not be saved.';
        }
      });
  } catch {
    content.innerHTML =
      '<section class="card"><p>Could not load model providers.</p></section>';
  }
}

async function renderSkills(): Promise<void> {
  if (!content) return;
  content.innerHTML = '<section class="card"><p>Loading skills…</p></section>';
  try {
    const skills = await api<
      Array<{
        manifest: {
          id: string;
          name: string;
          version: string;
          description: string;
          source: string;
          enabled: boolean;
          permissions: string[];
        };
        content: string;
      }>
    >('/skills');
    content.innerHTML = `<section class="grid">${skills.length ? skills.map(({ manifest }) => `<article class="card"><h2>${escapeHtml(manifest.name)}</h2><p class="muted"><code>${escapeHtml(manifest.id)}</code> · v${escapeHtml(manifest.version)} · ${escapeHtml(manifest.source)}</p><p>${escapeHtml(manifest.description)}</p><p>Permissions: ${manifest.permissions.map(escapeHtml).join(', ') || 'none'}</p><button type="button" data-skill-source="${escapeHtml(manifest.source)}" data-skill-id="${escapeHtml(manifest.id)}" data-skill-enabled="${!manifest.enabled}">${manifest.enabled ? 'Disable' : 'Enable'}</button></article>`).join('') : '<article class="card"><p>No skills installed.</p></article>'}</section>`;
    document
      .querySelectorAll<HTMLButtonElement>('[data-skill-id]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          await api(
            `/skills/${encodeURIComponent(button.dataset.skillSource ?? '')}/${encodeURIComponent(button.dataset.skillId ?? '')}/enabled`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                enabled: button.dataset.skillEnabled === 'true',
              }),
            },
          );
          await renderSkills();
        }),
      );
  } catch {
    content.innerHTML =
      '<section class="card"><p>Could not load skills.</p></section>';
  }
}

async function renderTransactions(section: string): Promise<void> {
  if (!content) return;
  if (section === 'tasks') {
    await renderTasks();
    return;
  }
  content.innerHTML =
    '<section class="card"><p>Loading transaction history…</p></section>';
  try {
    const transactions = await api<
      Array<{
        id: string;
        state: string;
        diffHash: string;
        files: Array<{ path: string; content: string }>;
        validation: { status: string; errors: string[] };
        createdAt: string;
        approvedAt: string;
      }>
    >('/transactions');
    if (!transactions.length) {
      content.innerHTML = `<section class="card"><h2>${escapeHtml(section[0]?.toUpperCase() + section.slice(1))}</h2><p class="muted">No staged transactions are available.</p></section>`;
      return;
    }
    content.innerHTML = `<section class="grid">${transactions.map((transaction) => `<article class="card"><h2><code>${escapeHtml(transaction.id)}</code></h2><p>${escapeHtml(transaction.state)} · validation: ${escapeHtml(transaction.validation.status)}</p><p class="muted">${escapeHtml(transaction.files.map((file) => file.path).join(', '))}</p><details><summary>Diff hash</summary><code>${escapeHtml(transaction.diffHash)}</code></details>${transaction.validation.errors.length ? `<pre>${escapeHtml(transaction.validation.errors.join('\\n'))}</pre>` : ''}${transaction.state === 'awaiting_review' ? `<button type="button" data-transaction-validate="${escapeHtml(transaction.id)}">Validate YAML</button> ${transaction.validation.status === 'passed' ? `<button type="button" data-transaction-approve="${escapeHtml(transaction.id)}">Approve all files</button>` : ''}` : ''}</article>`).join('')}</section>`;
    document
      .querySelectorAll<HTMLButtonElement>('[data-transaction-approve]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          await api(
            `/transactions/${encodeURIComponent(button.dataset.transactionApprove ?? '')}/approve`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: '{}',
            },
          );
          await renderTransactions('changes');
        }),
      );
    document
      .querySelectorAll<HTMLButtonElement>('[data-transaction-validate]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          await api(
            `/transactions/${encodeURIComponent(button.dataset.transactionValidate ?? '')}/validate`,
            { method: 'POST' },
          );
          await renderTransactions('changes');
        }),
      );
  } catch {
    content.innerHTML =
      '<section class="card"><p>Could not load transaction history.</p></section>';
  }
}

async function renderTasks(): Promise<void> {
  if (!content) return;
  content.innerHTML = '<section class="card"><p>Loading tasks…</p></section>';
  try {
    const tasks = await api<
      Array<{
        id: string;
        prompt: string;
        initiator: string;
        state: string;
        model: string | null;
        skills: string[];
        createdAt: string;
        error: string | null;
      }>
    >('/tasks');
    content.innerHTML = `<section class="card"><h2>Start staged task</h2><form id="task-form"><label>Prompt<textarea name="prompt" rows="4" required maxlength="8192" placeholder="Ask Pi to propose a safe configuration change…"></textarea></label><button type="submit">Create task</button><p id="task-result" class="muted"></p></form></section><section class="grid">${tasks.length ? tasks.map((task) => `<article class="card"><h2><code>${escapeHtml(task.id.slice(0, 8))}</code></h2><p>${escapeHtml(task.state)} · ${escapeHtml(task.initiator)}</p><p>${escapeHtml(task.prompt)}</p><p class="muted">${escapeHtml(task.model ?? 'default model')} · ${escapeHtml(task.skills.join(', ') || 'no skills')}</p>${task.error ? `<pre>${escapeHtml(task.error)}</pre>` : ''}${task.state === 'created' ? `<button type="button" data-task-run="${escapeHtml(task.id)}">Run in staging</button>` : ''}${task.state === 'awaiting_review' ? '<p class="muted">Review and approve the generated transaction in Changes.</p>' : ''}</article>`).join('') : '<article class="card"><p class="muted">No tasks recorded.</p></article>'}</section>`;
    document
      .querySelector<HTMLFormElement>('#task-form')
      ?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget as HTMLFormElement);
        const result = document.querySelector<HTMLElement>('#task-result');
        try {
          await api('/tasks', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              prompt: form.get('prompt'),
              initiator: 'frontend',
            }),
          });
          await renderTasks();
        } catch {
          if (result) result.textContent = 'Task could not be created.';
        }
      });
    document
      .querySelectorAll<HTMLButtonElement>('[data-task-action]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          await api(
            `/tasks/${encodeURIComponent(button.dataset.taskId ?? '')}/${button.dataset.taskAction}`,
            { method: 'POST' },
          );
          await renderTasks();
        }),
      );
    document
      .querySelectorAll<HTMLButtonElement>('[data-task-run]')
      .forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          await api(
            `/tasks/${encodeURIComponent(button.dataset.taskRun ?? '')}/run`,
            { method: 'POST' },
          );
          await renderTasks();
        }),
      );
  } catch {
    content.innerHTML =
      '<section class="card"><p>Could not load tasks.</p></section>';
  }
}

document
  .querySelectorAll<HTMLButtonElement>('[data-section]')
  .forEach((button) =>
    button.addEventListener('click', () => {
      document
        .querySelectorAll('[data-section]')
        .forEach((item) =>
          item.setAttribute('aria-selected', String(item === button)),
        );
      renderSection(button.dataset.section ?? 'chat');
    }),
  );
renderSection('chat');
