"""Owner-signed GET-only Pool evidence reads; no Mongo, Granot or worker invocation."""

import argparse
import collections
import datetime
import hashlib
import hmac
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

BASE = "https://vantage-movers-main-server.vercel.app"
ADMIN_PREFIX = "/api/v1/admin/"
ALLOW_PATH = re.compile(
    r"^/api/v1/admin/(?:granot-automation/runs(?:/[a-f0-9]{24})?|form-leads|call-leads|booked-leads)$"
)
BROWSE_KEYS = {"database_scope", "limit", "page", "sort", "direction", "duplicate", "cancelled"}
REPOSITORY = Path(__file__).resolve().parents[2]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(NoRedirect())


class ApiReadError(RuntimeError):
    """Only a status and recognized literal-true cast flag survive an HTTP failure."""

    def __init__(self, status, cancelled_true_cast=False):
        super().__init__(f"GET failed with HTTP {status}; response content discarded")
        self.status = status
        self.cancelled_true_cast = cancelled_true_cast

    def evidence(self):
        return {"http": self.status, "cancelled_true_cast_observed": self.cancelled_true_cast}


def cancelled_true_cast(body):
    # Never retain an arbitrary server error. Recognize only the already observed non-customer literal.
    text = json.dumps(body) if isinstance(body, (dict, list)) else str(body)
    text = text.replace('\\"', '"')
    return bool(re.search(r'Cast to ObjectId failed for value ["\']true["\']', text)) and "CancelledLead" in text


def signed_request(path, query=None):
    if not ALLOW_PATH.fullmatch(path):
        raise ValueError("Path is outside the fixed GET evidence allowlist")
    query = query or {}
    allowed_keys = {"limit"} if path == ADMIN_PREFIX + "granot-automation/runs" else {"details"} if "/runs/" in path else BROWSE_KEYS
    if not set(query).issubset(allowed_keys):
        raise ValueError("Query keys are outside the fixed evidence allowlist")
    timestamp, request_id = str(int(time.time() * 1000)), str(uuid.uuid4())
    user_id = os.environ["VANTAGE_ADMIN_USER_ID"].strip()
    email = os.environ["VANTAGE_ADMIN_EMAIL"].strip().lower()
    fields = [user_id, email, "owner", timestamp, request_id, "GET", path]
    headers = {
        "x-api-secret": os.environ["VANTAGE_API_SECRET"],
        "x-vantage-admin-user-id": user_id,
        "x-vantage-admin-email": email,
        "x-vantage-admin-role": "owner",
        "x-vantage-admin-timestamp": timestamp,
        "x-vantage-admin-request-id": request_id,
        "x-vantage-admin-signature": hmac.new(
            os.environ["VANTAGE_ADMIN_PROXY_SIGNING_SECRET"].encode(),
            "\n".join(fields).encode(), hashlib.sha256,
        ).hexdigest(),
    }
    suffix = "?" + urllib.parse.urlencode(query) if query else ""
    return urllib.request.Request(BASE + path + suffix, headers=headers, method="GET")


def api(path, query=None):
    try:
        with OPENER.open(signed_request(path, query), timeout=45) as response:
            if response.status != 200:
                raise ApiReadError(response.status)
            return json.load(response)["data"]
    except urllib.error.HTTPError as error:
        try:
            body = json.loads(error.read(65_536))
        except (ValueError, UnicodeError):
            body = None
        finally:
            error.close()
        raise ApiReadError(error.code, cancelled_true_cast(body)) from None
    except urllib.error.URLError:
        raise RuntimeError("GET transport failed; no response content retained") from None


def utc_now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def output_directory(value):
    path = Path(value).expanduser().resolve()
    if path == REPOSITORY or REPOSITORY in path.parents:
        raise ValueError("Runtime evidence and private checkpoints must be outside the repository")
    for parent in (path, *path.parents):
        marker = parent / ".git"
        # Sandboxed empty .git mounts are not repositories; a real marker/HEAD is.
        if marker.is_file() or (marker / "HEAD").is_file():
            raise ValueError("Runtime output must be outside every Git checkout")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def write_private_json(path, data):
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        os.fchmod(handle.fileno(), 0o600)
        json.dump(data, handle, indent=2)
        handle.write("\n")


def arguments(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--run", action="store_true", help="Perform the fixed authenticated GET reads")
    parser.add_argument("--output-dir", required=True, help="Runtime directory outside Git; files are mode 0600")
    args = parser.parse_args()
    if not args.run:
        parser.error("--run is required; no request was sent")
    try:
        args.output_dir = output_directory(args.output_dir)
    except ValueError as error:
        parser.error(str(error))
    return args


def probe(read=api):
    results = {}
    for model in ("form-leads", "call-leads"):
        for duplicate in (False, True):
            data = read(ADMIN_PREFIX + model, {
                "database_scope": "production", "limit": 1, "page": 1,
                "duplicate": str(duplicate).lower(),
            })
            results[f"{model}:duplicate={duplicate}"] = {
                "total": data["total"], "page": data["page"], "limit": data["limit"],
                "has_next_page": data["has_next_page"],
                "priority_field_present_in_sample": any("granot_priority" in row for row in data["items"]),
            }
    data = read(ADMIN_PREFIX + "granot-automation/runs", {"limit": 100})
    runs = data if isinstance(data, list) else data.get("runs", [])
    states = collections.Counter((row.get("operation"), row.get("workflow"), row.get("status")) for row in runs)
    results["recent_run_states"] = [
        {"operation": key[0], "workflow": key[1], "status": key[2], "count": count}
        for key, count in states.items()
    ]
    results["active_applying"] = sum(row.get("status") == "applying" for row in runs)
    estimates = next((row for row in runs if row.get("operation") == "estimates_in_process" and row.get("status") == "completed"), None)
    if estimates:
        run = read(ADMIN_PREFIX + "granot-automation/runs/" + str(estimates.get("id") or estimates.get("_id")), {"details": "owner"})
        # Keys only: no plan actions, receipts, customer values or run identifiers are persisted.
        results["completed_estimates_response"] = {
            "fields": sorted(run), "workflow": run.get("workflow"), "status": run.get("status"),
            "date_window": None, "plan_fields": sorted(run.get("plan") or {}),
        }
    results.update({"verified_at": utc_now(), "production_mutations": 0, "execution_complete": True})
    return results


def main():
    args = arguments(__doc__)
    try:
        summary = probe()
    except ApiReadError as error:
        summary = {"verified_at": utc_now(), "production_mutations": 0, "execution_complete": False, "read_failure": error.evidence()}
    except (RuntimeError, ValueError, KeyError, TypeError):
        summary = {"verified_at": utc_now(), "production_mutations": 0, "execution_complete": False, "read_failure": {"kind": "transport_or_shape_error", "response_content_retained": False}}
    output = args.output_dir / "read-api-surface.json"
    write_private_json(output, summary)
    print(json.dumps({"execution_complete": summary["execution_complete"], "production_mutations": 0, "output": output.name}))
    return 0 if summary["execution_complete"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
