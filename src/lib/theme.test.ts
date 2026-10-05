import { afterEach, describe, expect, it } from "vitest";

import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyPreference,
  currentTheme,
  nextPreference,
  parsePreference,
  readPreference,
  resolveTheme,
  viewerBackground,
} from "./theme";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

describe("parsePreference", () => {
  it("accepts the three words and treats anything else as following the system", () => {
    expect(parsePreference("light")).toBe("light");
    expect(parsePreference("dark")).toBe("dark");
    expect(parsePreference("system")).toBe("system");
    expect(parsePreference("sepia")).toBe("system");
    expect(parsePreference(null)).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("lets an explicit choice beat the system, and the system decide otherwise", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("nextPreference", () => {
  it("cycles system, light, dark and back", () => {
    expect(nextPreference("system")).toBe("light");
    expect(nextPreference("light")).toBe("dark");
    expect(nextPreference("dark")).toBe("system");
  });
});

describe("applyPreference", () => {
  it("sets data-theme and remembers an explicit choice", () => {
    applyPreference("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(readPreference()).toBe("dark");
    expect(currentTheme()).toBe("dark");
  });

  it("returns to the system by removing the attribute and the memory", () => {
    applyPreference("dark");
    applyPreference("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});

describe("the init script", () => {
  it("applies a stored explicit theme and ignores junk", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});

describe("viewerBackground", () => {
  it("is darker in the dark theme", () => {
    const light = viewerBackground("light");
    const dark = viewerBackground("dark");
    expect(dark[0]).toBeLessThan(light[0]);
    expect(dark[2]).toBeLessThan(light[2]);
    expect(dark[0]).toBeCloseTo(0.043, 3);
  });
});
