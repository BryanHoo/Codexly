import { describe, expect, it } from "vitest";

import {
  DEFAULT_PET_POSITION,
  clampPetPosition,
  petPositionFromRatio,
  petPositionToRatio,
  readPetPositionPreference,
} from "./pet-position-preference.js";

describe("pet position preference", () => {
  it("拒绝损坏、越界或旧版本数据", () => {
    expect(readPetPositionPreference({ getItem: () => "bad-json" })).toEqual(DEFAULT_PET_POSITION);
    expect(
      readPetPositionPreference({
        getItem: () => JSON.stringify({ version: 0, xRatio: 0.2, yRatio: 0.4 }),
      }),
    ).toEqual(DEFAULT_PET_POSITION);
    expect(
      readPetPositionPreference({
        getItem: () => JSON.stringify({ version: 1, xRatio: 2, yRatio: 0.4 }),
      }),
    ).toEqual(DEFAULT_PET_POSITION);
  });

  it("在当前可移动范围内换算归一化位置", () => {
    const bounds = { height: 400, petHeight: 80, petWidth: 72, width: 600 };
    const pixels = petPositionFromRatio({ version: 1, xRatio: 0.5, yRatio: 0.25 }, bounds);

    expect(pixels).toEqual({ x: 264, y: 80 });
    expect(petPositionToRatio(pixels, bounds)).toEqual({
      version: 1,
      xRatio: 0.5,
      yRatio: 0.25,
    });
  });

  it("尺寸变化后仍把宠物完整限制在边界内", () => {
    expect(
      clampPetPosition(
        { x: 900, y: -20 },
        { height: 300, petHeight: 80, petWidth: 72, width: 500 },
      ),
    ).toEqual({ x: 428, y: 0 });
  });
});
