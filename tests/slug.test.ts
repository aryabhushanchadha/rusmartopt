import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "../src/utils/slug.js";

describe("slugify", () => {
  it("transliterates Cyrillic to Latin", () => {
    expect(slugify("Стеллаж торговый МГ-200")).toBe("stellazh-torgovyy-mg-200");
  });

  it("handles punctuation and repeated separators", () => {
    expect(slugify("Короб гофро 400×300!!")).toBe("korob-gofro-400-300");
  });

  it("lowercases and trims leading/trailing dashes", () => {
    expect(slugify("--Мебель--")).toBe("mebel");
  });

  it("falls back to a placeholder for empty/unslugifiable input", () => {
    expect(slugify("")).toBe("item");
    expect(slugify("!!!")).toBe("item");
  });

  it("truncates very long input", () => {
    const long = "А".repeat(200);
    expect(slugify(long).length).toBeLessThanOrEqual(80);
  });
});

describe("uniqueSlug", () => {
  it("returns the base slug when it doesn't exist yet", async () => {
    const result = await uniqueSlug("Мебель", async () => false);
    expect(result).toBe("mebel");
  });

  it("appends -2, -3, ... on collision", async () => {
    const taken = new Set(["mebel", "mebel-2", "mebel-3"]);
    const result = await uniqueSlug("Мебель", async (c) => taken.has(c));
    expect(result).toBe("mebel-4");
  });
});
