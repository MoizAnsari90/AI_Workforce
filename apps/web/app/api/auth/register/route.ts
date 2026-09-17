import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const response = await fetch("http://localhost:3001/api/v1/auth/register", {
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
