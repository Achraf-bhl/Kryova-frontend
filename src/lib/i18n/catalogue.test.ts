import { describe, expect, it } from "vitest";

import { en, fr, resolveLocale, translate, type MessageKey } from "./catalogue";

const keys = Object.keys(en) as MessageKey[];

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe("the catalogue", () => {
  it("has a French message for every English key and no strays", () => {
    expect(Object.keys(fr).sort()).toEqual([...keys].sort());
  });

  it("keeps every placeholder in the translation", () => {
    for (const key of keys) {
      expect(placeholders(fr[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it("never leaves a French message equal to the English one where words changed", () => {
    // Single-word brand-neutral entries may coincide; anything longer was not translated.
    for (const key of keys) {
      if (en[key].split(" ").length > 2) expect(fr[key], key).not.toBe(en[key]);
    }
  });
});

describe("translate", () => {
  it("fills placeholders and keeps an unknown one visible rather than blank", () => {
    expect(translate("en", "theme.change", { state: "Theme: dark" })).toBe(
      "Theme: dark — press to change",
    );
    expect(translate("fr", "theme.change", { state: "Thème : sombre" })).toContain("appuyez");
    expect(translate("en", "theme.change")).toContain("{state}");
  });

  it("answers in the asked language", () => {
    expect(translate("fr", "nav.projects")).toBe("Projets");
    expect(translate("en", "nav.projects")).toBe("Projects");
  });
});

describe("resolveLocale", () => {
  it("lets the cookie beat the browser", () => {
    expect(resolveLocale({ cookie: "en", acceptLanguage: "fr-FR,fr;q=0.9" })).toBe("en");
    expect(resolveLocale({ cookie: "fr", acceptLanguage: "en-US" })).toBe("fr");
  });

  it("reads the first language we have, skipping ones we do not", () => {
    expect(resolveLocale({ acceptLanguage: "de-DE,de;q=0.9,fr-CA;q=0.8" })).toBe("fr");
    expect(resolveLocale({ acceptLanguage: "fr-CA,fr;q=0.9,en;q=0.5" })).toBe("fr");
  });

  it("falls back to English for nothing, junk or an unsupported language", () => {
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ cookie: "klingon", acceptLanguage: "ja,zh" })).toBe("en");
  });
});
