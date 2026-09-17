import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(req: Request, props: { params: Promise<{ path: string }> }) {
  const params = await props.params;
  return handleProxy(req, [params.path], "GET");
}

export async function POST(req: Request, props: { params: Promise<{ path: string }> }) {
  const params = await props.params;
  return handleProxy(req, [params.path], "POST");
}

export async function PUT(req: Request, props: { params: Promise<{ path: string }> }) {
  const params = await props.params;
  return handleProxy(req, [params.path], "PUT");
}

export async function DELETE(req: Request, props: { params: Promise<{ path: string }> }) {
  const params = await props.params;
  return handleProxy(req, [params.path], "DELETE");
}

async function handleProxy(req: Request, pathSegments: string[], method: string) {
  try {
    const path = pathSegments.join("/");
    const url = new URL(req.url);
    const searchParams = url.searchParams.toString();
    const targetUrl = `http://localhost:3001/api/v1/${path}${searchParams ? `?${searchParams}` : ""}`;

    const cookieStore = await cookies();
    const token = cookieStore.get("token")?.value;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    let body: any = undefined;
    if (method !== "GET" && method !== "HEAD") {
      body = await req.text();
    }

    const response = await fetch(targetUrl, {
      method,
      headers,
      body,
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return new NextResponse(typeof data === "string" ? data : JSON.stringify(data), {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: { message: error.message || "Proxy Error" } },
      { status: 500 }
    );
  }
}
