import { useRef, useState } from "react";
import { errorMessage, type JobApplication } from "@/lib/applications-api";

type RestoreRoleButtonProps = {
  application: JobApplication;
  disabled: boolean;
  onRestore: () => Promise<void>;
};

export default function RestoreRoleButton({
  application,
  disabled,
  onRestore,
}: RestoreRoleButtonProps) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function handleRestore() {
    if (submittingRef.current || disabled) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await onRestore();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-w-48 space-y-2" aria-busy={isSubmitting}>
      <button
        type="button"
        disabled={disabled || isSubmitting}
        onClick={() => {
          void handleRestore();
        }}
        className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSubmitting ? "Restoring..." : "Restore"}
        <span className="sr-only">
          {" "}
          {application.jobTitle} at {application.company}
        </span>
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
