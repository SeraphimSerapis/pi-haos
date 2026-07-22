import hashlib
import tempfile
from pathlib import Path

from .transaction_apply import TransactionApplyError, apply_approved_transaction


def test_apply_and_rollback():
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "automations.yaml"
        target.write_text("old\n")
        transaction = {
            "id": "tx-1",
            "validation": {"status": "passed"},
            "files": [{"path": "automations.yaml", "content": "new\n", "originalHash": hashlib.sha256(b"old\n").hexdigest(), "approved": True}],
        }
        try:
            apply_approved_transaction(directory, transaction, lambda: (_ for _ in ()).throw(RuntimeError("invalid")))
        except TransactionApplyError:
            pass
        else:
            raise AssertionError("failed validation was not rejected")
        assert target.read_text() == "old\n"


def test_rejects_protected_paths():
    try:
        apply_approved_transaction("/tmp", {"validation": {"status": "passed"}, "files": [{"path": "secrets.yaml", "content": "x", "originalHash": None, "approved": True}]})
    except TransactionApplyError:
        return
    raise AssertionError("protected path was accepted")
