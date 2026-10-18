import { useEffect, useRef, useState } from "react";
import { errorMessage, isCalendarDate } from "@/lib/applications-api";

type MarkAppliedFormProps = {
  applicationId: string;
  company: string;
  jobTitle: string;
  canApply: boolean;
  disabled?: boolean;
  onApply: (appliedOn: string) => Promise<void>;
};

function getLocalToday() {
  const today = new Date();
  const year = String(today.getFullYear()).padStart(4, "0");
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function MarkAppliedForm({
  applicationId,
  company,
  jobTitle,
  canApply,
  disabled = false,
  onApply,
}: MarkAppliedFormProps) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invalidDate, setInvalidDate] = useState(false);
  const submittingRef = useRef(false);
  const confirmationRef = useRef<HTMLParagraphElement>(null);
  const dateId = `applied-on-${applicationId}`;
  const errorId = `${dateId}-error`;
  const busy = disabled || isSubmitting;

  useEffect(() => {
    if (notice) confirmationRef.current?.focus();
  }, [notice]);

  async function handleSubmit(form: HTMLFormElement) {
    if (submittingRef.current || disabled || !canApply) return;

    const appliedOn = String(new FormData(form).get("appliedOn") ?? "");
    if (!isCalendarDate(appliedOn) || appliedOn > getLocalToday()) {
      setError("Choose a valid application date that is today or earlier.");
      setNotice("");
      setInvalidDate(true);

      const field = form.elements.namedItem("appliedOn");
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }

    submittingRef.current = true;
    setInvalidDate(false);
    setIsSubmitting(true);
    setError("");
    setNotice("");

    try {
      await onApply(appliedOn);
      setNotice("Application recorded.");
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-w-48">
      {canApply && (
        <form
          className="space-y-2"
          aria-busy={isSubmitting}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit(event.currentTarget);
          }}
          onInput={() => {
            setError("");
            setNotice("");
            setInvalidDate(false);
          }}
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
            disabled={busy}
            onFocus={(event) => {
              event.currentTarget.max = getLocalToday();
            }}
            aria-invalid={invalidDate ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          />

          {error && (
            <p id={errorId} role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? "Recording..." : "Mark as applied"}
          </button>
        </form>
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
