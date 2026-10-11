import { Layers3, MessageCircle, ShoppingBag } from "lucide-react";

export function WorkforceMark({ small = false }: { small?: boolean }) {
  return <span className={`wf-mark${small ? " wf-mark-small" : ""}`} aria-hidden="true"><Layers3 size={small ? 18 : 23} strokeWidth={1.6} /></span>;
}

export function ProviderMark({ provider }: { provider: "shopify" | "woocommerce" | "whatsapp" }) {
  return <span className={`wf-provider-mark wf-provider-${provider}`} aria-hidden="true">
    {provider === "shopify" ? <ShoppingBag size={26} strokeWidth={1.7} /> : provider === "whatsapp" ? <MessageCircle size={27} strokeWidth={1.7} /> : <span>woo</span>}
  </span>;
}
