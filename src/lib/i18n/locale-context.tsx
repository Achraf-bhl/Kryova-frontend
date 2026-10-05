"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  translate,
  type Locale,
  type MessageKey,
} from "@/lib/i18n/catalogue";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

interface LocaleValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
}

const defaultValue: LocaleValue = {
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
};

// With no provider (a test, a standalone render) the interface reads English rather than
// throwing: a missing provider must not be why a button is blank.
const LocaleContext = createContext<LocaleValue>(defaultValue);

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Chosen on the server from the cookie and `Accept-Language`, so first paint is already right. */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${ONE_YEAR_S}; SameSite=Lax`;
  }, []);

  const value = useMemo<LocaleValue>(
    () => ({ locale, setLocale, t: (key, params) => translate(locale, key, params) }),
    [locale, setLocale],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleValue {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  return useContext(LocaleContext).t;
}
