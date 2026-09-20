# AFTER-16 B — Message-rep dialogs + F-02

Admin-only. Server preview/send/history already existed.

- Message-rep: preview then explicit Send, destination User + allowed channels from the stored directory snapshot, masked editable body, sent / failed / unknown distinct, same Idempotency-Key on 5xx or unknown retry, `GET /nudges` history with continuation.
- F-02: `conversationProvenance` follows stored transcript/summary fields. The unconditional paid-replay sentence is gone.
- Lead Conversations demo chrome removed (“Automation is designed, not authorized” / “Next — not built”).
- `/conversations` Owner-gated the same way as `/sales-intelligence` (page redirect + login path + dashboard shell).

No live send. Flags unchanged.
