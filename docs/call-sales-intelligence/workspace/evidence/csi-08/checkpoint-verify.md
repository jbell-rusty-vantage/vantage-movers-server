Finding: documentation is inaccurate. `checked()` also runs during post-persistence submission revalidation, after `OwnerRepNudge` exists, so the Service statement that a customer-destination rejection always occurs before persistence is false. A concurrent phone/lead update can trigger this path.

Recorded typecheck, lint, test, and quality-tests all passed.

QUALITY_RESULT: FAIL