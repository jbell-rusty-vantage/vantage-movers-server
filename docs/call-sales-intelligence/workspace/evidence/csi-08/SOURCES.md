# CSI-08 design and integration sources

Continues the real export adaptations recorded in [CSI-07 source inventory](../csi-07/SOURCES.md): scoped CSS/tokens, Attention rows, follow-up cards, ownership, side panel, badges and host-wrapped buttons. The export remains untouched. CSI-08 extends those components and adds host-native operational forms, search, timeline, attachment/review/restriction and Rep presentation against inspected server DTOs. No new export integration stub, fixture adapter or mock client was copied.

Wire authority is the executable main-server validation, route handlers and owning Services, reconciled in [INTAKE](INTAKE.md). Host global search/catalog/auth/proxy/TanStack Query/navigation are reused. Native dialogs provide keyboard containment; command state is component-local and independent of live query objects. Date conversion only encodes an explicitly selected Eastern time and rejects DST ambiguity; it does not compute sales deadlines.

All proof uses persisted synthetic 555-01xx records in the named loopback replica, the actual API and authenticated Next BFF. Screenshots are browser captures, not design mocks. CSI-07 proof is historical baseline and is not relabelled as new acceptance.
