"""Config flow for pairing the companion integration with the App."""

from homeassistant import config_entries
import voluptuous as vol

from . import DOMAIN


class PiAgentConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Pair one Home Assistant instance with its App."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        """Collect the App endpoint and pairing code in the UI."""
        if user_input is not None:
            return self.async_create_entry(title="Pi Agent", data=user_input)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required("app_url"): str,
                vol.Required("pairing_code"): str,
            }),
        )
