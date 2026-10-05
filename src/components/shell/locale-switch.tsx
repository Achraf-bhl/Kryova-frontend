"use client";

import { LOCALES, LOCALE_NAME, isLocale } from "@/lib/i18n/catalogue";
import { useLocale } from "@/lib/i18n/locale-context";

/** A small language picker (ROAD_TO_10 8.6). The choice is remembered in a cookie. */
export function LocaleSwitch({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  return (
    <select
      value={locale}
      aria-label={t("locale.label")}
      title={t("locale.label")}
      onChange={(event) => {
        if (isLocale(event.target.value)) setLocale(event.target.value);
      }}
      className={`rounded-sm border border-border bg-surface px-1 py-0.5 text-xs text-muted ${className}`}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_NAME[code]}
        </option>
      ))}
    </select>
  );
}
