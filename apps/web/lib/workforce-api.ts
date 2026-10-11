export class WorkforceRequestError extends Error {
  constructor(message: string, public code?: string) { super(message); }
}

export async function workforceRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => null) as {
    success?: boolean; data?: T; error?: string | { message?: string; code?: string };
  } | null;
  if (!response.ok || body?.success === false || body?.data === undefined) {
    const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new WorkforceRequestError(detail || "We couldn't load this information. Please try again.", typeof body?.error === "object" ? body.error.code : undefined);
  }
  return body.data;
}
