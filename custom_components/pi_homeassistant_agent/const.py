"""Constants for the Pi Agent companion integration."""

DOMAIN = "pi_homeassistant_agent"
CONF_APP_URL = "app_url"
CONF_PAIRING_CODE = "pairing_code"
CONF_INTEGRATION_TOKEN = "integration_token"
MAX_RESPONSE_CHARS = 16_384

SERVICE_RUN_PROMPT = "run_prompt"
SERVICE_START_TASK = "start_task"
SERVICE_CANCEL_TASK = "cancel_task"
SERVICE_APPROVE_TASK = "approve_task"
SERVICE_REJECT_TASK = "reject_task"
SERVICE_RELOAD_DOMAIN = "reload_domain"

EVENT_TASK_UPDATED = f"{DOMAIN}_task_updated"
