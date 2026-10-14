"""Offline behavior checks: never invokes production, Mongo, Granot or a worker."""

import contextlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import api_read
import canonical_inventory as inventory

SYNTHETIC_ENV = {
    "VANTAGE_ADMIN_USER_ID": "synthetic-owner",
    "VANTAGE_ADMIN_EMAIL": "synthetic@example.invalid",
    "VANTAGE_API_SECRET": "synthetic-api-secret",
    "VANTAGE_ADMIN_PROXY_SIGNING_SECRET": "synthetic-signing-secret",
}


class ReadEvidenceTests(unittest.TestCase):
    def test_cli_requires_opt_in_and_outside_git(self):
        for name in ("api_read.py", "canonical_inventory.py"):
            script = Path(__file__).with_name(name)
            for args in ([], ["--output-dir", "/tmp/synthetic-pool-read-no-run"], ["--run", "--output-dir", str(api_read.REPOSITORY)]):
                result = subprocess.run([sys.executable, str(script), *args], capture_output=True, text=True, env={"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1"})
                self.assertEqual(result.returncode, 2)
            self.assertEqual(subprocess.run([sys.executable, str(script), "--help"], capture_output=True).returncode, 0)

    def test_get_only_fixed_host_path_and_query_redirect_guards(self):
        with patch.dict(os.environ, SYNTHETIC_ENV, clear=True):
            for path in ("form-leads", "call-leads", "booked-leads", "granot-automation/runs", "granot-automation/runs/" + "a" * 24):
                request = api_read.signed_request(api_read.ADMIN_PREFIX + path)
                self.assertEqual(request.get_method(), "GET")
                self.assertIsNone(request.data)
                self.assertTrue(request.full_url.startswith(api_read.BASE + api_read.ADMIN_PREFIX))
            for path in ("https://example.invalid", "/api/v1/admin/booked-leads/" + "a" * 24, "/api/v1/admin/granot-automation/runs/../apply"):
                with self.assertRaises(ValueError):
                    api_read.signed_request(path)
            with self.assertRaises(ValueError):
                api_read.signed_request(api_read.ADMIN_PREFIX + "form-leads", {"customer_name": "synthetic"})
        self.assertIsNone(api_read.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.invalid"))

    def test_private_output_permissions_and_symlink_refusal(self):
        with tempfile.TemporaryDirectory(prefix="pool-read-offline-") as directory:
            output = api_read.output_directory(directory)
            path = output / inventory.CHECKPOINT_NAME
            api_read.write_private_json(path, inventory.initial_checkpoint())
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertEqual(inventory.load_checkpoint(path)["checkpoint_version"], 1)
            link = output / "linked.json"
            link.symlink_to(path)
            with self.assertRaises(OSError):
                api_read.write_private_json(link, {})
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                inventory.load_checkpoint(path)
            (output / ".git").mkdir()
            (output / ".git" / "HEAD").write_text("ref: refs/heads/synthetic\n")
            with self.assertRaises(ValueError):
                api_read.output_directory(output / "runtime")

    def test_canonical_normalization_and_ascii_digit_core(self):
        self.assertEqual(inventory.norm(" \ufeffＰ５５-１２.３ / "), "P55 12 3")
        self.assertEqual(inventory.norm("é/猫-٤٢"), "É 猫 ٤٢")
        self.assertEqual(inventory.core("P55123"), "55123")
        self.assertEqual(inventory.core("55123"), "55123")
        self.assertIsNone(inventory.core("É55123"))
        self.assertIsNone(inventory.core("P٥٥١٢٣"))
        self.assertIsNone(inventory.core("P55 123"))

    def test_literal_true_failure_and_correct_partial_booking_scope(self):
        error = {"message": 'Cast to ObjectId failed for value "true" (type string) at path "_id" for model "CancelledLead"'}
        self.assertTrue(api_read.cancelled_true_cast(error))
        self.assertFalse(api_read.cancelled_true_cast({"message": "arbitrary customer error"}))
        browse_id, attached_id = "b" * 24, "c" * 24
        lead = {
            "_id": "a" * 24, "job_no": "P123", "normalized_job_no": "P123", "granot_priority": "9",
            "receiver_agent": "d" * 24, "no_sync": False, "phone_number": "NEVER_RETAIN_CONTACT",
            "booked": {"_id": attached_id, "job_no": "P999", "lead_ref": "a" * 24, "lead_model": "FormLead", "total_binder_amount": "NEVER_RETAIN_MONEY"},
        }
        queries = []

        def fake_read(path, query):
            queries.append((path, query))
            if path.endswith("booked-leads") and "cancelled" not in query:
                raise api_read.ApiReadError(500, True)
            if path.endswith("booked-leads"):
                self.assertEqual(query["cancelled"], "false")
                rows = [{"_id": browse_id, "job_no": "P456", "total_binder_amount": "NEVER_RETAIN_MONEY"}]
            else:
                rows = [lead] if path.endswith("form-leads") and query["duplicate"] == "false" else []
            return {"items": rows, "total": len(rows), "has_next_page": False}

        with tempfile.TemporaryDirectory(prefix="pool-inventory-offline-") as directory:
            path = Path(directory) / inventory.CHECKPOINT_NAME
            checkpoint = inventory.initial_checkpoint()
            with contextlib.redirect_stdout(io.StringIO()):
                inventory.collect(checkpoint, path, fake_read)
            self.assertEqual(len(queries), 6, "one full-browse probe, four Lead passes, one filtered Booking pass")
            summary = inventory.summarize(checkpoint, True)
            self.assertTrue(summary["execution_complete"])
            self.assertFalse(summary["booking_inventory_complete"])
            self.assertTrue(summary["lead_inventory_observed_complete"])
            self.assertEqual(summary["booking_count"], 2)
            self.assertEqual(summary["booking_browse_unique_ids"], 1)
            self.assertEqual(summary["additional_lead_attached_booking_anchors"], 1)
            self.assertEqual(summary["canonical_priority9_flags"]["assigned"], 1)
            self.assertEqual(summary["canonical_priority9_flags"]["no_sync"], 0)
            self.assertIn("unknown", summary["canonical_priority9_prior_sheet_written"])
            self.assertEqual(summary["inventory"]["BookedLead:duplicate=None"]["scope"], inventory.BOOKING_SCOPE)
            self.assertEqual(summary["full_booking_browse_probe"]["http"], 500)
            private = path.read_text()
            public = json.dumps(summary)
            for marker in ("NEVER_RETAIN_CONTACT", "NEVER_RETAIN_MONEY"):
                self.assertNotIn(marker, private + public)
            for value in (lead["_id"], lead["job_no"], attached_id, browse_id):
                self.assertNotIn(value, public)
            first_hash = summary["redacted_examples"][0]["job_key"]
            self.assertNotEqual(first_hash, inventory.summarize(checkpoint, True)["redacted_examples"][0]["job_key"])

    def test_partial_referral_pointer_is_a_pool_identity_hold_not_financial_credit_rule(self):
        partial = inventory.booking_facts({
            "_id": "a" * 24, "lead_model": "FormLead", "lead_ref": None, "is_referral_booking": True,
        }, "cancelled_missing_null_browse")
        self.assertTrue(partial["residual_pointer"])
        self.assertEqual(partial["official_anchor_eligibility"], "held_partial_pointer")
        linked = inventory.booking_facts({
            "_id": "a" * 24, "lead_model": "FormLead", "lead_ref": "b" * 24,
        }, "cancelled_missing_null_browse")
        self.assertEqual(linked["official_anchor_eligibility"], "recognized_official_anchor")
        clean_referral = inventory.booking_facts({"_id": "a" * 24, "is_referral_booking": True}, "cancelled_missing_null_browse")
        self.assertEqual(clean_referral["official_anchor_eligibility"], "recognized_official_anchor")

    def test_error_summary_is_not_empty_or_complete_and_partial_pass_is_not_cached(self):
        with tempfile.TemporaryDirectory(prefix="pool-incomplete-offline-") as directory:
            path = Path(directory) / inventory.CHECKPOINT_NAME
            checkpoint = inventory.initial_checkpoint()
            checkpoint["full_booking_browse_probe"] = {"http": 500, "full_inventory_enumerated": False}
            counter = 0

            def failing_read(_path, _query):
                nonlocal counter
                counter += 1
                if counter > 1:
                    raise api_read.ApiReadError(503)
                return {"items": [{"_id": "a" * 24, "job_no": "P123"}], "total": 2, "has_next_page": True}

            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(api_read.ApiReadError):
                inventory.collect(checkpoint, path, failing_read)
            self.assertEqual(checkpoint["leads"], [])
            summary = inventory.summarize(checkpoint, False)
            self.assertFalse(summary["execution_complete"])
            self.assertFalse(summary["lead_inventory_observed_complete"])
            self.assertFalse(summary["booking_inventory_complete"])


if __name__ == "__main__":
    unittest.main()
