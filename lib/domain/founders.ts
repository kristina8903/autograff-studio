import { z } from "zod";

// Mirrors the constraints on public.founders, so the form reports problems
// before the database rejects them.
export const LINKEDIN_PROFILE_URL = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/in\/[^/?#\s]+\/?$/;

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone.includes("/") || zone === "UTC";
  } catch {
    return false;
  }
}

export const founderInputSchema = z.object({
  role_title: z.string().trim().min(1, "Enter a role, for example CEO.").max(60, "Keep the role under 60 characters."),
  display_name: z.string().trim().min(1, "Enter a name.").max(120, "Keep the name under 120 characters."),
  linkedin_profile_url: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === null || LINKEDIN_PROFILE_URL.test(value),
      "Use a profile URL like https://www.linkedin.com/in/name",
    ),
  timezone: z.string().trim().refine(isValidTimeZone, "Choose a valid time zone."),
});

export type FounderInput = z.infer<typeof founderInputSchema>;

export type FieldErrors = Partial<Record<keyof FounderInput, string>>;

export function parseFounderForm(
  form: FormData,
): { ok: true; data: FounderInput } | { ok: false; errors: FieldErrors } {
  const result = founderInputSchema.safeParse({
    role_title: form.get("role_title") ?? "",
    display_name: form.get("display_name") ?? "",
    linkedin_profile_url: form.get("linkedin_profile_url") ?? "",
    timezone: form.get("timezone") ?? "",
  });
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0] as keyof FounderInput;
    errors[key] ??= issue.message;
  }
  return { ok: false, errors };
}

/** Common zones first; the full list follows. */
export const COMMON_TIME_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "UTC",
];
