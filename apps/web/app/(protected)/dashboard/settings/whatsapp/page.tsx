"use client";

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useAuth } from "@/contexts/AuthContext.hooks";
import { useToast } from "@/contexts/ToastContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const whatsAppConfigSchema = z.object({
  supportPhoneNumberId: z.string().min(1, "Phone Number ID is required"),
  supportAccessToken: z.string().min(1, "WhatsApp API Access Token is required"),
  brandVoiceGuide: z.string().optional(),
  industry: z.string().optional(),
});

export default function WhatsAppSettingsPage() {
  const { user, tenant } = useAuth();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const form = useForm<z.infer<typeof whatsAppConfigSchema>>({
    resolver: zodResolver(whatsAppConfigSchema),
    defaultValues: {
      supportPhoneNumberId: "",
      supportAccessToken: "",
      brandVoiceGuide: "",
      industry: "",
    },
  });

  useEffect(() => {
    const fetchSettings = async () => {
      const tenantId = user?.tenantId || tenant?.id;
      if (!tenantId) {
        showToast("Workspace context missing. Please re-login.", "warning", "Session Expired");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/proxy/tenants/${tenantId}/support-config`);
        const json = await res.json();
        if (res.ok && json.data) {
          form.reset({
            supportPhoneNumberId: json.data.hasPhoneNumberId ? "******" : "",
            supportAccessToken: json.data.hasSupportAccessToken ? "******" : "",
            brandVoiceGuide: json.data.brandVoiceGuide || "",
            industry: json.data.industry || "",
          });
        } else {
          showToast(json.error?.message || "Failed to load settings", "error", "Load Error");
        }
      } catch (err: any) {
        console.error("Error fetching settings:", err);
        showToast(err.message || "Network error loading settings", "error", "Network Error");
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, [user?.tenantId, tenant?.id, form, showToast]);

  const onSubmit = async (values: z.infer<typeof whatsAppConfigSchema>) => {
    const tenantId = user?.tenantId || tenant?.id;
    if (!tenantId) {
      showToast("Workspace context missing. Please re-login.", "warning", "Session Expired");
      return;
    }
    setIsSaving(true);
    try {
      const payload: any = {
        brandVoiceGuide: values.brandVoiceGuide,
        industry: values.industry,
      };
      if (values.supportPhoneNumberId !== "******") {
        payload.supportPhoneNumberId = values.supportPhoneNumberId;
      }
      if (values.supportAccessToken !== "******") {
        payload.supportAccessToken = values.supportAccessToken;
      }

      const res = await fetch(`/api/proxy/tenants/${tenantId}/support-config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        showToast("WhatsApp settings saved successfully!", "success", "Settings Saved");
      } else {
        showToast(json.error?.message || "Failed to save settings", "error", "Save Error");
      }
    } catch (err: any) {
      console.error("Error saving settings:", err);
      showToast(err.message || "Network error saving settings", "error", "Network Error");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto text-slate-100">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white font-serif">WhatsApp Integration Settings</h1>
        <p className="text-slate-400 text-sm mt-1">Configure your WhatsApp Business API credentials and support preferences.</p>
      </div>

      <Card className="border-slate-800 bg-slate-900/60 backdrop-blur text-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-lg font-bold text-white">WhatsApp Configuration</CardTitle>
          <CardDescription className="text-xs text-slate-400">Enter your Meta App details to enable WhatsApp communication.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="supportPhoneNumberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Phone Number ID</FormLabel>
                    <FormControl>
                      <Input placeholder="104928392019283" className="h-11 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="supportAccessToken"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">API Access Token</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="EAABwz..." className="h-11 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brandVoiceGuide"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Brand Voice Guide</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Friendly, helpful, professional" className="h-11 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="industry"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Industry</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Ecommerce, SaaS" className="h-11 bg-slate-900/80 border-slate-800 text-white placeholder:text-slate-600 focus:border-cyan-500" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="pt-4 flex justify-end">
                <Button
                  type="submit"
                  disabled={loading || isSaving}
                  className="w-fit px-6 h-10 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold shadow-lg glow-cyan rounded-xl transition-all"
                >
                  {isSaving ? "Saving..." : "Save Settings"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
