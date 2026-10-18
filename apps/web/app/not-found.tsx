"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { LanguageControl } from "@/components/language-control";
import { AppearanceControl } from "@/components/appearance-control";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="wf-error-page">
      <LanguageControl /><AppearanceControl />
      <h2>{t("404 - Page Not Found")}</h2>
      <p>{t("The page you are looking for does not exist.")}</p>
      <a
        href="/"
        className="wf-error-action"
      >
         {t("Return to home")} </a>
    </div>
  );
}
