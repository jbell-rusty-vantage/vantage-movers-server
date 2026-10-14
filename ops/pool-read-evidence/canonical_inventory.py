"""Canonical priority-9 collision corpus through GET APIs; not live Granot Pool discovery."""

import collections
import hashlib
import hmac
import json
import os
import re
import sys
import unicodedata

sys.dont_write_bytecode = True
import api_read

BOOKING_SCOPE = "cancelled field missing/null only; legacy false is excluded by current API presence filter"
PASSES = (
    ("FormLead", "form-leads", False), ("FormLead", "form-leads", True),
    ("CallLead", "call-leads", False), ("CallLead", "call-leads", True),
    ("BookedLead", "booked-leads", None),
)
CHECKPOINT_NAME = "canonical-inventory-private-checkpoint.json"
CHECKPOINT_VERSION = 1


def norm(value):
    if not isinstance(value, str):
        return None
    value = unicodedata.normalize("NFKC", value).strip().strip("\ufeff").strip()
    value = "".join(char if unicodedata.category(char)[0] in ("L", "N") else " " for char in value)
    return " ".join(value.split()).upper() or None


def core(value):
    match = re.fullmatch(r"[A-Z]*([0-9]+)", value or "")
    return match[1] if match else None


def identity(value):
    if isinstance(value, dict):
        value = value.get("_id") or value.get("id")
    return str(value) if value else None


def job_facts(row):
    raw, stored = norm(row.get("job_no")), norm(row.get("normalized_job_no"))
    return {
        "keys": sorted({key for key in (raw, stored) if key}),
        "normalization_disagreement": bool(raw and stored and raw != stored),
        "unusual_unicode_job": any(ord(char) > 127 for char in str(row.get("job_no") or "") + str(row.get("normalized_job_no") or "")),
    }


def booking_facts(row, origin):
    item_id = identity(row.get("_id") or row.get("id"))
    if not item_id:
        raise ValueError("Returned Booking has no canonical identity")
    ref, model = identity(row.get("lead_ref")), row.get("lead_model")
    linked = bool(ref and model in ("FormLead", "CallLead"))
    recognized_official_anchor = linked or row.get("is_referral_booking") is True or (
        row.get("is_leadless_booking") is True and row.get("is_referral_booking") is not True
        and row.get("booking_origin") not in ("employee_booking", "owner_booking")
        and not row.get("lead_ref") and not row.get("lead_model")
    )
    residual = bool((row.get("lead_ref") or row.get("lead_model")) and not linked)
    anchor_eligibility = "held_partial_pointer" if residual else "recognized_official_anchor" if recognized_official_anchor else "pending_or_unofficial_anchor"
    return {
        "model": "BookedLead", "id": item_id, **job_facts(row),
        "cancelled": bool(row.get("cancelled")), "lead_ref": ref,
        "lead_model": model if model in ("FormLead", "CallLead") else None,
        "residual_pointer": residual, "official_anchor_eligibility": anchor_eligibility,
        "origin": origin,
    }


def lead_facts(row, model):
    item_id = identity(row.get("_id") or row.get("id"))
    if not item_id:
        raise ValueError("Returned Lead has no canonical identity")
    item = {
        "model": model, "id": item_id, **job_facts(row), "cancelled": bool(row.get("cancelled")),
        "priority": row.get("granot_priority").strip() if isinstance(row.get("granot_priority"), str) else None,
        "duplicate": row.get("duplicate") is True, "bad": row.get("bad_lead") is True,
        "unmatched": row.get("created_on_unmatched") is True, "booked": identity(row.get("booked")),
        "assigned": bool(row.get("receiver_agent")), "manual_receiver": row.get("receiver_agent_source") == "manual",
        "no_sync": row.get("no_sync") is True,
    }
    attached = row.get("booked")
    anchor = booking_facts(attached, "lead_attached_population") if isinstance(attached, dict) and identity(attached) else None
    return item, anchor


def initial_checkpoint():
    return {"checkpoint_version": CHECKPOINT_VERSION, "started": api_read.utc_now(), "stats": {}, "leads": [], "books": []}


def load_checkpoint(path):
    if not path.exists():
        return initial_checkpoint()
    if path.is_symlink():
        raise ValueError("Private checkpoint symlinks are refused")
    if path.stat().st_mode & 0o077:
        raise ValueError("Existing private checkpoint must have mode 0600")
    checkpoint = json.loads(path.read_text())
    if checkpoint.get("checkpoint_version") != CHECKPOINT_VERSION:
        raise ValueError("Checkpoint format differs; use a new output directory")
    if any(key == "BookedLead:duplicate=None" and value.get("scope") != BOOKING_SCOPE for key, value in checkpoint["stats"].items()):
        raise ValueError("Checkpoint Booking scope differs; use a new output directory")
    return checkpoint


def enumerate_pass(model, resource, duplicate, read):
    seen, totals, leads, books = set(), [], [], []
    received = 0
    for page in range(1, 1001):
        query = {"database_scope": "production", "limit": 250, "page": page, "sort": "createdAt", "direction": "asc"}
        if duplicate is not None:
            query["duplicate"] = str(duplicate).lower()
        if model == "BookedLead":
            query["cancelled"] = "false"
        data = read(api_read.ADMIN_PREFIX + resource, query)
        totals.append(data["total"])
        for row in data["items"]:
            received += 1
            if model == "BookedLead":
                item = booking_facts(row, "cancelled_missing_null_browse")
                books.append(item)
            else:
                item, anchor = lead_facts(row, model)
                leads.append(item)
                if anchor:
                    books.append(anchor)
            seen.add(item["id"])
        # Counts only; identifiers/jobs never enter console progress or public evidence.
        print(json.dumps({"resource": resource, "duplicate_pass": duplicate, "page": page, "received": received, "total": data["total"]}), flush=True)
        if not data["has_next_page"]:
            return leads, books, {
                "pages": page, "reported_totals": sorted(set(totals)), "rows_received": received,
                "unique_ids": len(seen), "observed_complete": len(set(totals)) == 1 and received == len(seen) == totals[0],
                "point_in_time_snapshot": False, "scope": BOOKING_SCOPE if model == "BookedLead" else "all_canonical_leads",
            }
        if not data["items"]:
            raise ValueError("Pagination promised another page after an empty response")
    raise ValueError("Guarded 1000-page request budget exceeded; execution is incomplete")


def collect(checkpoint, path, read=api_read.api):
    if "full_booking_browse_probe" not in checkpoint:
        try:
            sample = read(api_read.ADMIN_PREFIX + "booked-leads", {"database_scope": "production", "limit": 1, "page": 1})
            checkpoint["full_booking_browse_probe"] = {"http": 200, "sample_rows": len(sample["items"]), "full_inventory_enumerated": False}
        except api_read.ApiReadError as error:
            checkpoint["full_booking_browse_probe"] = {**error.evidence(), "full_inventory_enumerated": False}
        api_read.write_private_json(path, checkpoint)
    for model, resource, duplicate in PASSES:
        key = f"{model}:duplicate={duplicate}"
        if key in checkpoint["stats"]:
            continue
        leads, books, stats = enumerate_pass(model, resource, duplicate, read)
        # Commit only fully returned passes. An interrupted pass is re-enumerated on resume.
        checkpoint["leads"].extend(leads)
        checkpoint["books"].extend(books)
        checkpoint["stats"][key] = stats
        api_read.write_private_json(path, checkpoint)
    return checkpoint


def summarize(checkpoint, execution_complete):
    # Fresh, unstored namespace per execution, including checkpoint resumes; hashes do not link runs.
    namespace = os.urandom(32)

    def redact(kind, value):
        return kind + "_" + hmac.new(namespace, str(value).encode(), hashlib.sha256).hexdigest()[:20]

    leads = list({(row["model"], row["id"]): row for row in checkpoint["leads"]}.values())
    books = list({row["id"]: row for row in checkpoint["books"]}.values())
    browsed_ids = {row["id"] for row in checkpoint["books"] if row["origin"] == "cancelled_missing_null_browse"}
    attached_ids = {row["id"] for row in checkpoint["books"] if row["origin"] == "lead_attached_population"}
    candidates = [row for row in leads if row["priority"] == "9"]
    jobs = sorted({key for row in candidates for key in row["keys"]})
    counts, examples = collections.Counter(), []
    for job in jobs:
        exact = [row for row in leads if job in row["keys"]]
        aliases = [row for row in leads if job not in row["keys"] and core(job) and any(core(key) == core(job) for key in row["keys"])]
        matched = exact + aliases
        refs = {(row["model"], row["id"]) for row in matched}
        attached = {row["booked"] for row in matched if row["booked"]}
        anchors = [book for book in books if book["id"] in attached or (book["lead_model"], book["lead_ref"]) in refs or job in book["keys"] or (core(job) and any(core(key) == core(job) for key in book["keys"]))]
        classification = "cross_model_collision" if len({row["model"] for row in exact}) > 1 else "multiple_same_model" if len(exact) > 1 else "unique_exact_lead"
        counts[classification] += 1
        flags = {
            "jobs_with_digit_core_aliases": bool(aliases), "jobs_with_booking_anchor": bool(anchors),
            "jobs_with_official_booking_anchor": any(book["official_anchor_eligibility"] == "recognized_official_anchor" for book in anchors),
            "jobs_with_pending_or_unofficial_booking_anchor": any(book["official_anchor_eligibility"] == "pending_or_unofficial_anchor" for book in anchors),
            "jobs_with_partial_booking_identity": any(book["residual_pointer"] for book in anchors),
            "jobs_matching_other_priority_lead": any(row["priority"] != "9" for row in matched),
            "jobs_with_duplicate_lead": any(row["duplicate"] for row in matched),
            "jobs_with_ineligible_anchor": any(row["bad"] or row["cancelled"] or row["unmatched"] for row in matched),
            "jobs_with_raw_stored_disagreement": any(row["normalization_disagreement"] for row in matched),
        }
        counts.update({key: 1 for key, value in flags.items() if value})
        if classification != "unique_exact_lead" or aliases or anchors or flags["jobs_matching_other_priority_lead"]:
            examples.append({
                "job_key": redact("job", job), "class": classification,
                "leads": [{
                    "model": row["model"], "entity_key": redact("entity", row["model"] + ":" + row["id"]),
                    "match": "exact" if row in exact else "digit_core_alias", "priority": row["priority"],
                    **{key: row[key] for key in ("duplicate", "bad", "cancelled", "unmatched", "assigned", "manual_receiver", "no_sync", "normalization_disagreement")},
                    "prior_sheet_written": "unknown",
                } for row in matched],
                "bookings": [{"entity_key": redact("entity", "BookedLead:" + book["id"]), **{key: book[key] for key in ("official_anchor_eligibility", "cancelled", "residual_pointer")}, "pool_identity_hold": book["residual_pointer"]} for book in anchors],
            })
    return {
        "provenance": "canonical_priority9_read_api_inventory_not_live_granot_pool",
        "started_at": checkpoint["started"], "completed_at": api_read.utc_now(), "production_mutations": 0,
        "execution_complete": execution_complete, "inventory": checkpoint["stats"],
        "lead_inventory_observed_complete": all(checkpoint["stats"].get(f"{model}:duplicate={duplicate}", {}).get("observed_complete", False) for model, _, duplicate in PASSES[:4]),
        "booking_inventory_complete": False, "full_booking_browse_probe": checkpoint.get("full_booking_browse_probe"),
        "canonical_lead_count": len(leads), "booking_count": len(books),
        "booking_browse_unique_ids": len(browsed_ids), "additional_lead_attached_booking_anchors": len(attached_ids - browsed_ids),
        "booking_coverage": f"incomplete: {len(browsed_ids)} missing/null-cancelled browse rows plus {len(attached_ids - browsed_ids)} additional Lead-attached anchors; legacy true/false cancellation values and other unlinked cancelled anchors may be missing",
        "canonical_priority9_leads": dict(collections.Counter(row["model"] for row in candidates)),
        "canonical_priority9_leads_missing_job": sum(not row["keys"] for row in candidates),
        "canonical_priority9_flags": {key: sum(bool(row[key]) for row in candidates) for key in ("duplicate", "bad", "cancelled", "unmatched", "assigned", "manual_receiver", "no_sync", "booked", "normalization_disagreement")},
        "canonical_priority9_prior_sheet_written": "unknown; no_sync is not write evidence",
        "candidate_job_keys": len(jobs), "collision_job_counts": dict(counts),
        "redacted_examples": examples[:25], "examples_total": len(examples),
        "normalization": "canonical NFKC, Unicode L/N punctuation-to-space, uppercase; ASCII digit-core equivalent aliases reported separately",
        "unusual_unicode_lead_jobs": sum(row["unusual_unicode_job"] for row in leads),
        "normalization_disagreements_all_leads": sum(row["normalization_disagreement"] for row in leads),
        "redaction_namespace": "fresh unstored random HMAC namespace per execution",
        "official_anchor_eligibility_basis": "advisory Pool identity classification; residual pointers held; financial official allocation credit not evaluated",
        "limitations": [
            "No live Granot Pool selector/form/report rows were fetched",
            "Full Booking inventory is incomplete; cancelled=false means missing/null only and excludes legacy false; unlinked cancelled/job-only anchors may be missing",
            "Canonical priority9 is not proof of current-month Granot Pool membership",
            "Offset pagination/single-field sort is not a point-in-time snapshot",
            "API population can hide dangling attached pointers; missing links are not proven absent",
            "Residual Booking pointers are Pool identity holds independently of referral financial-credit truth",
            "No prior Sheet write inferred from no_sync false",
            "Examples capped25; summary counts cover all retained observed Lead rows, with explicitly partial Booking coverage",
        ],
    }


def main():
    args = api_read.arguments(__doc__)
    cache_path = args.output_dir / CHECKPOINT_NAME
    checkpoint = load_checkpoint(cache_path)
    failure = None
    try:
        collect(checkpoint, cache_path)
    except api_read.ApiReadError as error:
        failure = error.evidence()
    except (ValueError, RuntimeError, KeyError, TypeError):
        failure = {"kind": "execution_stopped", "detail": "No response content retained; check authentication, API shape and page budget"}
    summary = summarize(checkpoint, failure is None)
    if failure:
        summary["read_failure"] = failure
    output = args.output_dir / "canonical-priority9-collisions.json"
    api_read.write_private_json(output, summary)
    print(json.dumps({
        "execution_complete": summary["execution_complete"], "booking_inventory_complete": False,
        "candidate_jobs": summary["candidate_job_keys"], "canonical9": sum(summary["canonical_priority9_leads"].values()),
        "collision_job_counts": summary["collision_job_counts"], "output": output.name,
    }), flush=True)
    return 0 if summary["execution_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
