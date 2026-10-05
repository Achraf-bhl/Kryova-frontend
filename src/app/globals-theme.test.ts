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

/** WCAG 2.x relative luminance and contrast ratio. */
function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast (ROAD_TO_10 8.11)", () => {
  const themes = {
    light: declarations("@theme"),
    dark: declarations(':root[data-theme="dark"]'),
  };

  for (const [name, tokens] of Object.entries(themes)) {
    it(`keeps body text at 4.5:1 on the surfaces it sits on, in ${name}`, () => {
      for (const ink of ["--color-accent", "--color-muted", "--color-faint"]) {
        for (const ground of ["--color-surface", "--color-surface-sunken", "--color-canvas"]) {
          expect(contrast(tokens[ink], tokens[ground]), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`keeps status colours legible as text on the surface, in ${name}`, () => {
      for (const status of ["--color-warning", "--color-danger", "--color-success"]) {
        expect(contrast(tokens[status], tokens["--color-surface"]), status).toBeGreaterThanOrEqual(4.4);
      }
    });

    it(`keeps the primary colour at 3:1 (a UI component) in ${name}`, () => {
      expect(contrast(tokens["--color-primary"], tokens["--color-surface"])).toBeGreaterThanOrEqual(3);
    });
  }

  it("keeps white button text on the light theme's fills at 4.5:1", () => {
    const light = themes.light;
    for (const fill of ["--color-primary", "--color-danger"]) {
      expect(contrast("#ffffff", light[fill]), fill).toBeGreaterThanOrEqual(4.5);
    }
  });
});
