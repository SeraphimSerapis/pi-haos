"""Apply approved transaction manifests safely inside Home Assistant."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any, Callable


DENIED_FILES = {"secrets.yaml", ".HA_VERSION"}
DENIED_DIRECTORIES = {".storage", ".cloud"}
DENIED_SUFFIXES = (".db", ".db-shm", ".db-wal", ".log")


class TransactionApplyError(Exception):
    """Raised when an approved transaction cannot be applied safely."""


def apply_approved_transaction(
    config_root: str,
    transaction: dict[str, Any],
    validate: Callable[[], None] | None = None,
) -> dict[str, Any]:
    """Apply approved files atomically and restore snapshots on any failure."""
    files = transaction.get("files")
    if transaction.get("validation", {}).get("status") != "passed" or not isinstance(files, list):
        raise TransactionApplyError("Transaction is not approved and validated")
    root = Path(config_root).resolve()
    snapshots: dict[Path, bytes | None] = {}
    targets: list[tuple[Path, bytes]] = []
    for item in files:
        if not isinstance(item, dict) or item.get("approved") is not True:
            raise TransactionApplyError("Transaction contains an unapproved file")
        relative = validate_path(str(item.get("path", "")))
        target = safe_target(root, relative)
        current = target.read_bytes() if target.exists() else None
        if sha256(current) != item.get("originalHash"):
            raise TransactionApplyError(f"Live file changed: {relative}")
        content = item.get("content")
        if not isinstance(content, str):
            raise TransactionApplyError(f"File content is not text: {relative}")
        snapshots[target] = current
        targets.append((target, content.encode("utf-8")))
    try:
        for target, content in targets:
            atomic_write(target, content)
        if validate:
            validate()
    except Exception as error:
        for target, original in snapshots.items():
            if original is None:
                target.unlink(missing_ok=True)
            else:
                atomic_write(target, original)
        raise TransactionApplyError("Transaction failed and was rolled back") from error
    return {"transactionId": transaction.get("id"), "status": "completed", "filesApplied": len(targets)}


def validate_path(relative: str) -> str:
    if not relative or os.path.isabs(relative) or "\x00" in relative:
        raise TransactionApplyError("Path must be relative")
    normalized = os.path.normpath(relative)
    parts = Path(normalized).parts
    if normalized == ".." or ".." in parts:
        raise TransactionApplyError("Path traversal is not allowed")
    if parts[0] in DENIED_DIRECTORIES or parts[-1] in DENIED_FILES:
        raise TransactionApplyError("Path is protected")
    if normalized.endswith(DENIED_SUFFIXES):
        raise TransactionApplyError("File type is protected")
    if normalized.startswith("custom_components/"):
        raise TransactionApplyError("custom_components requires explicit permission")
    return normalized


def safe_target(root: Path, relative: str) -> Path:
    target = root / relative
    if target.is_symlink():
        raise TransactionApplyError("Symlink target is not allowed")
    if root not in target.resolve(strict=False).parents and target.resolve(strict=False) != root:
        raise TransactionApplyError("Path escapes the config directory")
    cursor = target.parent
    while cursor != root:
        if cursor.is_symlink():
            raise TransactionApplyError("Symlink path component is not allowed")
        cursor = cursor.parent
    return target


def sha256(content: bytes | None) -> str | None:
    return None if content is None else hashlib.sha256(content).hexdigest()


def atomic_write(target: Path, content: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_name, target)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
