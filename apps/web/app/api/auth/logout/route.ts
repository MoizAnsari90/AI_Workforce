import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendUrl } from "@/lib/backend-url";
import { isSameOriginRequest } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ success: false }, { status: 403 });
  const cookieStore = await cookies();
  const token = cookieStore.get("token")?.value;
  if (token) {
    try {
      const response = await fetch(backendUrl('/api/v1/auth/logout'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok && response.status !== 401) {
        return NextResponse.json({ success: false }, { status: 502 });
      }
    } catch {
      return NextResponse.json({ success: false }, { status: 502 });
    }
  }
  cookieStore.delete("token");
  return new NextResponse(null, { status: 204 });
}
