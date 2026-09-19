## Review findings

- **Medium — incomplete number summaries can be published without any transcript evidence.**  
  `capturedTranscriptsComplete` returns `true` for an empty transcript-page set when `conversationId` is `null`; `runIntelligenceApplicationJob` then accepts `transcriptSources=[]` and publishes a `number_refresh` summary. A number with no currently eligible transcript can therefore run the model on record-only context and persist an apparently complete summary, contrary to the pinned-transcript/incomplete-coverage contract.  
  Path: [coverage.ts](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789795679279-a540097e/workspace/src/services/salesIntelligence/analysis/coverage.ts:4), [apply.ts](C:/Users/Pinda/Proyectos/vantage/vantage-main-server/.git/vantage-quality/runs/1789795679279-a540097e/workspace/src/services/salesIntelligence/analysis/apply.ts:71).  
  Smallest fix: require at least one complete captured transcript for `number_refresh` before application/publication; preferably also skip/pause the run before provider invocation when `numberAnalysisInput` selects none. Add a regression test for a record-only number-refresh submission.

No other concrete auth, validation, side-effect-ordering, or clean-code regressions found in the reviewed changed flows.