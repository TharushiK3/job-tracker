import { useEffect, useId, useRef, useState } from "react";
import {
  ApiError,
  type ApplicationStage,
  type ApplicationStageChange,
  errorMessage,
  isApplicationStage,
  type JobApplication,
} from "@/lib/applications-api";

const stageLabels: Record<ApplicationStage, string> = {
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

type UpdateStageFormProps = {
  original: JobApplication;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (changes: ApplicationStageChange) => Promise<void>;
};

export default function UpdateStageForm({
  original,
  disabled,
  onCancel,
  onSubmit,
}: UpdateStageFormProps) {
  const [stage, setStage] = useState<ApplicationStage>(
    original.status === "saved" ? "applied" : original.status,
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const selectRef = useRef<HTMLSelectElement>(null);
  const prefix = useId();
  const selectId = `${prefix}-stage`;
  const hintId = `${prefix}-hint`;
  const errorId = `${prefix}-error`;
  const busy = disabled || isSubmitting;

  useEffect(() => {
    selectRef.current?.focus();
  }, []);

  async function handleSubmit() {
    if (submittingRef.current || disabled) return;
    if (original.status === "saved") {
      setError("Use Mark as applied to record an application date first.");
      return;
    }
    if (stage === original.status) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await onSubmit({ status: stage, expectedStatus: original.status });
    } catch (failure) {
      const message = errorMessage(failure);
      setError(
        failure instanceof ApiError && failure.status === 409
          ? `${message} Cancel this form and reopen Change stage after refreshing.`
          : message,
      );
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-slate-200 bg-slate-50 p-4"
      aria-busy={isSubmitting}
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-slate-950">
          Update application stage
          <span className="sr-only">
            {" "}
            for {original.jobTitle} at {original.company}
          </span>
        </legend>
        <p id={hintId} className="text-sm text-slate-600">
          Choose the current stage. Your application date stays the same.
        </p>
        <div>
          <label
            htmlFor={selectId}
            className="block text-xs font-medium text-slate-700"
          >
            Stage
          </label>
          <select
            ref={selectRef}
            id={selectId}
            name="status"
            value={stage}
            disabled={busy}
            aria-describedby={error ? `${hintId} ${errorId}` : hintId}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (isApplicationStage(value)) setStage(value);
              setError("");
            }}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          >
            {Object.entries(stageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy || stage === original.status}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save stage"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
