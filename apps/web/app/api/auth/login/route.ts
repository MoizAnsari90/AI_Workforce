import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { backendUrl } from "@/lib/backend-url";
import { isSameOriginRequest } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ success: false }, { status: 403 });
  try {
    const body = await req.json();
    const response = await fetch(backendUrl('/api/v1/auth/login'), {
      cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      return NextResponse.json(data, { status: response.status });
    }

    const { token, user, tenant } = data.data;

    const cookieStore = await cookies();
    cookieStore.set("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24, // 1 day
    });

    return NextResponse.json({ success: true, data: { user, tenant } });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { message: error.message || "Internal Server Error" } },
      { status: 500 }
    );
  }
}
