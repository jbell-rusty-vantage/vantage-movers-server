Fixed a substantiated nudge-repair verification gap.

- Team Messaging receipt repair now requires the returned Direct chat ID to equal the stored requested chat ID.
- Added regression coverage for a mismatched chat ID.

Files changed:

- [adapters.ts](C:\Users\Pinda\Proyectos\vantage\vantage-main-server\.git\vantage-quality\runs\1789772227555-39337d57\workspace\src\services\salesIntelligence\nudges\adapters.ts)
- [nudges.test.ts](C:\Users\Pinda\Proyectos\vantage\vantage-main-server\.git\vantage-quality\runs\1789772227555-39337d57\workspace\src\services\salesIntelligence\nudges\nudges.test.ts)

The supplied review had no findings; no findings were rejected or left awaiting a product decision. Focused test execution could not run because this isolated checkout lacks installed `tsx` dependencies; pnpm was additionally blocked by user-level config permissions.