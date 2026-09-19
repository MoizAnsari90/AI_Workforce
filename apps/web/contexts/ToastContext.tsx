"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          const typeColors = {
            success: "border-emerald-500/50 bg-slate-900/95 text-emerald-300 shadow-emerald-500/20",
            error: "border-red-500/50 bg-slate-900/95 text-red-300 shadow-red-500/20",
            warning: "border-amber-500/50 bg-slate-900/95 text-amber-300 shadow-amber-500/20",
            info: "border-cyan-500/50 bg-slate-900/95 text-cyan-300 shadow-cyan-500/20",
          }[toast.type];

          const typeIcons = {
            success: "✅",
            error: "❌",
            warning: "⚠️",
            info: "✦",
          }[toast.type];

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto p-4 rounded-xl border backdrop-blur-md shadow-2xl flex items-start gap-3 transition-all duration-300 animate-in fade-in slide-in-from-top-2 ${typeColors}`}
            >
              <span className="text-base">{typeIcons}</span>
              <div className="flex-1 text-xs">
                {toast.title && <div className="font-semibold text-white mb-0.5">{toast.title}</div>}
                <div className="leading-relaxed">{toast.message}</div>
              </div>
              <button
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-white text-xs ml-1"
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
