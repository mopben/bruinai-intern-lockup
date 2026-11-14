/** Calibration persistence in localStorage, keyed by camera + kitchen. */
import { parseCalibration, serialiseCalibration, storageKey, type CalibrationFile } from "../calib-file";

export function loadStored(cameraKey: string, kitchenKey: string): CalibrationFile | undefined {
  try {
    const text = globalThis.localStorage?.getItem(storageKey(cameraKey, kitchenKey));
    if (!text) return undefined;
    const parsed = parseCalibration(text);
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

/** Returns an error sentence if the browser refused to store it. */
export function store(c: CalibrationFile): string | undefined {
  try {
    globalThis.localStorage?.setItem(storageKey(c.cameraKey, c.kitchenKey), serialiseCalibration(c));
    return undefined;
  } catch {
    return "The browser would not save the calibration (private window?). Use Export to keep it.";
  }
}
