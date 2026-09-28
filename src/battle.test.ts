import { describe, expect, it } from "vitest";
import { readBest, saveBest } from "./battle";

describe("local record", () => {
  it("keeps the higher record and ignores malformed values", () => {
    let value = "broken";
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
    expect(readBest(storage)).toBe(0);
    expect(saveBest(storage, 500)).toBe(500);
    expect(saveBest(storage, 100)).toBe(500);
    expect(saveBest(storage, NaN)).toBe(500);
    expect(value).toBe("500");
  });
  it("works when browser storage is blocked", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readBest(storage)).toBe(0);
    expect(saveBest(storage, 100)).toBe(100);
  });
});
