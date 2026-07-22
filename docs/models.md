# Model catalogue

Providers are configured in the Ingress Models view and persisted under
`/data/models.json`. API keys are stored only in the App data directory and
are never returned by the public provider API; the UI displays only whether a
key exists.

Each provider has an explicit endpoint, type, and bounded model list. Chat and
staged Tasks expose enabled provider models as per-request choices. The
optional interactive and automation defaults are persisted separately in
`/data/model-settings.json` and are used only when a request does not specify a
model.

The backend passes selections to Pi as typed `{ provider, modelId }` values.
The model is not a permission boundary: tools and mutations remain controlled
by the backend capability policy and transaction approval flow.
