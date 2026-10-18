"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { CircleCheck, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { useTranslation } from '@/contexts/LanguageContext';

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  title?: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, title?: string) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  showToast: () => {},
  removeToast: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = "info", title?: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const newToast: Toast = { id, message, type, title };
    setToasts((prev) => [...prev, newToast]);

    setTimeout(() => {
      removeToast(id);
    }, 4500);
  }, [removeToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, removeToast }}>
      {children}
      {/* Toast Render Container */}
      <div className="fixed top-5 end-5 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const Icon = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert, info: Info }[toast.type];

          return (
            <div
              key={toast.id}
              role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
              className={`wf-toast wf-toast-${toast.type} pointer-events-auto p-4 rounded-xl border shadow-2xl flex items-start gap-3`}
            >
              <Icon className="wf-toast-icon shrink-0" size={19} aria-hidden="true" />
              <div className="flex-1 text-xs">
                <div className="font-semibold mb-0.5">{t(toast.title || { success: "Success", error: "Error", warning: "Warning", info: "Information" }[toast.type])}</div>
                <div className="leading-relaxed">{t(toast.message)}</div>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="wf-toast-close text-xs ml-1"
                aria-label={t("Dismiss notification")}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
