import type { RatingVersion } from "../types";

export type RadarGeometryOptions = {
  compact?: boolean;
  hideSwing?: boolean;
  ratingVersion?: RatingVersion;
};

export function radarOuterRingRadius(
  options: RadarGeometryOptions,
  width: number,
  height: number,
) {
  const showSwing = !options.hideSwing && options.ratingVersion === "rating_3";
  return Math.min(width, height) * (
    options.compact
      ? showSwing
        ? 0.19
        : 0.27
      : showSwing
        ? 0.235
        : 0.27
  );
}

export function radarOuterRingDiameter(
  options: RadarGeometryOptions,
  width: number,
  height: number,
) {
  return radarOuterRingRadius(options, width, height) * 2;
}
