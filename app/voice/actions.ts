"use server";

import { revalidatePath } from "next/cache";
import { requireFounder } from "@/lib/auth/dal";
import { MAX_EXAMPLE_LENGTH } from "@/lib/domain/examples";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ActionState = { error?: string; message?: string };

/** A founder shares a piece of their own writing as an example of their voice. */
export async function shareExampleAction(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireFounder();
  const body = String(form.get("body") ?? "").trim();
  if (!body) return { error: "Paste the text you want to share." };
  if (body.length > MAX_EXAMPLE_LENGTH) return { error: "Keep an example under 10,000 characters." };
  const supabase = await createSupabaseServerClient();
  // Row-level security returns only the signed-in founder's own record.
  const { data: founder } = await supabase.from("founders").select("id").maybeSingle();
  if (!founder) return { error: "Your profile isn't linked yet. Ask the admin." };
  const { data, error } = await supabase.rpc("add_writing_examples", {
    p_founder_id: founder.id,
    p_items: [{ kind: "approved_example", body }],
  });
  if (error) return { error: "It could not be shared. Try again." };
  revalidatePath("/voice");
  return (data as { added: number }).added
    ? { message: "Thanks. It's now one of your voice examples." }
    : { message: "You've already shared this one." };
}
