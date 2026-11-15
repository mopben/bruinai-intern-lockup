"""Every threshold of track-to-worker identity, with its unit and the reason for its value."""

# --- Fragments -------------------------------------------------------------------------------

MIN_FRAGMENT_DETECTIONS = 3
"""Detections. A tracker id seen fewer times is a flicker (ByteTrack already needs 2 frames to give
an id), too short to project, stitch or assign reliably. Dropped and reported."""

# --- Stitching fragments of one person -------------------------------------------------------

STITCH_MAX_GAP_S = 4.0
"""Seconds. Longest hole between the end of one fragment and the start of the next that is bridged:
someone walking past in front, or a worker bending behind the counter, hides a person for 1-3 s."""

STITCH_WALK_MPS = 1.5
"""Metres per second. A brisk kitchen walk (people walk about 1-1.5 m/s indoors): across a gap of g
seconds the next fragment may start up to g * 1.5 m (plus slack) from where the last one ended."""

STITCH_SLACK_M = 0.5
"""Metres. Allowed on top of walking: the two end points are estimates from single boxes, and a head
box projected at an assumed height is off by tens of centimetres when the person bends or turns."""

END_SPAN_S = 0.5
"""Seconds. A fragment's start (end) point is the median floor point over its first (last) 0.5 s,
so one jittery box at the edge of an occlusion does not decide the link."""

# --- Assigning people to workers ------------------------------------------------------------

NEAR_REST_M = 0.45
"""Metres. A floor point this close to a worker's resting spot counts as "at that worker's place".
Half the ~0.9 m between neighbouring station stand points, so a point is near at most one station;
larger than WORK_STAND_M (0.4 m) to absorb head-height error of the projection."""

MIN_NEAR_S = 2.0
"""Seconds. A track must spend at least this long at a worker's place to be that worker. Passing
by a station on the way to the fridge takes well under a second at that distance."""

SHARED_SLOT_SPACING_M = 0.56
"""Metres. Workers who share a station are expected side by side along its stand side, this far
apart, in layout order (the convention of tools/world/sim.ts `homes()`, which made the fixtures).
Positions cannot tell two people at one station apart any other way; see the warning it gives."""

FILL_MAX_GAP_S = 20.0
"""Seconds. A leftover track (one that never rested at a station, e.g. a trip that lost its id) is
joined to a worker only if it starts within this of the end of that worker's track, or ends within
this before its start, and is within walking reach of it. Beyond 20 s it is dropped, not guessed."""

WORK_AREA_MARGIN_M = 0.0
"""Metres. The working area is the kitchen's room bounds (every box and wall footprint) grown by this.
0: customers stand outside the counters; the bounds already reach the far edge of every counter."""

MIN_INSIDE_S = 1.0
"""Seconds. A track that spends less than this inside the working area is someone outside it (a
customer, a passer-by) and is dropped; a single noisy box inside does not count."""
