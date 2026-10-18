import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/applications-api";

type SaveRoleFormProps = {
  disabled?: boolean;
  onSave: (company: string, jobTitle: string) => Promise<void>;
};

export default function SaveRoleForm({
  disabled = false,
  onSave,
}: SaveRoleFormProps) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidField, setInvalidField] = useState<
    "company" | "jobTitle" | null
  >(null);
  const focusAfterSave = useRef(false);
  const submittingRef = useRef(false);
  const companyRef = useRef<HTMLInputElement>(null);
  const busy = disabled || isSubmitting;

  useEffect(() => {
    if (notice && !busy && focusAfterSave.current) {
      companyRef.current?.focus();
      focusAfterSave.current = false;
    }
  }, [notice, busy]);

  async function handleSubmit(form: HTMLFormElement) {
    if (submittingRef.current || disabled) return;

    const formData = new FormData(form);
    const company = String(formData.get("company") ?? "").trim();
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();

    if (!company || !jobTitle) {
      setError("Enter a company name and job title containing text.");
      setNotice("");
      setInvalidField(!company ? "company" : "jobTitle");

      const field = form.elements.namedItem(!company ? "company" : "jobTitle");
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }

    submittingRef.current = true;
    focusAfterSave.current = false;
    setInvalidField(null);
    setIsSubmitting(true);
    setError("");
    setNotice("");

    try {
      await onSave(company, jobTitle);
      form.reset();
      focusAfterSave.current = true;
      setNotice("Saved " + jobTitle + " at " + company + ".");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <section
      aria-labelledby="save-role-heading"
      className="rounded-2xl border border-slate-200 bg-white p-6"
    >
      <h2 id="save-role-heading" className="text-lg font-semibold">
        Save a role
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        Keep an opportunity you want to apply for.
      </p>

      <form
        className="mt-5 grid gap-4 sm:grid-cols-2"
        aria-busy={isSubmitting}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit(event.currentTarget);
        }}
        onInput={() => {
          setError("");
          setNotice("");
          setInvalidField(null);
        }}
      >
        <div>
          <label
            htmlFor="company"
            className="block text-sm font-medium text-slate-700"
          >
            Company
          </label>
          <input
            ref={companyRef}
            id="company"
            name="company"
            type="text"
            autoComplete="off"
            required
            maxLength={200}
            disabled={busy}
            aria-invalid={invalidField === "company" ? true : undefined}
            aria-describedby={error ? "save-role-error" : undefined}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          />
        </div>

        <div>
          <label
            htmlFor="jobTitle"
            className="block text-sm font-medium text-slate-700"
          >
            Job title
          </label>
          <input
            id="jobTitle"
            name="jobTitle"
            type="text"
            autoComplete="off"
            required
            maxLength={200}
            disabled={busy}
            aria-invalid={invalidField === "jobTitle" ? true : undefined}
            aria-describedby={error ? "save-role-error" : undefined}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          />
        </div>

        {error && (
          <p
            id="save-role-error"
            role="alert"
            className="text-sm text-red-700 sm:col-span-2"
          >
            {error}
          </p>
        )}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : "Save role"}
          </button>
        </div>
      </form>

      <p role="status" className="mt-3 min-h-5 text-sm text-teal-700">
        {notice}
      </p>
    </section>
  );
}
