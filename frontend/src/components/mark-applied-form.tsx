import { useRef, useState } from "react";

type MarkAppliedFormProps = {
  applicationId: string;
  company: string;
  jobTitle: string;
  canApply: boolean;
  onApply: (appliedOn: string) => void;
};

function getLocalToday() {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export default function MarkAppliedForm({
  applicationId,
  company,
  jobTitle,
  canApply,
  onApply,
}: MarkAppliedFormProps) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const confirmationRef = useRef<HTMLParagraphElement>(null);

  const dateId = `applied-on-${applicationId}`;
  const errorId = `${dateId}-error`;

  function handleSubmit(form: HTMLFormElement) {
    const formData = new FormData(form);
    const appliedOn = String(formData.get("appliedOn") ?? "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(appliedOn) || appliedOn > getLocalToday()) {
      setError("Choose an application date that is today or earlier.");

      const dateInput = form.elements.namedItem("appliedOn");

      if (dateInput instanceof HTMLInputElement) {
        dateInput.focus();
      }

      return;
    }

    onApply(appliedOn);
    setError("");
    setNotice("Application recorded.");
    confirmationRef.current?.focus();
  }

  return (
    <div className="min-w-48">
      {canApply && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit(event.currentTarget);
          }}
          onInput={() => setError("")}
        >
          <label
            htmlFor={dateId}
            className="block text-xs font-medium text-slate-700"
          >
            Applied on
            <span className="sr-only">
              {" "}
              for {jobTitle} at {company}
            </span>
          </label>

          <input
            id={dateId}
            name="appliedOn"
            type="date"
            required
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-700"
          />

          {error && (
            <p id={errorId} role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
          >
            Mark as applied
          </button>
        </form>
      )}

      {!canApply && !notice && (
        <span className="text-sm text-slate-500">—</span>
      )}

      <p
        ref={confirmationRef}
        tabIndex={-1}
        role="status"
        className="mt-2 rounded text-sm text-teal-700 focus:outline-2 focus:outline-offset-2 focus:outline-teal-700"
      >
        {notice}
      </p>
    </div>
  );
}
