---
name: Route sequencing design decisions (Divine Edge OS)
description: Stop-order and capacity math for the Routes feature uses a self-written nearest-neighbor heuristic and a fixed average speed, not a mapping API.
---

# Route sequencing design decisions (Divine Edge OS)

**The decision:** Route stop sequencing uses a self-written nearest-neighbor haversine-distance heuristic from the depot, converting distance to drive time with a fixed average-speed assumption — no external mapping/routing API.

**Why:** Avoids a new third-party integration/API-key dependency; nearest-neighbor is "good enough" for daily field-service ordering versus true optimal routing, and a fixed speed avoids needing live traffic data.

**How to apply:** Future work touching route stop order, drive-time estimates, or capacity math should stay consistent with this heuristic-and-fixed-speed approach unless the user explicitly asks for real mapping/traffic integration — that's a deliberate scope change, not a bug fix.
