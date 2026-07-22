"""Authenticated, bounded client for the App bridge."""

from __future__ import annotations

import json
from typing import Any

import async_timeout
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import MAX_RESPONSE_CHARS


class PiAgentApiError(Exception):
    """Raised when the App bridge rejects or cannot complete a request."""


class PiAgentApi:
    """Call the App's narrowly scoped companion bridge."""

    def __init__(self, hass: Any, app_url: str, pairing_code: str) -> None:
        self._hass = hass
        self._base_url = app_url.rstrip("/")
        self._pairing_code = pairing_code

    async def run_prompt(self, prompt: str, model: str | None = None) -> dict[str, Any]:
        return await self._post("/api/v1/bridge/run-prompt", {"prompt": prompt, **({"model": model} if model else {})})

    async def start_task(self, prompt: str, model: str | None = None) -> dict[str, Any]:
        return await self._post("/api/v1/bridge/tasks", {"prompt": prompt, **({"model": model} if model else {})})

    async def cancel_task(self, task_id: str) -> dict[str, Any]:
        return await self._post(f"/api/v1/bridge/tasks/{task_id}/cancel", {})

    async def approve_task(self, task_id: str) -> dict[str, Any]:
        return await self._post(f"/api/v1/bridge/tasks/{task_id}/approve", {})

    async def reject_task(self, task_id: str) -> dict[str, Any]:
        return await self._post(f"/api/v1/bridge/tasks/{task_id}/reject", {})

    async def reload_domain(self, domain: str) -> dict[str, Any]:
        return await self._post("/api/v1/bridge/reload-domain", {"domain": domain})

    async def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = async_get_clientsession(self._hass)
        try:
            async with async_timeout.timeout(20):
                async with session.post(
                    f"{self._base_url}{path}",
                    json=payload,
                    headers={"X-Pi-Pairing-Code": self._pairing_code},
                ) as response:
                    body = await response.text()
                    if len(body) > MAX_RESPONSE_CHARS:
                        raise PiAgentApiError("App response exceeded the configured size limit")
                    if response.status >= 400:
                        raise PiAgentApiError(f"App bridge rejected request ({response.status})")
                    try:
                        value = json.loads(body) if body else {}
                    except json.JSONDecodeError as error:
                        raise PiAgentApiError("App bridge returned invalid JSON") from error
                    if not isinstance(value, dict):
                        raise PiAgentApiError("App bridge response must be an object")
                    return value
        except PiAgentApiError:
            raise
        except Exception as error:
            raise PiAgentApiError("Unable to reach Pi Agent App") from error
