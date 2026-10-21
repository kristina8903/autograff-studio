import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDueGenerations } from "@/lib/server/admin/generation";
import { serverEnv } from "@/lib/server/env";

// Vercel Cron calls this every minute with "Authorization: Bearer <CRON_SECRET>".
// It picks up runs that were not started right after their request (a retry
// that is due, or a run whose first attempt was interrupted).
export const maxDuration = 300;

function authorized(header: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  const secret = serverEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorized(request.headers.get("authorization"), secret))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const outcomes = await runDueGenerations();
  // Ids and statuses only; never prompts or outputs.
  return NextResponse.json({ processed: outcomes.map(({ runId, status }) => ({ runId, status })) });
}
