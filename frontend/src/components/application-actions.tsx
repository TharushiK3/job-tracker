import { useEffect, useId, useRef, useState } from "react";
import MarkAppliedForm from "@/components/mark-applied-form";
import UpdateStageForm from "@/components/update-stage-form";
import {
  type ApplicationEdits,
  type ApplicationStageChange,
  errorMessage,
  type JobApplication,
} from "@/lib/applications-api";

type ApplicationActionsProps = {
  application: JobApplication;
  disabled: boolean;
  onEdit: (changes: ApplicationEdits) => Promise<void>;
  onArchive: () => Promise<void>;
  onApply: (appliedOn: string) => Promise<void>;
  onStageChange: (changes: ApplicationStageChange) => Promise<void>;
};

type Panel = {
  kind: "edit" | "archive" | "stage";
  original: JobApplication;
};

const secondaryButton =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50";

export default function ApplicationActions({
  application,
  disabled,
  onEdit,
  onArchive,
  onApply,
  onStageChange,
}: ApplicationActionsProps) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notice, setNotice] = useState("");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const stageButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<Panel["kind"] | null>(null);
  const prefix = useId();
  const editPanelId = `${prefix}-edit`;
  const archivePanelId = `${prefix}-archive`;
  const stagePanelId = `${prefix}-stage`;

  useEffect(() => {
    if (panel === null && !disabled && restoreFocus.current) {
      const button =
        restoreFocus.current === "edit"
          ? editButtonRef.current
          : restoreFocus.current === "stage"
            ? stageButtonRef.current
            : archiveButtonRef.current;
      button?.focus();
      restoreFocus.current = null;
    }
  }, [panel, disabled]);

  function closePanel(target: Panel["kind"]) {
    restoreFocus.current = target;
    setPanel(null);
  }

  return (
    <div className="min-w-64 max-w-sm space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          ref={editButtonRef}
          type="button"
          disabled={disabled || panel !== null}
          aria-expanded={panel?.kind === "edit"}
          aria-controls={editPanelId}
          onClick={() => {
            setNotice("");
            setPanel({ kind: "edit", original: application });
          }}
          className={secondaryButton}
        >
          Edit
          <span className="sr-only">
            {" "}
            {application.jobTitle} at {application.company}
          </span>
        </button>
        {application.status !== "saved" && (
          <button
            ref={stageButtonRef}
            type="button"
            disabled={disabled || panel !== null}
            aria-expanded={panel?.kind === "stage"}
            aria-controls={stagePanelId}
            onClick={() => {
              setNotice("");
              setPanel({ kind: "stage", original: application });
            }}
            className={secondaryButton}
          >
            Change stage
            <span className="sr-only">
              {" "}
              {application.jobTitle} at {application.company}
            </span>
          </button>
        )}
        <button
          ref={archiveButtonRef}
          type="button"
          disabled={disabled || panel !== null}
          aria-expanded={panel?.kind === "archive"}
          aria-controls={archivePanelId}
          onClick={() => {
            setNotice("");
            setPanel({ kind: "archive", original: application });
          }}
          className={secondaryButton}
        >
          Archive
          <span className="sr-only">
            {" "}
            {application.jobTitle} at {application.company}
          </span>
        </button>
      </div>

      <div id={editPanelId} hidden={panel?.kind !== "edit"}>
        {panel?.kind === "edit" && (
          <EditRoleForm
            original={panel.original}
            disabled={disabled}
            onCancel={() => closePanel("edit")}
            onSubmit={async (changes) => {
              await onEdit(changes);
              setNotice("Role details updated.");
              closePanel("edit");
            }}
          />
        )}
      </div>

      <div id={stagePanelId} hidden={panel?.kind !== "stage"}>
        {panel?.kind === "stage" && (
          <UpdateStageForm
            original={panel.original}
            disabled={disabled}
            onCancel={() => closePanel("stage")}
            onSubmit={async (changes) => {
              await onStageChange(changes);
              setNotice("Application stage updated.");
              closePanel("stage");
            }}
          />
        )}
      </div>

      <div id={archivePanelId} hidden={panel?.kind !== "archive"}>
        {panel?.kind === "archive" && (
          <ArchiveConfirmation
            application={panel.original}
            disabled={disabled}
            onCancel={() => closePanel("archive")}
            onConfirm={async () => {
              await onArchive();
              // The dashboard announces success because this row may disappear.
              setPanel(null);
            }}
          />
        )}
      </div>

      <div hidden={panel !== null}>
        <MarkAppliedForm
          applicationId={application.id}
          company={application.company}
          jobTitle={application.jobTitle}
          canApply={application.status === "saved"}
          disabled={disabled || panel !== null}
          onApply={onApply}
        />
      </div>

      <p role="status" className="text-sm text-teal-700">
        {notice}
      </p>
    </div>
  );
}

function invalidLabel(value: string): boolean {
  return (
    !value ||
    value.length > 200 ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

function EditRoleForm({
  original,
  disabled,
  onCancel,
  onSubmit,
}: {
  original: JobApplication;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (changes: ApplicationEdits) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invalidField, setInvalidField] = useState<
    "company" | "jobTitle" | null
  >(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const companyRef = useRef<HTMLInputElement>(null);
  const prefix = useId();
  const companyId = `${prefix}-company`;
  const titleId = `${prefix}-title`;
  const errorId = `${prefix}-error`;
  const busy = disabled || isSubmitting;

  useEffect(() => {
    companyRef.current?.focus();
  }, []);

  async function handleSubmit(form: HTMLFormElement) {
    if (submittingRef.current || disabled) return;
    const data = new FormData(form);
    const company = String(data.get("company") ?? "").trim();
    const jobTitle = String(data.get("jobTitle") ?? "").trim();
    setNotice("");

    if (invalidLabel(company) || invalidLabel(jobTitle)) {
      const fieldName = invalidLabel(company) ? "company" : "jobTitle";
      setInvalidField(fieldName);
      setError(
        "Use a company and job title with 1-200 characters and no control characters.",
      );
      const field = form.elements.namedItem(fieldName);
      if (field instanceof HTMLInputElement) field.focus();
      return;
    }

    const changes: ApplicationEdits = {};
    if (company !== original.company) changes.company = company;
    if (jobTitle !== original.jobTitle) changes.jobTitle = jobTitle;
    if (Object.keys(changes).length === 0) {
      setError("");
      setNotice("No changes to save.");
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setInvalidField(null);
    setError("");
    try {
      await onSubmit(changes);
    } catch (failure) {
      setError(errorMessage(failure));
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
        void handleSubmit(event.currentTarget);
      }}
      onInput={() => {
        setError("");
        setNotice("");
        setInvalidField(null);
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-slate-950">
          Edit role details
        </legend>
        <div>
          <label
            htmlFor={companyId}
            className="block text-xs font-medium text-slate-700"
          >
            Company
          </label>
          <input
            ref={companyRef}
            id={companyId}
            name="company"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={original.company}
            disabled={busy}
            aria-invalid={invalidField === "company" ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          />
        </div>
        <div>
          <label
            htmlFor={titleId}
            className="block text-xs font-medium text-slate-700"
          >
            Job title
          </label>
          <input
            id={titleId}
            name="jobTitle"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            defaultValue={original.jobTitle}
            disabled={busy}
            aria-invalid={invalidField === "jobTitle" ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-offset-2 focus:outline-teal-700 disabled:bg-slate-100"
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Saving..." : "Save changes"}
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className={secondaryButton}
          >
            Cancel
          </button>
        </div>
        <p role="status" className="text-sm text-slate-600">
          {notice}
        </p>
      </fieldset>
    </form>
  );
}

function ArchiveConfirmation({
  application,
  disabled,
  onCancel,
  onConfirm,
}: {
  application: JobApplication;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  async function handleConfirm() {
    if (submittingRef.current || disabled) return;
    submittingRef.current = true;
    setIsSubmitting(true);
    setError("");
    try {
      await onConfirm();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <form
      className="rounded-xl border border-amber-200 bg-amber-50 p-4"
      aria-busy={isSubmitting}
      aria-describedby={descriptionId}
      onSubmit={(event) => {
        event.preventDefault();
        void handleConfirm();
      }}
    >
      <fieldset className="space-y-3">
        <legend className="mb-2 font-semibold text-slate-950">
          Archive this role?
        </legend>
        <p id={descriptionId} className="break-words text-sm text-slate-700">
          {application.jobTitle} at {application.company} will leave your active
          list. Its record will be retained.
        </p>
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={isSubmitting}
            onClick={onCancel}
            className={secondaryButton}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={disabled || isSubmitting}
            className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Archiving..." : "Confirm archive"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
