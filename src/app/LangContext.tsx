import { createContext, useContext } from "react";
import type { Lang, Translations } from "./i18n";
import { useT } from "./i18n";

const LangContext = createContext<Lang>("en");

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): { lang: Lang; t: Translations } {
  const lang = useContext(LangContext);
  return { lang, t: useT(lang) };
}
