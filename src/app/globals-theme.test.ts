import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");

/** The `--name: value` pairs inside the first block that starts with `selector`. */
function declarations(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  expect(start, `${selector} must exist`).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const match of css.slice(open + 1, close).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    out[match[1]] = match[2].replace(/\s+/g, " ").trim();
  }
  return out;
}

describe("the dark theme", () => {
  const explicit = declarations(':root[data-theme="dark"]');
  const system = declarations(':root:not([data-theme="light"]):not([data-theme="dark"])');

  it("is the same palette whether chosen or inherited from the system", () => {
    expect(Object.keys(explicit).length).toBeGreaterThan(15);
    expect(system).toEqual(explicit);
  });

  it("moves every surface and ink token the light theme defines", () => {
    const light = declarations("@theme");
    for (const token of [
      "--color-surface",
      "--color-surface-sunken",
      "--color-canvas",
      "--color-border",
      "--color-accent",
      "--color-muted",
      "--color-faint",
    ]) {
      expect(explicit[token], token).toBeDefined();
      expect(explicit[token], `${token} must differ from light`).not.toBe(light[token]);
    }
  });

  it("keeps the stress ramp the same in both themes, because it is data", () => {
    for (const token of Object.keys(explicit)) {
      expect(token.startsWith("--color-ramp-")).toBe(false);
    }
  });

  it("keeps ink readable: text is lighter than the surface it sits on", () => {
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    };
    for (const ink of ["--color-accent", "--color-muted", "--color-faint"]) {
      expect(luminance(explicit[ink])).toBeGreaterThan(luminance(explicit["--color-surface"]) + 0.3);
    }
  });
});
