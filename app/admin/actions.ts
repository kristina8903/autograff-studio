"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";
import { parseFounderForm, type FieldErrors } from "@/lib/domain/founders";
import { deactivateUser, inviteFounder } from "@/lib/server/admin/users";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type FounderFormState = { errors?: FieldErrors; error?: string; saved?: boolean };
export type SimpleState = { error?: string; ok?: boolean };

// All writes below run as the signed-in admin, under row-level security.

export async function createFounder(_state: FounderFormState, form: FormData): Promise<FounderFormState> {
  const admin = await requireAdmin();
  const parsed = parseFounderForm(form);
  if (!parsed.ok) return { errors: parsed.errors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("founders")
    .insert({ ...parsed.data, company_id: admin.companyId, created_by: admin.userId })
    .select("id")
    .single();
  if (error || !data) return { error: "The founder could not be saved." };
  revalidatePath("/admin");
  redirect(`/admin/founders/${data.id}`);
}

export async function updateFounder(_state: FounderFormState, form: FormData): Promise<FounderFormState> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const parsed = parseFounderForm(form);
  if (!parsed.ok) return { errors: parsed.errors };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("founders").update(parsed.data).eq("id", id).select("id");
  if (error || !data?.length) return { error: "The founder could not be saved." };
  revalidatePath("/admin");
  revalidatePath(`/admin/founders/${id}`);
  return { saved: true };
}

export async function inviteFounderAction(_state: SimpleState, form: FormData): Promise<SimpleState> {
  const founderId = String(form.get("founder_id") ?? "");
  const result = await inviteFounder(founderId, String(form.get("email") ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  revalidatePath(`/admin/founders/${founderId}`);
  return { ok: true };
}

export async function deactivateUserAction(_state: SimpleState, form: FormData): Promise<SimpleState> {
  const result = await deactivateUser(String(form.get("user_id") ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin");
  return { ok: true };
}
