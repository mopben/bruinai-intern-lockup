"""Video input, one frame at a time, never the whole video in memory (needs the ml extra).

`read_frames`: every Nth frame in order (tracker, render). `VideoFrames`: frames at sorted times,
seeking over gaps (labeller). Both share how a file is opened and probed.
"""

from dryrun_vision.video.reader import Frame, VideoError, probe_video, read_frames
from dryrun_vision.video.seek import VideoFrames, count_frames

__all__ = ["Frame", "VideoError", "VideoFrames", "count_frames", "probe_video", "read_frames"]
