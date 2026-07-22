"""Config flow for pairing the companion integration with the App."""

from homeassistant import config_entries
import voluptuous as vol

from . import DOMAIN
from .api import PiAgentApiError, async_exchange_pairing_code
from .const import CONF_APP_URL, CONF_INTEGRATION_TOKEN, CONF_PAIRING_CODE


class PiAgentConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Pair one Home Assistant instance with its App."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Collect the App endpoint and pairing code in the UI."""
        if user_input is not None:
            try:
                token = await async_exchange_pairing_code(
                    self.hass, user_input[CONF_APP_URL], user_input[CONF_PAIRING_CODE]
                )
            except PiAgentApiError:
                return self.async_show_form(
                    step_id="user",
                    data_schema=vol.Schema({
                        vol.Required(CONF_APP_URL, default=user_input[CONF_APP_URL]): vol.All(str, vol.Length(min=8, max=512)),
                        vol.Required(CONF_PAIRING_CODE): vol.All(str, vol.Length(min=8, max=256)),
                    }),
                    errors={"base": "pairing_failed"},
                )
            return self.async_create_entry(
                title="Pi Agent",
                data={CONF_APP_URL: user_input[CONF_APP_URL], CONF_INTEGRATION_TOKEN: token},
            )

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_APP_URL): vol.All(str, vol.Length(min=8, max=512)),
                vol.Required(CONF_PAIRING_CODE): vol.All(str, vol.Length(min=8, max=256)),
            }),
        )
