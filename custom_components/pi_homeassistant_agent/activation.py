"""Explicit, allowlisted Home Assistant activation actions."""

from __future__ import annotations

from typing import TypedDict


class Activation(TypedDict):
    domain: str
    service: str


ALLOWED_ACTIVATIONS: dict[str, Activation] = {
    "automation": {"domain": "automation", "service": "reload"},
    "script": {"domain": "script", "service": "reload"},
    "scene": {"domain": "scene", "service": "reload"},
    "template": {"domain": "template", "service": "reload"},
    "homeassistant_restart": {"domain": "homeassistant", "service": "restart"},
}


def resolve_activation(domain: str) -> Activation:
    """Resolve a user-requested action; never accept arbitrary service names."""
    try:
        return ALLOWED_ACTIVATIONS[domain]
    except KeyError as error:
        raise ValueError(f"Activation is not allowed: {domain}") from error
