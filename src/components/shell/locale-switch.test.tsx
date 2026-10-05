import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleSwitch } from "@/components/shell/locale-switch";
import { LocaleProvider, useT } from "@/lib/i18n/locale-context";

function Probe() {
  const t = useT();
  return <p>{t("nav.projects")}</p>;
}

afterEach(() => {
  document.cookie = "kryova-locale=; path=/; max-age=0";
  document.documentElement.lang = "en";
});

describe("LocaleSwitch", () => {
  it("changes the language, the document's lang and the cookie together", () => {
    render(
      <LocaleProvider initialLocale="en">
        <LocaleSwitch />
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("Projects")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fr" } });
    expect(screen.getByText("Projets")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("fr");
    expect(document.cookie).toContain("kryova-locale=fr");
  });

  it("reads English with no provider rather than throwing", () => {
    render(<Probe />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("starts in the language the server chose", () => {
    render(
      <LocaleProvider initialLocale="fr">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("Projets")).toBeInTheDocument();
  });
});
