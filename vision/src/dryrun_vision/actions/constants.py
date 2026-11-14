"""Every threshold of the zone-based action segmentation, in one place.

The first group mirrors src/core/trips.ts exactly, so both sides agree on what a
trip is. Change them only together with the TypeScript. The second group is
new to the segmentation and is not used by the TypeScript.
"""

# --- Mirrored from src/core/trips.ts (do not change on one side only) -------------------------

TRIP_EXCURSION_M = 0.5
"""Metres. Further than this from home counts as away (a trip may be under way)."""

TRIP_HOME_M = 0.4
"""Metres. A rest within this of home counts as being at home (trips start and end there)."""

TRIP_MATCH_M = 0.5
"""Metres. A trip reached a stand point when it came within this of it."""

REST_SPEED_MPS = 0.12
"""Metres per second. Smoothed speed below this is at rest (well under a slow walk of ~0.5 m/s)."""

HOME_SEARCH_M = 1.0
"""Metres. Home (the median resting spot) is searched for within this of the station's stand point."""

MAX_GAP_S = 1.0
"""Seconds. Samples further apart than this are a gap: no speed across it, segments split there."""

REST_SPAN_GAP_FACTOR = 4
"""The rest speed is measured over at most this many MAX_GAP_S (trips.ts uses 4 * MAX_GAP_S)."""

SMOOTH_HALF_WINDOW = 2
"""Samples either side of the running median and of the speed window (5-sample median, +-2 speed)."""

# --- New in the segmentation ------------------------------------------------------------------

WORK_STAND_M = TRIP_HOME_M
"""Metres. At rest within this of a station's stand point (or of the worker's home) counts as work
there. Same radius as "at home" so a worker resting at home is always working at their station."""

MIN_SEGMENT_S = 0.5
"""Seconds. Walk/idle/work runs shorter than this are flicker from noisy rest flags (a 5-sample
window at 10 Hz is 0.4 s) and are absorbed into the neighbouring segment. Trips are never absorbed."""

ROOM_MARGIN_M = 0.5
"""Metres. Samples further than this outside the room bounds are reported as anomalies."""

MAX_PLAUSIBLE_SPEED_MPS = 3.0
"""Metres per second. Faster than this between two samples is a tracking jump, not walking
(people in a kitchen walk at about 1-1.5 m/s and do not run)."""
