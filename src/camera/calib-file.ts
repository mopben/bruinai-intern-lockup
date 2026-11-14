/**
 * The calibration file: what the operator clicked, hat heights and sampled
 * colours. Stored in localStorage per camera + kitchen, and exported/imported
 * as JSON so a rehearsal calibration survives a reload or a new laptop.
 */
import { z } from "zod";
import type { PointPair } from "./calibration";
import type { Hsv } from "./color";
import { fail, ok, type Result } from "./result";

export const CALIBRATION_FORMAT = "dryrun.camera-calibration" as const;

export interface CalibrationFile {
  readonly format: typeof CALIBRATION_FORMAT;
  readonly version: 1;
  readonly savedAt: string;
  readonly cameraKey: string;
  readonly kitchenKey: string;
  readonly imageSize: { readonly width: number; readonly height: number };
  readonly pairs: readonly PointPair[];
  /** Metres from the floor to the middle of each worker's hat. */
  readonly hatHeights: Readonly<Record<string, number>>;
  /** Sampled hat colours, by worker id. */
  readonly colours: Readonly<Record<string, Hsv>>;
}

const finite = z.number().refine(Number.isFinite, "must be a number");
const hsv = z.object({ h: finite.min(0).max(360), s: finite.min(0).max(1), v: finite.min(0).max(1) });
export const calibrationFileSchema = z.object({
  format: z.literal(CALIBRATION_FORMAT),
  version: z.literal(1),
  savedAt: z.string(),
  cameraKey: z.string(),
  kitchenKey: z.string(),
  imageSize: z.object({ width: finite.positive(), height: finite.positive() }),
  pairs: z.array(
    z.object({
      refId: z.string().optional(),
      label: z.string(),
      world: z.object({ x: finite, y: finite, z: finite }),
      image: z.object({ x: finite, y: finite }),
    }),
  ),
  hatHeights: z.record(z.string(), finite.min(0.5).max(2.5)),
  colours: z.record(z.string(), hsv),
});

export function emptyCalibration(cameraKey: string, kitchenKey: string, imageSize: { width: number; height: number }): CalibrationFile {
  return { format: CALIBRATION_FORMAT, version: 1, savedAt: new Date(0).toISOString(), cameraKey, kitchenKey, imageSize, pairs: [], hatHeights: {}, colours: {} };
}

export function parseCalibration(text: string): Result<CalibrationFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("That file is not JSON. Choose a calibration file exported from this page.");
  }
  const parsed = calibrationFileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(`That is not a camera calibration file (${first ? `${first.path.join(".") || "file"}: ${first.message}` : "unknown problem"}).`);
  }
  return ok(parsed.data);
}

export const serialiseCalibration = (c: CalibrationFile): string => `${JSON.stringify(c, null, 2)}\n`;

/** Pixel coordinates follow the picture size; rescale if the camera now delivers another resolution. */
export function rescaleCalibration(c: CalibrationFile, size: { width: number; height: number }): CalibrationFile {
  if (c.imageSize.width === size.width && c.imageSize.height === size.height) return c;
  const sx = size.width / c.imageSize.width;
  const sy = size.height / c.imageSize.height;
  return { ...c, imageSize: size, pairs: c.pairs.map((p) => ({ ...p, image: { x: p.image.x * sx, y: p.image.y * sy } })) };
}

export const storageKey = (cameraKey: string, kitchenKey: string): string => `dryrun.camera.calibration:${cameraKey}:${kitchenKey}`;
