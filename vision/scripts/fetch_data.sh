#!/usr/bin/env bash
# Re-fetch the real-video test data described in vision/DATASETS.md.
#
# Tools used: curl, unzip, tar/gzip (for the Breakfast .tar.gz archives), ffmpeg, ffprobe.
# Idempotent: every step is skipped when its output already exists.
# Downloaded files are treated as data only; nothing from them is executed.
#
# Checksums: at the end every kept upstream file (MOT frames, ground truth, detections and
# calibrations; the 26 Breakfast clips and their label files; the 4 Mixkit clips) is checked
# against scripts/data.sha256, made from the files on disk on 2026-11-14. What cannot be pinned:
# the archives themselves are deleted after extraction (3DMOT2015.zip, the Hugging Face label
# tarballs) and the Breakfast videos are read from a byte range of a Google Drive download, which is
# not a file; the .mp4 files encoded here from the MOT frames and the preview JPEGs depend on the
# local ffmpeg build, so they are not in the list. A mismatch stops the script with exit code 1.
#
# Usage: vision/scripts/fetch_data.sh            (run from anywhere)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/../data}"
UA="Mozilla/5.0 (dataset-fetch)"

MOT_URL="https://motchallenge.net/data/3DMOT2015.zip"
HF_BREAKFAST="https://huggingface.co/datasets/Serrelab/breakfast-actions/resolve/main"
BREAKFAST_VIDEO_URL="https://drive.usercontent.google.com/download?id=1jgSoof1AatiDRpGY091qd4TEKF-BUt6I&export=download&confirm=t"
# The 3.93 GB video tarball is only read up to this byte; every kept clip lies inside it.
BREAKFAST_PREFIX_BYTES=524287999
MIXKIT_ASSETS="https://assets.mixkit.co/videos"

log() { printf '[fetch_data] %s\n' "$*"; }
fetch() { curl -fsSL --retry 3 -A "$UA" -o "$2" "$1"; }

frame_count() {
  ffprobe -v error -select_streams v:0 -count_frames \
    -show_entries stream=nb_read_frames -of csv=p=0 "$1"
}

# Write the middle frame (0-based index floor(n/2)) of a video as JPEG.
middle_frame() {
  local video="$1" out="$2" n
  [ -f "$out" ] && return 0
  n="$(frame_count "$video")"
  ffmpeg -loglevel error -y -i "$video" -vf "select=eq(n\,$((n / 2)))" \
    -frames:v 1 -q:v 2 "$out"
}

# ---------------------------------------------------------------- 1. MOT 3D 2015
fetch_mot() {
  local dest="$DATA_DIR/mot15-3d" seqs=("PETS09-S2L1:7" "TUD-Stadtmitte:25")
  mkdir -p "$dest"
  local missing=0 s
  for s in "${seqs[@]}"; do [ -d "$dest/${s%%:*}/img1" ] || missing=1; done
  if [ "$missing" = 1 ]; then
    local tmp; tmp="$(mktemp -d "$dest/.tmp.XXXXXX")"
    log "downloading 3DMOT2015.zip (247 MB) to extract two training sequences"
    fetch "$MOT_URL" "$tmp/3DMOT2015.zip"
    unzip -q "$tmp/3DMOT2015.zip" '3DMOT2015/train/PETS09-S2L1/*' \
      '3DMOT2015/train/TUD-Stadtmitte/*' -d "$tmp"
    for s in "${seqs[@]}"; do
      [ -d "$dest/${s%%:*}/img1" ] || mv "$tmp/3DMOT2015/train/${s%%:*}" "$dest/"
    done
    rm -rf "$tmp"
  fi
  for s in "${seqs[@]}"; do
    local name="${s%%:*}" fps="${s##*:}"
    if [ ! -f "$dest/$name/$name.mp4" ]; then
      log "encoding $name.mp4 at $fps fps"
      ffmpeg -loglevel error -y -framerate "$fps" -start_number 1 \
        -i "$dest/$name/img1/%06d.jpg" -c:v libx264 -crf 18 -pix_fmt yuv420p \
        -movflags +faststart "$dest/$name/$name.mp4"
    fi
    if [ ! -f "$dest/preview-$name.jpg" ]; then
      local count mid
      count="$(find "$dest/$name/img1" -name '*.jpg' | wc -l | tr -d ' ')"
      mid="$(printf '%06d' $(( (count + 1) / 2 )))"
      cp "$dest/$name/img1/$mid.jpg" "$dest/preview-$name.jpg"
    fi
  done
}

# ---------------------------------------------------------------- 2. Breakfast subset
# <person>/<camera>/<activity> for the 26 kept clips.
BREAKFAST_CLIPS=(
  P23/cam01/coffee P23/cam01/milk P23/cam01/tea
  P23/webcam01/coffee P23/webcam01/milk P23/webcam01/tea
  P48/cam02/coffee P48/cam02/milk P48/cam02/tea
  P48/webcam02/coffee P48/webcam02/milk P48/webcam02/tea
  P50/cam01/coffee P50/cam01/milk P50/cam01/tea
  P50/webcam02/coffee P50/webcam02/milk P50/webcam02/tea
  P21/cam01/coffee P21/cam01/tea P21/webcam01/milk
  P04/cam01/milk P04/cam01/tea
  P16/webcam02/coffee P16/cam01/milk P16/cam01/tea
)

clip_name() { # P23/cam01/coffee -> P23_cam01_P23_coffee
  local p c a; IFS=/ read -r p c a <<<"$1"; printf '%s_%s_%s_%s' "$p" "$c" "$p" "$a"
}

fetch_breakfast() {
  local dest="$DATA_DIR/breakfast" clip name p c a
  mkdir -p "$dest/videos" "$dest/labels_coarse" "$dest/labels_fine"

  # Annotations (Hugging Face mirror, 0.3 MB + 0.9 MB).
  local need_labels=0
  for clip in "${BREAKFAST_CLIPS[@]}"; do
    [ -f "$dest/labels_coarse/$(clip_name "$clip").txt" ] || need_labels=1
  done
  if [ "$need_labels" = 1 ]; then
    local tmp; tmp="$(mktemp -d "$dest/.tmp.XXXXXX")"
    log "downloading Breakfast segmentation archives from Hugging Face"
    fetch "$HF_BREAKFAST/segmentation_coarse.tar.gz" "$tmp/coarse.tar.gz"
    fetch "$HF_BREAKFAST/segmentation_fine.tar.gz" "$tmp/fine.tar.gz"
    tar -xzf "$tmp/coarse.tar.gz" -C "$tmp"
    tar -xzf "$tmp/fine.tar.gz" -C "$tmp"
    for clip in "${BREAKFAST_CLIPS[@]}"; do
      name="$(clip_name "$clip")"; a="${clip##*/}"
      cp "$tmp/segmentation_coarse/$a/$name.txt" "$dest/labels_coarse/"
      if [ -f "$tmp/segmentation_fine/$a/$name.txt" ]; then
        cp "$tmp/segmentation_fine/$a/$name.txt" "$dest/labels_fine/"
      fi
    done
    rm -rf "$tmp"
  fi

  # Videos: stream the first ~500 MB of the official archive and keep only the 26 clips.
  local members=() need_videos=0
  for clip in "${BREAKFAST_CLIPS[@]}"; do
    IFS=/ read -r p c a <<<"$clip"
    members+=("./BreakfastII_15fps_qvga_sync/$p/$c/${p}_$a.avi")
    [ -f "$dest/videos/$(clip_name "$clip").avi" ] || need_videos=1
  done
  if [ "$need_videos" = 1 ]; then
    local tmp; tmp="$(mktemp -d "$dest/.tmp.XXXXXX")"
    log "streaming the first $((BREAKFAST_PREFIX_BYTES / 1048576)) MB of the Breakfast video archive (Google Drive)"
    # The prefix ends mid-archive, so tar reports a truncated input; that is expected.
    curl -sSL -A "$UA" -r "0-$BREAKFAST_PREFIX_BYTES" "$BREAKFAST_VIDEO_URL" \
      | (gzip -dc 2>/dev/null || true) \
      | (cd "$tmp" && tar -xf - "${members[@]}" 2>/dev/null || true)
    for clip in "${BREAKFAST_CLIPS[@]}"; do
      IFS=/ read -r p c a <<<"$clip"
      local src="$tmp/BreakfastII_15fps_qvga_sync/$p/$c/${p}_$a.avi"
      if [ ! -s "$src" ]; then
        log "ERROR: $clip missing from the archive prefix (Google Drive quota exceeded?)"
        rm -rf "$tmp"; return 1
      fi
      mv "$src" "$dest/videos/$(clip_name "$clip").avi"
    done
    rm -rf "$tmp"
  fi
  for clip in "${BREAKFAST_CLIPS[@]}"; do
    name="$(clip_name "$clip")"
    middle_frame "$dest/videos/$name.avi" "$dest/preview-$name.jpg"
  done
}

# ---------------------------------------------------------------- 3. Stock café clips
STOCK_CLIPS=(
  barista-and-bartenders-working-at-the-bar-4296
  coffee-bar-waiter-813
  chef-working-in-a-large-kitchen-43048
  professional-chefs-work-in-restaurant-kitchen-15875   # Restricted (personal-use) licence
)

fetch_stock() {
  local dest="$DATA_DIR/stock-cafe" slug id file
  mkdir -p "$dest"
  for slug in "${STOCK_CLIPS[@]}"; do
    id="${slug##*-}"; file="$dest/mixkit-$slug-720.mp4"
    if [ ! -f "$file" ]; then
      log "downloading Mixkit clip $id (720p)"
      fetch "$MIXKIT_ASSETS/$id/$id-720.mp4" "$file.part" && mv "$file.part" "$file"
    fi
    middle_frame "$file" "$dest/preview-$slug.jpg"
  done
}

verify() {
  log "checking sha256 of the downloaded files"
  (cd "$DATA_DIR" && grep -v '^#' "$SCRIPT_DIR/data.sha256" | shasum -a 256 -c --quiet -) || {
    log "ERROR: some files differ from scripts/data.sha256 (changed upstream, or a broken download)"
    return 1
  }
}

fetch_mot
fetch_breakfast
fetch_stock
verify
log "done; data in $DATA_DIR"
