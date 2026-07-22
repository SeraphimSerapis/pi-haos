"""Companion integration placeholder for the Pi Home Assistant Agent."""

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

DOMAIN = "pi_homeassistant_agent"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up the integration entry."""
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = entry.data
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload the integration entry."""
    hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    return True
