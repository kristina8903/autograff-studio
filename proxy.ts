import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { isPublicPath } from "@/lib/domain/access";
import { EnvConfigError, publicEnv, type PublicEnv } from "@/lib/env";

/**
 * Runs before every page request:
 *  1. refreshes the Supabase session cookie;
 *  2. sends requests without a session to /sign-in (public paths excepted);
 *  3. sets security headers, including a per-request CSP nonce.
 *
 * This is a convenience layer, not the boundary: every page, Server Action and
 * Route Handler re-verifies the user (lib/auth/dal.ts), and the database
 * enforces row-level security regardless (docs/SECURITY.md §4).
 */
export async function proxy(request: NextRequest) {
  let env: PublicEnv;
  try {
    env = publicEnv();
  } catch (error) {
    if (!(error instanceof EnvConfigError)) throw error;
    // Names the bad settings (never their values) instead of a bare 500.
    console.error(error.message);
    return new NextResponse(
      [
        "Content Studio is not configured correctly.",
        "",
        ...error.problems.map((problem) => `- ${problem}`),
        "",
        "Fix these in the hosting provider's environment variables, then redeploy.",
      ].join("\n"),
      { status: 500, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } },
    );
  }
  const pendingCookies: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const pendingHeaders: Record<string, string> = {};

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const cookie of cookiesToSet) {
          request.cookies.set(cookie.name, cookie.value);
          pendingCookies.push(cookie);
        }
        Object.assign(pendingHeaders, headers);
      },
    },
  });
  // Verifies the token and refreshes it if needed; do not put code between
  // client creation and this call.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);

  const { pathname } = request.nextUrl;
  let response: NextResponse;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  if (!signedIn && !isPublicPath(pathname)) {
    response = NextResponse.redirect(new URL("/sign-in", request.url));
  } else {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  for (const { name, value, options } of pendingCookies) {
    response.cookies.set(name, value, options);
  }
  for (const [key, value] of Object.entries(pendingHeaders)) {
    response.headers.set(key, value);
  }
  applySecurityHeaders(response, csp);
  return response;
}

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isHttps() ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, csp: string) {
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // Every page is private and per-user: never store it in a shared or browser cache.
  response.headers.set("Cache-Control", "private, no-store");
  if (isHttps()) {
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}

// HTTPS-only headers follow the app URL, so a production build served over
// plain-HTTP localhost (end-to-end tests) still works.
function isHttps() {
  return publicEnv().NEXT_PUBLIC_APP_URL.startsWith("https://");
}

export const config = {
  // Everything except Next's static assets and image optimizer.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
