# Real-video test data for the vision pipeline

All data lives under `vision/data/` (git-ignored). Re-create it with `vision/scripts/fetch_data.sh`
(idempotent; about 750 MB of network transfer, 182 MB on disk afterwards). Everything below was
checked by opening the files; numbers come from `ffprobe -count_frames`, file counts or the scripts
noted.

| Dir | Purpose | On disk | Licence |
| --- | --- | --- | --- |
| `mot15-3d/` | 1. tracking + floor position in metres | 152 MB | CC BY-NC-SA 3.0 (**non-commercial**) |
| `breakfast/` | 2. kitchen action labels | 19 MB | CC BY 4.0 (per the Hugging Face mirror; see note) |
| `stock-cafe/` | 3. qualitative café footage | 10 MB | Mixkit Free (3 clips), Mixkit **Restricted** (1 clip, personal use only) |

---

## 1. `mot15-3d/` - PETS09-S2L1 and TUD-Stadtmitte (MOTChallenge 3D MOT 2015)

**What it is.** The two *training* sequences of MOTChallenge 3D MOT 2015, the only ones with public
ground truth: person boxes with track identities **and** ground-plane positions in metres, plus a Tsai
camera calibration.

- **PETS09-S2L1** (main sequence): outdoor campus scene, one static camera about **7.1 m** above the
  ground looking down at a tilt, up to 8 people at once, 19 identities. This is the best match for a
  high, tilted café camera.
- **TUD-Stadtmitte** (secondary): outdoor pedestrian street, static camera at about **1.7 m** (eye level),
  10 identities. Useful to check the projection code on a second, very different calibration.

No indoor sequence with metric ground truth was small enough or well enough documented; see "Not
fetched" at the end.

**Source.** <https://motchallenge.net/data/3D_MOT_2015/>, archive
<https://motchallenge.net/data/3DMOT2015.zip> (247 MB; only the two `train/` folders are kept).
PETS 2009 originally comes from the University of Reading PETS workshop (cvg.reading.ac.uk, which did
not resolve on 2026-11-14, so its own terms could not be checked).

**Licence.** MOTChallenge: "published under the Creative Commons Attribution-NonCommercial-ShareAlike
3.0 License" and "you may not use this work for commercial purposes"; "the conditions of the original
source may apply in addition" (<https://motchallenge.net/data/3D_MOT_2015/>). **Non-commercial.**
Cite the MOTChallenge 2015 paper (Leal-Taixé et al., arXiv:1504.01942) and PETS 2009 (Ferryman & Shahrokni).

**Layout.**

```
mot15-3d/
  preview-PETS09-S2L1.jpg        frame 000398 (middle)
  preview-TUD-Stadtmitte.jpg     frame 000090 (middle)
  PETS09-S2L1/
    img1/000001.jpg ... 000795.jpg   original frames (JPEG, 768x576)
    PETS09-S2L1.mp4                  H.264 CRF 18, built from img1 at 7 fps
    gt/gt.txt                        ground truth (4650 rows)
    det/det.txt                      public detections shipped with the benchmark (5578 rows)
    maps/View_001.xml                Tsai calibration (XML)
    maps/View_001.txt                same numbers, one per line
  TUD-Stadtmitte/
    img1/000001.jpg ... 000179.jpg   (640x480)
    TUD-Stadtmitte.mp4               built at 25 fps
    gt/gt.txt (1156 rows), det/det.txt (1129 rows)
    maps/TUD-Stadtmitte-calib.xml    Tsai calibration (XML)
    maps/View_001.txt                same numbers, one per line
```

**Video properties.**

| Sequence | Resolution | fps | Frames | Duration | Identities | Rows with people |
| --- | --- | --- | --- | --- | --- | --- |
| PETS09-S2L1 | 768x576 | 7 | 795 | 113.6 s | 19 | 795 frames, 2-8 people each |
| TUD-Stadtmitte | 640x480 | 25 | 179 | 7.16 s | 10 | 179 frames |

The fps values are the ones MOTChallenge lists for these sequences (PETS09-S2L1: 7, TUD-Stadtmitte: 25)
on the 3D MOT 2015 page; the image folders carry no timing information, so the `.mp4` files were encoded
at exactly those rates. PETS 2009 was recorded at roughly 7 fps, so real-time timing is approximate.

### Ground-truth format (`gt/gt.txt`)

Comma-separated, one row per person per frame, 10 columns:

| Col | Name | Meaning |
| --- | --- | --- |
| 1 | frame | frame number, **1-based**; frame `n` is `img1/%06d.jpg` of `n`, and is at `t = (n-1)/fps` in the `.mp4` |
| 2 | id | track identity (integer, stable over the sequence) |
| 3 | bb_left | box left edge, pixels |
| 4 | bb_top | box top edge, pixels |
| 5 | bb_width | pixels |
| 6 | bb_height | pixels |
| 7 | flag | 1 = evaluate, 0 = ignore (PETS: 174 rows, ids 11, 12, 16; TUD: none) |
| 8 | x | ground-plane position, **metres**, world frame of the calibration |
| 9 | y | ground-plane position, metres |
| 10 | z | always 0 (on the ground plane) |

Example (PETS09-S2L1, first rows):

```
1,9,499,158,31.03,75.17,1,-4.1554,-7.3591,0
1,15,258,219,32.913,88.702,1,-11.306,-5.5995,0
```

Person 9 in frame 1: box from (499, 158) of size 31.0x75.2 px, standing at (x, y) = (-4.16 m, -7.36 m).

World-coordinate ranges: PETS x -19.9..7.4 m, y -16.2..7.7 m; TUD x 3.6..16.6 m, y 2.0..11.4 m.

`det/det.txt` uses the same columns, with `id = -1`, column 7 a detector score (-0.48..138.9, not a
probability), and columns 8-10 the ground position of the detection box.

### Calibration (`maps/*.xml`) - Tsai model, millimetres, z up

Example (PETS09-S2L1 `maps/View_001.xml`):

```xml
<Geometry width="768" height="576" ncx="7.95e+02" nfx="7.52e+02" dx="4.85e-03" dy="4.65e-03" dpx="5.1273271277e-03" dpy="4.65e-03"/>
<Intrinsic focal="5.5549183034e+00" kappa1="5.1113043639e-03" cx="3.2422149053e+02" cy="2.8256650051e+02" sx="1.0937855397e+00"/>
<Extrinsic tx="8.2873214225e+02" ty="-3.1754796051e+03" tz="3.5469298547e+04" rx="2.0405458695e+00" ry="-8.9337703748e-01" rz="-4.3056124791e-01"/>
```

| Parameter | Meaning | Unit |
| --- | --- | --- |
| width, height | image size | px |
| ncx, nfx, dx, dy | sensor description; already folded into dpx (dpx = dx*ncx/nfx) | - , mm |
| dpx, dpy | effective pixel size (use these) | mm/px |
| focal | focal length f | mm |
| kappa1 | first radial distortion coefficient (Tsai) | 1/mm^2 |
| cx, cy | principal point (distortion centre) | px |
| sx | horizontal scale factor | - |
| tx, ty, tz | translation T, world origin in camera frame | **mm** |
| rx, ry, rz | rotation angles | rad |

`maps/View_001.txt` holds the same 19 numbers one per line in this order: width, height, ncx, nfx,
dx, dy, dpx, dpy, cx, cy, sx, focal, kappa1, tx, ty, tz, rx, ry, rz.

**World frame.** Ground plane is z = 0, **z points up** (camera centres are at z = +7.07 m for PETS
and +1.66 m for TUD). World units in the calibration are millimetres; `gt.txt` positions are the same
frame in metres (multiply by 1000 before using the calibration).

**World to pixel** (Tsai 1987 / Willson's reference implementation; verified, see below):

```
sa,ca = sin(rx),cos(rx); sb,cb = sin(ry),cos(ry); sg,cg = sin(rz),cos(rz)
R = [[cb*cg, cg*sa*sb - ca*sg, sa*sg + ca*cg*sb],
     [cb*sg, sa*sb*sg + ca*cg, ca*sb*sg - cg*sa],
     [-sb,   cb*sa,            ca*cb          ]]
[xc,yc,zc] = R @ [Xw,Yw,Zw] + [tx,ty,tz]        # all mm
Xu = focal*xc/zc ;  Yu = focal*yc/zc            # undistorted sensor coords, mm
solve Xu = Xd*(1 + kappa1*r^2), Yu = Yd*(1 + kappa1*r^2), r^2 = Xd^2 + Yd^2   (fixed-point iteration converges)
u = Xd*sx/dpx + cx ;  v = Yd/dpy + cy          # pixels
```

**Pixel to ground** (no iteration needed): `Xd = (u-cx)*dpx/sx`, `Yd = (v-cy)*dpy`,
`Xu = Xd*(1+kappa1*r^2)`, `Yu = Yd*(1+kappa1*r^2)`; ray direction in world `d = R^T @ [Xu, Yu, focal]`;
camera centre `C = -R^T @ T`; ground point `C + s*d` with `s = -C_z/d_z`; divide by 1000 for metres.

**Verification (done on all GT rows).** The ground-truth world positions were produced from the box
bottom centres, offset by 1.5 px:

```
project(x*1000, y*1000, 0) = (bb_left + bb_width/2 - 1.5, bb_top + bb_height - 1.5)  +- 0.5 px
```

Median offset is -1.50 px in both u and v for both sequences (range -2.0..-1.0, i.e. rounding).
Back-projecting `(bb_left + bb_width/2 - 1.5, bb_top + bb_height - 1.5)` to z = 0 reproduces the GT
position with median error 0.019 m (p95 0.049 m, max 0.083 m) for PETS and 0.041 m (p95 0.10 m) for
TUD. Without the 1.5 px shift the median error is 0.12 m (PETS) and 0.26 m (TUD).

**Ground-truth caveats.** Because the metric positions are derived from the 2D boxes, they are not an
independent measurement of where the feet are: they inherit box-annotation error (in PETS, boxes are
hand-drawn and somewhat loose). Floor error measured against them is "our foot point vs. the annotated
box's foot point" through a correct calibration, which is what the pipeline needs, but do not expect
centimetre truth. The distortion term is small (switching it off changes reprojection by about 0.1 px).

---

## 2. `breakfast/` - Breakfast Actions, coffee/tea/milk subset (26 clips)

**What it is.** Breakfast Actions (Kuehne, Arslan & Serre, CVPR 2014): 52 people making breakfast in
18 real kitchens, filmed by 3-5 static, uncalibrated cameras each, with frame-level action
segmentation. Kept: 26 clips of the three drink activities (`coffee`, `tea`, `milk`) from **6 people**
(P04, P16, P21, P23, P48, P50), **4 camera types** (cam01, cam02, webcam01, webcam02). Nine
recordings (all of P23, P48 and P50) are kept from two cameras each (synchronized, same frame
counts and identical label files), so cross-view consistency can be checked. Camera views are third-person and static, at roughly counter height;
people are often cut off at the head or legs and are close to the camera (see previews), not a
high café-ceiling view. One person per clip (occasionally someone in the background).

**Source.** Lab page <https://serre.lab.brown.edu/breakfast-actions-dataset.html>.
Annotations: Hugging Face mirror run by the lab, <https://huggingface.co/datasets/Serrelab/breakfast-actions>
(`segmentation_coarse.tar.gz` 291 KB, `segmentation_fine.tar.gz` 931 KB; SHA-256 match the repo's
`SHA256SUMS`). Videos: the official Google Drive archive `BreakfastII_15fps_qvga_sync.tar.gz`
(3.93 GB, id `1jgSoof1AatiDRpGY091qd4TEKF-BUt6I`, linked from the HF README). Only its first 500 MB
was streamed (HTTP range request) and the 26 clips extracted from the stream; nothing else was written
to disk. The HF README warns that Drive sometimes blocks the download ("quota exceeded"); on
2026-11-14 it worked.

**Licence.** The Hugging Face dataset card states "Dataset license: Creative Commons Attribution 4.0"
(<https://huggingface.co/datasets/Serrelab/breakfast-actions>). The lab page itself states no licence,
only "Please cite the following papers when using this dataset." Treat as CC BY 4.0 with citation of
Kuehne et al. CVPR 2014 and WACV 2016. The recordings show identifiable people.

**Layout.**

```
breakfast/
  videos/<P>_<cam>_<P>_<activity>.avi      26 clips, MPEG-4 Part 2 in AVI, 15 fps
  labels_coarse/<same name>.txt            coarse action units, all 26 clips
  labels_fine/<same name>.txt              fine actions, only the 9 clips that have them
  preview-<same name>.jpg                  middle frame of each clip
```

**Video properties.** All 15 fps (`r_frame_rate 15/1`), 320x240 except `P48_webcam02_*` and
`P50_webcam02_*` which are 320x180. 26 clips, 18,838 decoded frames, 20.9 min in total.

| Clip | Res | Frames | s |
| --- | --- | --- | --- |
| P04_cam01_P04_milk | 320x240 | 755 | 50.5 |
| P04_cam01_P04_tea | 320x240 | 398 | 26.7 |
| P16_cam01_P16_milk | 320x240 | 886 | 59.2 |
| P16_cam01_P16_tea | 320x240 | 364 | 24.4 |
| P16_webcam02_P16_coffee | 320x240 | 572 | 38.3 |
| P21_cam01_P21_coffee | 320x240 | 301 | 20.2 |
| P21_cam01_P21_tea | 320x240 | 834 | 55.7 |
| P21_webcam01_P21_milk | 320x240 | 871 | 58.2 |
| P23_cam01_P23_coffee / P23_webcam01_P23_coffee | 320x240 | 806 | 53.9 |
| P23_cam01_P23_milk / P23_webcam01_P23_milk | 320x240 | 1248 | 83.3 |
| P23_cam01_P23_tea / P23_webcam01_P23_tea | 320x240 | 715 | 47.8 |
| P48_cam02_P48_coffee / P48_webcam02_P48_coffee | 320x240 / 320x180 | 276 | 18.5 |
| P48_cam02_P48_milk / P48_webcam02_P48_milk | 320x240 / 320x180 | 796 / 795 | 53.1 |
| P48_cam02_P48_tea / P48_webcam02_P48_tea | 320x240 / 320x180 | 569 | 38.1 |
| P50_cam01_P50_coffee / P50_webcam02_P50_coffee | 320x240 / 320x180 | 692 | 46.3 |
| P50_cam01_P50_milk / P50_webcam02_P50_milk | 320x240 / 320x180 | 793 | 53.0 |
| P50_cam01_P50_tea / P50_webcam02_P50_tea | 320x240 / 320x180 | 1034 | 69.1 |

### Label format

One segment per line, `start-end label`, whitespace-separated (lines end with two spaces):

```
labels_coarse/P23_cam01_P23_coffee.txt
1-1 SIL
2-146 take_cup
147-436 pour_coffee
437-566 pour_milk
567-808 SIL
```

- Frame numbers are **1-based and inclusive**; in the coarse files consecutive segments tile the
  video with no gaps or overlaps (checked for all 26).
- **Mapping to video time:** label frame `k` is decoded frame index `k-1` (0-based) and starts at
  `t = (k-1)/15` s.
- The last segment always ends **2 frames after the last decoded frame** (e.g. 806 decoded frames, labels to 808;
  `P48_cam02_P48_milk` decodes 796 frames, its labels end at 797). Clamp to the frame count; the
  overrun is always inside the trailing `SIL` segment.
- `SIL` = silence/background (before and after the activity).
- The same activity recorded by two cameras has identical label files (the cameras are synchronized).
- Fine labels use the same format and frame indexing, but annotated separately: they have small gaps
  between some segments (e.g. `P04_cam01_P04_milk`: frames 28-41 unlabelled; `P04_cam01_P04_tea` has a
  one-frame overlap at 200) and do not always agree with the coarse boundaries (e.g. `P50_*_coffee`
  coarse says `pour_sugar` 311-418, fine has no sugar action there). Use coarse as the primary truth.

### Coarse labels in the subset (all 26 clips)

Durations are summed over clips, inclusive frame ranges, at 15 fps (includes the 2-frame overrun).

| Label | Segments | Clips | Frames | Seconds |
| --- | --- | --- | --- | --- |
| SIL | 52 | 26 | 3927 | 261.8 |
| pour_milk | 17 | 14 | 2813 | 187.5 |
| stir_milk | 11 | 9 | 2470 | 164.7 |
| spoon_powder | 9 | 9 | 2218 | 147.9 |
| pour_coffee | 8 | 8 | 2023 | 134.9 |
| pour_water | 9 | 9 | 1971 | 131.4 |
| add_teabag | 9 | 9 | 1199 | 79.9 |
| take_cup | 8 | 8 | 1060 | 70.7 |
| spoon_sugar | 2 | 2 | 738 | 49.2 |
| stir_coffee | 2 | 2 | 254 | 16.9 |
| pour_sugar | 2 | 2 | 216 | 14.4 |

### Fine labels in the subset (9 clips)

| Label | Segments | Clips | Frames | Seconds |
| --- | --- | --- | --- | --- |
| garbage | 24 | 9 | 856 | 57.1 |
| pour_milk | 8 | 6 | 480 | 32.0 |
| walk | 8 | 4 | 363 | 24.2 |
| scoop_chocolatepowder | 4 | 4 | 361 | 24.1 |
| pour_coffee | 2 | 2 | 340 | 22.7 |
| stir_chocolate | 4 | 4 | 332 | 22.1 |
| pour_water | 3 | 3 | 305 | 20.3 |
| carry_milk | 23 | 6 | 304 | 20.3 |
| carry_cup | 16 | 9 | 290 | 19.3 |
| carry_teabag | 6 | 3 | 286 | 19.1 |
| carry_kettle | 6 | 3 | 255 | 17.0 |
| screwopen_capMilk | 8 | 6 | 236 | 15.7 |
| carry_coffee | 4 | 2 | 218 | 14.5 |
| screwclose_capMilk | 6 | 6 | 208 | 13.9 |
| carry_chocolatepowder | 14 | 4 | 163 | 10.9 |
| open_teabag | 3 | 3 | 149 | 9.9 |
| reach_cup | 12 | 6 | 137 | 9.1 |
| reach_milk | 8 | 6 | 131 | 8.7 |
| stir_coffee | 2 | 2 | 110 | 7.3 |
| pressclose_lidChoco | 5 | 3 | 107 | 7.1 |
| carry_spoon | 6 | 6 | 97 | 6.5 |
| reach_chocolatepowder | 8 | 4 | 89 | 5.9 |
| carry_lidChoco | 6 | 3 | 85 | 5.7 |
| liftopen_lidChoco | 3 | 3 | 79 | 5.3 |
| reach_cabinet | 2 | 2 | 78 | 5.2 |
| reach_spoon | 4 | 4 | 59 | 3.9 |
| hold_milk | 2 | 2 | 54 | 3.6 |
| move | 6 | 5 | 52 | 3.5 |
| turn | 3 | 2 | 28 | 1.9 |
| hold_cup | 4 | 3 | 22 | 1.5 |
| reach_lidChoco | 3 | 3 | 16 | 1.1 |
| reach_coffee | 2 | 2 | 16 | 1.1 |
| hold_coffee | 2 | 2 | 16 | 1.1 |
| pull_drawer | 1 | 1 | 11 | 0.7 |

Fine-label clips: P04_cam01 milk + tea, P21_webcam01 milk, P23_cam01 tea, P23_webcam01 tea,
P48_cam02 milk, P48_webcam02 milk, P50_cam01 coffee, P50_webcam02 coffee.

---

## 3. `stock-cafe/` - Mixkit clips of staff behind a counter (qualitative only)

Four static-camera clips, chosen from about 30 screened Mixkit and Coverr clips by comparing first and
last frames (background unchanged = no pan or handheld movement). No ground truth.
Stock fixed-camera footage is rare: most café clips are handheld close-ups. All four are **shorter than
or about 10 s**, which is the length Mixkit offers.

| File | Content | Res | fps | Frames | s | Licence |
| --- | --- | --- | --- | --- | --- | --- |
| `mixkit-barista-and-bartenders-working-at-the-bar-4296-720.mp4` | 2 bartenders behind a bar, upper bodies, eye-level | 1280x720 | 30 | 285 | 9.50 | Mixkit Free |
| `mixkit-coffee-bar-waiter-813-720.mp4` | 1 barista behind a coffee bar, turns and walks to camera with a tray; waist-up | 1280x720 | 24 | 241 | 10.04 | Mixkit Free |
| `mixkit-chef-working-in-a-large-kitchen-43048-720.mp4` | 1 chef at a kitchen counter, waist-up, frontal | 1280x720 | 23.976 | 195 | 8.13 | Mixkit Free |
| `mixkit-professional-chefs-work-in-restaurant-kitchen-15875-720.mp4` | about 8 chefs in a restaurant kitchen, full bodies, slightly elevated | 1280x720 | 29.97 | 154 | 5.14 | **Mixkit Restricted** |

Each has `preview-<slug>.jpg` (middle frame). Video only, no audio. Sources:
`https://mixkit.co/free-stock-video/<slug>/`, files `https://assets.mixkit.co/videos/<id>/<id>-720.mp4`.

**Licences** (<https://mixkit.co/license/>, text from `https://mixkit.co/license/modal/videoFree` and
`.../videoRestricted`):

- Stock Video Free License: "can be used in your commercial and non-commercial projects, for free";
  attribution not required.
- Stock Video **Restricted** License (clip 15875 only): "can be used in personal projects only";
  commercial projects, advertising and company social media are listed as not allowed.
  **Delete this clip if the project is not personal/educational.** It is the only multi-person,
  full-body clip found.

---

## Not fetched

- **EPFL multi-camera pedestrians, "laboratory"** (indoor, 4 cameras, 25 fps, 360x288; one camera of
  the 6-person sequence is 78 MB): ground truth is a person's **cell index on a 56x56 top-view grid**,
  annotated every 25 frames, with no boxes, and the cell size in metres is not stated on the page, so
  metric error could not be computed without guessing. The terrace sequence has metric GT but is outdoor and
  the PETS data covers it. Licence: "copyrighted by CVLab - EPFL. ... You can use them for research purposes."
  (<https://www.epfl.ch/labs/cvlab/data/data-pom-index-php/>).
- **WILDTRACK**: not tried (too large, as expected).
- **Pexels and Pixabay**: both returned HTTP 403 bot-check pages to scripted requests; not bypassed.
- **Coverr**: free clips screened; all suitable café ones are handheld or moving.
- **Wikimedia Commons**: search found no fixed-camera barista or kitchen-staff footage.
