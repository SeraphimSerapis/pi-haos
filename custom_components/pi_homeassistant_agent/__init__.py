"""Companion integration for the Pi Home Assistant Agent."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
import voluptuous as vol

from .api import PiAgentApi
from .transaction_apply import apply_approved_transaction
from .const import (
    CONF_APP_URL,
    CONF_INTEGRATION_TOKEN,
    DOMAIN,
    EVENT_TASK_UPDATED,
    SERVICE_APPROVE_TASK,
    SERVICE_APPLY_TRANSACTION,
    SERVICE_CANCEL_TASK,
    SERVICE_REJECT_TASK,
    SERVICE_RELOAD_DOMAIN,
    SERVICE_RUN_PROMPT,
    SERVICE_START_TASK,
)

SERVICE_SCHEMAS = {
    SERVICE_RUN_PROMPT: vol.Schema({vol.Required("prompt"): vol.All(str, vol.Length(min=1, max=8192)), vol.Optional("model"): str}),
    SERVICE_START_TASK: vol.Schema({vol.Required("prompt"): vol.All(str, vol.Length(min=1, max=8192)), vol.Optional("model"): str}),
    SERVICE_CANCEL_TASK: vol.Schema({vol.Required("task_id"): vol.All(str, vol.Length(min=1, max=128))}),
    SERVICE_APPROVE_TASK: vol.Schema({vol.Required("task_id"): vol.All(str, vol.Length(min=1, max=128))}),
    SERVICE_REJECT_TASK: vol.Schema({vol.Required("task_id"): vol.All(str, vol.Length(min=1, max=128))}),
    SERVICE_RELOAD_DOMAIN: vol.Schema({vol.Required("domain"): vol.All(str, vol.Length(min=1, max=64))}),
    SERVICE_APPLY_TRANSACTION: vol.Schema({vol.Required("transaction_id"): vol.All(str, vol.Length(min=1, max=128))}),
}


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the integration entry and register bounded bridge services."""
    api = PiAgentApi(hass, entry.data[CONF_APP_URL], entry.data[CONF_INTEGRATION_TOKEN])
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {"api": api}

    if not hass.services.has_service(DOMAIN, SERVICE_RUN_PROMPT):
        async def handle_service(call) -> None:
            configured = next(iter(hass.data[DOMAIN].values()))
            service = call.service
            payload = dict(call.data)
            if service == SERVICE_RUN_PROMPT:
                result = await configured["api"].run_prompt(payload["prompt"], payload.get("model"))
            elif service == SERVICE_START_TASK:
                result = await configured["api"].start_task(payload["prompt"], payload.get("model"))
            elif service == SERVICE_CANCEL_TASK:
                result = await configured["api"].cancel_task(payload["task_id"])
            elif service == SERVICE_APPROVE_TASK:
                result = await configured["api"].approve_task(payload["task_id"])
            elif service == SERVICE_REJECT_TASK:
                result = await configured["api"].reject_task(payload["task_id"])
            elif service == SERVICE_APPLY_TRANSACTION:
                transaction = await configured["api"].get_transaction(payload["transaction_id"])
                result = await hass.async_add_executor_job(
                    apply_approved_transaction, hass.config.path(), transaction
                )
            elif service == SERVICE_RELOAD_DOMAIN:
                result = await configured["api"].reload_domain(payload["domain"])
            else:
                result = {"status": "unsupported"}
            hass.bus.async_fire(EVENT_TASK_UPDATED, {"service": service, **result})

        for service_name, schema in SERVICE_SCHEMAS.items():
            hass.services.async_register(DOMAIN, service_name, handle_service, schema=schema)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the integration entry."""
    data = hass.data.get(DOMAIN, {})
    data.pop(entry.entry_id, None)
    if not data:
        for service_name in SERVICE_SCHEMAS:
            hass.services.async_remove(DOMAIN, service_name)
    return True
