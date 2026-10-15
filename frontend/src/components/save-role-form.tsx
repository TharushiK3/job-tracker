import { useState } from "react";

type SaveRoleFormProps = {
  onSave: (company: string, jobTitle: string) => void;
};

export default function SaveRoleForm({ onSave }: SaveRoleFormProps) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function handleSubmit(form: HTMLFormElement) {
    const formData = new FormData(form);
    const company = String(formData.get("company") ?? "").trim();
    const jobTitle = String(formData.get("jobTitle") ?? "").trim();

    if (!company || !jobTitle) {
      setError("Enter a company name and job title containing text.");
      setNotice("");

      const field = form.elements.namedItem(!company ? "company" : "jobTitle");

      if (field instanceof HTMLInputElement) {
        field.focus();
      }

      return;
    }

    onSave(company, jobTitle);
    form.reset();
    setError("");
    setNotice(`Saved ${jobTitle} at ${company}.`);
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
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit(event.currentTarget);
        }}
        onInput={() => {
          setError("");
          setNotice("");
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
            id="company"
            name="company"
            type="text"
            autoComplete="off"
            required
            maxLength={120}
            aria-describedby={error ? "save-role-error" : undefined}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-700"
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
            maxLength={160}
            aria-describedby={error ? "save-role-error" : undefined}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-700"
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
            className="rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
          >
            Save role
          </button>
        </div>
      </form>

      <p role="status" className="mt-3 min-h-5 text-sm text-teal-700">
        {notice}
      </p>
    </section>
  );
}
