"use client";

import { useActionState, useLayoutEffect, useRef } from "react";

type Refusable = { error?: string; errors?: Record<string, string> };

const SKIPPED = new Set(["hidden", "file", "submit", "button", "reset", "image", "password"]);

/** A refused save returns an error, or field errors. */
export function refused(state: Refusable): boolean {
  return Boolean(state.error) || Object.keys(state.errors ?? {}).length > 0;
}

/**
 * Puts what was submitted back into the form's fields. Hidden and file inputs
 * are left alone (React does not reset them), and passwords are never kept.
 */
export function restoreForm(form: HTMLFormElement, data: FormData) {
  const seen = new Map<string, number>();
  for (const element of Array.from(form.elements)) {
    if (!(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement ||
      element instanceof HTMLSelectElement
    ))
      continue;
    if (!element.name || element.disabled) continue;
    if (element instanceof HTMLInputElement && SKIPPED.has(element.type)) continue;
    const values = data.getAll(element.name).map(String);
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
      element.checked = values.includes(element.value);
    } else if (element instanceof HTMLSelectElement && element.multiple) {
      for (const option of Array.from(element.options)) option.selected = values.includes(option.value);
    } else {
      // Fields sharing a name are filled in order.
      const index = seen.get(element.name) ?? 0;
      seen.set(element.name, index + 1);
      element.value = values[index] ?? "";
    }
  }
}

/**
 * useActionState that keeps what was typed when a save is refused. React
 * resets a form after its action runs, which would throw away everything the
 * person typed or pasted just because one field needs fixing. After a refused
 * save, the submitted values are put back; after a successful one, the form
 * resets as usual (so, for example, a comment box clears).
 *
 * Put the returned ref on the form.
 */
export function useKeptActionState<S extends Refusable>(action: (state: S, form: FormData) => Promise<S>, initial: S) {
  const formRef = useRef<HTMLFormElement>(null);
  const kept = useRef<FormData | null>(null);
  const [state, dispatch, pending] = useActionState<S, FormData>(
    async (previous, data) => {
      const result = await action(previous, data);
      kept.current = refused(result) ? data : null;
      return result;
    },
    // S is a plain object type, never a promise, so Awaited<S> is S.
    initial as Awaited<S>,
  );

  // React resets the form while committing the action's result, before layout
  // effects run, so restoring here undoes the reset before anything is painted.
  useLayoutEffect(() => {
    const data = kept.current;
    kept.current = null;
    if (data && formRef.current) restoreForm(formRef.current, data);
  }, [state]);

  return [state, dispatch, pending, formRef] as const;
}
