import hashlib
import tempfile
from pathlib import Path

try:
    from .transaction_apply import TransactionApplyError, apply_approved_transaction, infer_activation_plan
except ImportError:
    from transaction_apply import TransactionApplyError, apply_approved_transaction, infer_activation_plan


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
    for path in ("secrets.yaml", "history.db-2026", "home-assistant.log.1"):
        try:
            apply_approved_transaction("/tmp", {"validation": {"status": "passed"}, "files": [{"path": path, "content": "x", "originalHash": None, "approved": True}]})
        except TransactionApplyError:
            continue
        raise AssertionError(f"protected path was accepted: {path}")


def test_activation_plan_is_advisory():
    assert infer_activation_plan(["automations.yaml"])["domain"] == "automation"
    assert infer_activation_plan(["configuration.yaml"])["action"] == "restart"
    assert infer_activation_plan(["known.yaml"])["action"] == "none"


if __name__ == "__main__":
    test_apply_and_rollback()
    test_rejects_protected_paths()
    test_activation_plan_is_advisory()
    print("transaction apply tests passed")
