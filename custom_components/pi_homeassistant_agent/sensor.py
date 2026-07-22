"""Status sensors for the Pi Home Assistant Agent companion integration."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity import EntityCategory
from homeassistant.helpers.update_coordinator import (
    CoordinatorEntity,
    DataUpdateCoordinator,
    UpdateFailed,
)
from homeassistant.components.sensor import SensorEntity

from .api import PiAgentApi, PiAgentApiError
from .const import DOMAIN

SCAN_INTERVAL = timedelta(seconds=30)
_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities
) -> None:
    """Create bounded status sensors for one paired App."""
    api: PiAgentApi = hass.data[DOMAIN][entry.entry_id]["api"]

    async def update() -> dict[str, Any]:
        try:
            return await api.get_status()
        except PiAgentApiError as error:
            raise UpdateFailed(str(error)) from error

    coordinator = DataUpdateCoordinator(
        hass,
        logger=_LOGGER,
        name="Pi Agent status",
        update_method=update,
        update_interval=SCAN_INTERVAL,
    )
    try:
        await coordinator.async_config_entry_first_refresh()
    except UpdateFailed:
        _LOGGER.warning("Pi Agent App is unavailable; status sensors will retry")
    hass.data[DOMAIN][entry.entry_id]["coordinator"] = coordinator
    async_add_entities(
        [
            PiAgentSensor(coordinator, entry, "connection", "Connection", "status"),
            PiAgentSensor(coordinator, entry, "agent", "Agent", "pi.healthy"),
            PiAgentSensor(coordinator, entry, "pi_version", "Pi version", "pi.version"),
            PiAgentSensor(coordinator, entry, "model", "Current model", "model"),
            PiAgentSensor(coordinator, entry, "active_sessions", "Active sessions", "activeSessions"),
            PiAgentSensor(coordinator, entry, "pending_tasks", "Pending tasks", "pendingTasks"),
            PiAgentSensor(coordinator, entry, "last_task", "Last task", "lastTask.state"),
            PiAgentSensor(coordinator, entry, "last_error", "Last error", "lastError"),
            PiAgentSensor(coordinator, entry, "update", "Update availability", "update.available"),
        ],
        update_before_add=True,
    )


class PiAgentSensor(CoordinatorEntity, SensorEntity):
    """Expose one scalar from the bounded App status payload."""

    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_should_poll = False

    def __init__(self, coordinator, entry: ConfigEntry, key: str, name: str, path: str) -> None:
        super().__init__(coordinator)
        self._path = path.split(".")
        self._attr_name = name
        self._attr_unique_id = f"{entry.entry_id}_{key}"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, entry.entry_id)},
            "name": "Pi Agent",
            "manufacturer": "Pi Home Assistant Agent",
        }
        if key in {"active_sessions", "pending_tasks"}:
            self._attr_native_unit_of_measurement = ""

    @property
    def native_value(self):
        value: Any = self.coordinator.data
        for part in self._path:
            if not isinstance(value, dict):
                return None
            value = value.get(part)
        if value is None:
            return "unknown" if self._path[-1] in {"status", "state", "version"} else None
        if isinstance(value, bool):
            return "on" if value else "off"
        return value
