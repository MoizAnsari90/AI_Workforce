"use client";
import { useTranslation } from "@/contexts/LanguageContext";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun, X } from "lucide-react";
import { useAppearance } from "@/contexts/AppearanceContext";
import { DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";

export function AppearanceControl() {
  const { t } = useTranslation();
  const { preferences, resolvedTheme, mounted, update } = useAppearance();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 70 });
  const id = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstField = useRef<HTMLSelectElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const Icon = !mounted || preferences.theme === "system" ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      if (!anchor || !panel.current) return;
      const width = panel.current.offsetWidth;
      const height = panel.current.offsetHeight;
      setPosition({ left: Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16)), top: Math.max(16, Math.min(anchor.bottom + 10, window.innerHeight - height - 16)) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    firstField.current?.focus();
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() { setOpen(false); trigger.current?.focus(); }

  return <div className="wf-appearance" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button ref={trigger} type="button" disabled={!mounted} className="wf-appearance-trigger" aria-label={t("Appearance settings")} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(value => !value)}>
      <Icon size={17} aria-hidden="true" /><span>{t("Appearance")}</span>
    </button>
    {open && <div ref={panel} id={`${id}-panel`} role="dialog" aria-labelledby={`${id}-title`} className="wf-appearance-panel" style={position}>
      <div className="wf-appearance-heading"><strong id={`${id}-title`}>{t("Appearance")}</strong><button type="button" className="wf-appearance-close" aria-label={t("Close appearance settings")} onClick={close}><X size={16} aria-hidden="true" /></button></div>
      <label htmlFor={`${id}-theme`}>{t("Theme")}</label>
      <select ref={firstField} id={`${id}-theme`} value={preferences.theme} onChange={event => update({ theme: event.target.value as Appearance["theme"] })}>
        <option value="system">{t("System — follow device")}</option><option value="light">{t("Light")}</option><option value="dark">{t("Dark")}</option>
      </select>
      <label htmlFor={`${id}-palette`}>{t("Color palette")}</label>
      <select id={`${id}-palette`} value={preferences.palette} onChange={event => update({ palette: event.target.value as Appearance["palette"] })}>
        <option value="standard">{t("Standard")}</option><option value="accessible">{t("Color-blind friendly")}</option>
      </select>
      <label className="wf-appearance-contrast" htmlFor={`${id}-contrast`}><input id={`${id}-contrast`} type="checkbox" checked={preferences.contrast === "high"} onChange={event => update({ contrast: event.target.checked ? "high" : "standard" })} /><span>{t("High contrast")}</span></label>
      <p>{t("Adjust colors and contrast independently. Your choices apply across this site on this browser.")}</p>
      <button type="button" className="wf-appearance-reset" onClick={() => update(DEFAULT_APPEARANCE)}>{t("Reset appearance")}</button>
    </div>}
  </div>;
}
