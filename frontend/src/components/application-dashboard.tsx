"use client";

import { UserButton, useAuth } from "@clerk/nextjs";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ApplicationActions from "@/components/application-actions";
import RestoreRoleButton from "@/components/restore-role-button";
import SaveRoleForm from "@/components/save-role-form";
import {
  ApiError,
  type ApplicationEdits,
  type ApplicationPage,
  type ApplicationStatus,
  type ApplicationStageChange,
  type ApplicationView,
  type ArchivedApplicationPage,
  archiveApplication,
  createApplication,
  errorMessage,
  listApplications,
  listArchivedApplications,
  type JobApplication,
  recordApplicationDate,
  restoreApplication,
  updateApplication,
  updateApplicationStage,
} from "@/lib/applications-api";

const PAGE_SIZE = 25;

const statusLabels: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const statusStyles: Record<ApplicationStatus, string> = {
  saved: "bg-slate-100 text-slate-700",
  applied: "bg-teal-50 text-teal-800",
  screening: "bg-blue-50 text-blue-800",
  interview: "bg-amber-50 text-amber-800",
  offer: "bg-emerald-50 text-emerald-800",
  rejected: "bg-red-50 text-red-800",
  withdrawn: "bg-slate-100 text-slate-600",
};

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        {value ?? "\u2014"}
        {value === undefined && <span className="sr-only"> Not loaded</span>}
      </dd>
    </div>
  );
}

function ArchivedTime({ application }: { application: JobApplication }) {
  if (
    !("archivedAt" in application) ||
    typeof application.archivedAt !== "string"
  ) {
    return <span>{"\u2014"}</span>;
  }
  const timestamp = application.archivedAt;
  return (
    <time dateTime={timestamp}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(timestamp))}
    </time>
  );
}

export default function ApplicationDashboard() {
  const { isLoaded, isSignedIn, userId } = useAuth();

  if (!isLoaded) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <p role="status" className="text-sm text-slate-600">
          Loading your workspace...
        </p>
      </main>
    );
  }

  if (!isSignedIn || !userId) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-8">
          <h1 className="text-xl font-semibold text-slate-950">
            Sign in to your workspace
          </h1>
          <Link
            href="/sign-in"
            className="inline-flex rounded-lg bg-teal-700 px-4 py-2.5 font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  // A different account receives a fresh component and a fresh query cache.
  return <Workspace key={userId} userId={userId} />;
}

function Workspace({ userId }: { userId: string }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 15_000,
            gcTime: 60_000,
            networkMode: "always",
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: false,
            gcTime: 0,
            networkMode: "always",
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceContent userId={userId} />
    </QueryClientProvider>
  );
}

function WorkspaceContent({ userId }: { userId: string }) {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [view, setView] = useState<ApplicationView>("active");
  const [actionNotice, setActionNotice] = useState("");
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const focusAfterAction = useRef(false);
  const writeInFlight = useRef(false);
  const queryPrefix = ["applications", userId];

  async function sessionToken() {
    const token = await getToken();
    if (!token) {
      throw new ApiError("Your session has ended. Please sign in again.", 401);
    }
    return token;
  }

  const applicationsQuery = useQuery<ApplicationPage | ArchivedApplicationPage>(
    {
      queryKey: ["applications", userId, view, offset],
      queryFn: async ({ signal }) => {
        const token = await sessionToken();
        return view === "archived"
          ? listArchivedApplications(token, offset, PAGE_SIZE, signal)
          : listApplications(token, offset, PAGE_SIZE, signal);
      },
    },
  );

  async function cancelOldReads() {
    setActionNotice("");
    focusAfterAction.current = false;
    await queryClient.cancelQueries({ queryKey: queryPrefix });
  }

  async function refreshSavedData() {
    // A failed refresh is shown by the list; it does not turn a confirmed save into a failed save.
    await queryClient.invalidateQueries(
      { queryKey: queryPrefix },
      { throwOnError: false },
    );
  }

  const saveMutation = useMutation({
    mutationFn: async ({
      company,
      jobTitle,
    }: {
      company: string;
      jobTitle: string;
    }) => createApplication(await sessionToken(), company, jobTitle),
    onMutate: cancelOldReads,
    onSuccess: async () => {
      setView("active");
      setOffset(0);
      await refreshSavedData();
    },
  });

  const appliedMutation = useMutation({
    mutationFn: async ({
      applicationId,
      appliedOn,
    }: {
      applicationId: string;
      appliedOn: string;
    }) => recordApplicationDate(await sessionToken(), applicationId, appliedOn),
    onMutate: cancelOldReads,
    onSuccess: refreshSavedData,
  });

  const editMutation = useMutation({
    mutationFn: async ({
      applicationId,
      changes,
    }: {
      applicationId: string;
      changes: ApplicationEdits;
    }) => updateApplication(await sessionToken(), applicationId, changes),
    onMutate: cancelOldReads,
    onSuccess: refreshSavedData,
  });

  const stageMutation = useMutation({
    mutationFn: async ({
      applicationId,
      changes,
    }: {
      applicationId: string;
      changes: ApplicationStageChange;
    }) => updateApplicationStage(await sessionToken(), applicationId, changes),
    onMutate: cancelOldReads,
    onSuccess: refreshSavedData,
  });

  const archiveMutation = useMutation({
    mutationFn: async (application: JobApplication) =>
      archiveApplication(await sessionToken(), application.id),
    onMutate: cancelOldReads,
    onSuccess: async (_result, application) => {
      setActionNotice(
        `Archived ${application.jobTitle} at ${application.company}.`,
      );
      focusAfterAction.current = true;
      if (offset > 0 && applicationsQuery.data?.items.length === 1) {
        setOffset((current) => Math.max(0, current - PAGE_SIZE));
      }
      await refreshSavedData();
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async (application: JobApplication) =>
      restoreApplication(await sessionToken(), application.id),
    onMutate: cancelOldReads,
    onSuccess: async (_result, application) => {
      setActionNotice(
        `Restored ${application.jobTitle} at ${application.company} to your active roles.`,
      );
      focusAfterAction.current = true;
      if (offset > 0 && applicationsQuery.data?.items.length === 1) {
        setOffset((current) => Math.max(0, current - PAGE_SIZE));
      }
      await refreshSavedData();
    },
  });

  async function runWrite(operation: () => Promise<unknown>): Promise<void> {
    if (writeInFlight.current) {
      throw new Error("Another change is being saved. Try again in a moment.");
    }
    writeInFlight.current = true;
    try {
      await operation();
    } finally {
      writeInFlight.current = false;
    }
  }

  function saveRole(company: string, jobTitle: string): Promise<void> {
    return runWrite(() => saveMutation.mutateAsync({ company, jobTitle }));
  }

  function markAsApplied(
    applicationId: string,
    appliedOn: string,
  ): Promise<void> {
    return runWrite(() =>
      appliedMutation.mutateAsync({ applicationId, appliedOn }),
    );
  }

  function editRole(
    applicationId: string,
    changes: ApplicationEdits,
  ): Promise<void> {
    return runWrite(() => editMutation.mutateAsync({ applicationId, changes }));
  }

  function changeStage(
    applicationId: string,
    changes: ApplicationStageChange,
  ): Promise<void> {
    return runWrite(() =>
      stageMutation.mutateAsync({ applicationId, changes }),
    );
  }

  function archiveRole(application: JobApplication): Promise<void> {
    return runWrite(() => archiveMutation.mutateAsync(application));
  }

  function restoreRole(application: JobApplication): Promise<void> {
    return runWrite(() => restoreMutation.mutateAsync(application));
  }

  function chooseView(nextView: ApplicationView) {
    setView(nextView);
    setOffset(0);
    setActionNotice("");
    focusAfterAction.current = false;
  }

  const page = applicationsQuery.data;
  const mutating =
    saveMutation.isPending ||
    appliedMutation.isPending ||
    editMutation.isPending ||
    stageMutation.isPending ||
    archiveMutation.isPending ||
    restoreMutation.isPending;
  const busy = mutating || applicationsQuery.isFetching;
  const canWrite = Boolean(page) && !applicationsQuery.isError && !mutating;
  const items = page?.items ?? [];
  const overview = page?.overview;
  const totalCount =
    page && "total" in page ? page.total : overview?.trackedRoles;
  const listStatus = applicationsQuery.isFetching
    ? page
      ? "Updating your applications..."
      : "Loading your applications..."
    : page && !applicationsQuery.isError
      ? "Applications are up to date."
      : "";

  useEffect(() => {
    if (actionNotice && !mutating && focusAfterAction.current) {
      actionNoticeRef.current?.focus();
      focusAfterAction.current = false;
    }
  }, [actionNotice, mutating]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <p className="font-semibold tracking-tight">
            Job Application Tracker
          </p>
          <div className="flex items-center gap-4">
            <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
              Your workspace
            </span>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        <section aria-labelledby="dashboard-heading">
          <p className="text-sm font-semibold text-teal-700">YOUR JOB SEARCH</p>
          <h1
            id="dashboard-heading"
            className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Every opportunity, organised.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
            Keep track of your applications, interviews, and next steps in one
            place.
          </p>
          <a
            href="#applications"
            className="mt-5 inline-flex rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700"
          >
            View applications
          </a>
        </section>

        <SaveRoleForm disabled={!canWrite} onSave={saveRole} />

        <section aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="sr-only">
            Application overview
          </h2>
          <p className="mb-3 text-sm font-medium text-slate-600">
            Active workspace totals
          </p>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Tracked roles" value={overview?.trackedRoles} />
            <SummaryCard
              label="Applications submitted"
              value={overview?.submittedApplications}
            />
            <SummaryCard
              label="At interview stage"
              value={overview?.interviews}
            />
            <SummaryCard label="Offers" value={overview?.offers} />
          </dl>
        </section>

        <section
          id="applications"
          aria-labelledby="applications-heading"
          className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-6 py-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="applications-heading" className="text-lg font-semibold">
                  {view === "archived" ? "Archived roles" : "Applications"}
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  {view === "archived"
                    ? "Restore a role to return it to your active workspace. Archive times use your device's time zone."
                    : "Your saved opportunities and application progress."}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void applicationsQuery.refetch();
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {applicationsQuery.isFetching ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            <fieldset className="mt-4 flex min-w-0 flex-wrap gap-2 border-0 p-0">
              <legend className="sr-only">Application view</legend>
              {(["active", "archived"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={view === option}
                  disabled={mutating}
                  onClick={() => chooseView(option)}
                  className={`rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50 ${view === option ? "border-teal-700 bg-teal-700 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {option === "active" ? "Active" : "Archived"}
                </button>
              ))}
            </fieldset>

            <p role="status" className="mt-3 min-h-5 text-sm text-slate-600">
              {listStatus}
            </p>

            <p
              ref={actionNoticeRef}
              tabIndex={-1}
              role="status"
              className="mt-2 break-words rounded text-sm text-teal-800 focus:outline-2 focus:outline-offset-4 focus:outline-teal-700"
            >
              {actionNotice}
            </p>

            {applicationsQuery.isError && (
              <div
                role="alert"
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <p>{errorMessage(applicationsQuery.error)}</p>
                {page && (
                  <p className="mt-1">
                    Showing the last loaded results. Refresh to load the latest.
                  </p>
                )}
                {applicationsQuery.error instanceof ApiError &&
                  applicationsQuery.error.status === 401 && (
                    <Link
                      href="/sign-in"
                      className="mt-2 inline-block font-semibold underline"
                    >
                      Sign in
                    </Link>
                  )}
              </div>
            )}
          </div>

          <div
            className="overflow-x-auto"
            aria-busy={applicationsQuery.isFetching}
          >
            <table className="w-full min-w-[820px] text-left text-sm">
              <caption className="sr-only">
                {view === "archived"
                  ? "Archived job opportunities."
                  : "Active job opportunities."}{" "}
                Application dates use year-month-day.
              </caption>
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Role and company
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 font-medium">
                    Application date
                  </th>
                  {view === "archived" && (
                    <th scope="col" className="px-6 py-3 font-medium">
                      Archived on
                    </th>
                  )}
                  <th scope="col" className="px-6 py-3 font-medium">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((application) => (
                  <tr
                    key={application.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="max-w-80 break-words px-6 py-5 font-medium text-slate-950"
                    >
                      {application.jobTitle}
                      <span className="mt-1 block font-normal text-slate-600">
                        {application.company}
                      </span>
                    </th>
                    <td className="px-6 py-5">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${statusStyles[application.status]}`}
                      >
                        {statusLabels[application.status]}
                      </span>
                    </td>
                    <td className="px-6 py-5 text-slate-600">
                      {application.appliedOn ? (
                        <time dateTime={application.appliedOn}>
                          {application.appliedOn}
                        </time>
                      ) : (
                        "Not applied"
                      )}
                    </td>
                    {view === "archived" && (
                      <td className="px-6 py-5 text-slate-600">
                        <ArchivedTime application={application} />
                      </td>
                    )}
                    <td className="px-6 py-5 align-top">
                      {view === "archived" ? (
                        <RestoreRoleButton
                          application={application}
                          disabled={!canWrite}
                          onRestore={() => restoreRole(application)}
                        />
                      ) : (
                        <ApplicationActions
                          application={application}
                          disabled={!canWrite}
                          onEdit={(changes) =>
                            editRole(application.id, changes)
                          }
                          onStageChange={(changes) =>
                            changeStage(application.id, changes)
                          }
                          onArchive={() => archiveRole(application)}
                          onApply={(appliedOn) =>
                            markAsApplied(application.id, appliedOn)
                          }
                        />
                      )}
                    </td>
                  </tr>
                ))}

                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={view === "archived" ? 5 : 4}
                      className="px-6 py-10 text-center text-slate-600"
                    >
                      {!page
                        ? applicationsQuery.isError
                          ? "Use Refresh to load your applications."
                          : "Loading your applications..."
                        : offset > 0
                          ? "There are no roles on this page. Return to the first page."
                          : view === "archived"
                            ? "No archived roles. Roles you archive will appear here."
                            : "Your workspace is ready. Save your first role above."}
                      {page && page.offset > 0 && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setOffset(0)}
                          className="mx-auto mt-3 block rounded px-2 py-1 font-semibold text-teal-800 underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:opacity-60"
                        >
                          Go to first page
                        </button>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {page && (
            <nav
              aria-label={
                view === "archived"
                  ? "Archived application pages"
                  : "Active application pages"
              }
              className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4"
            >
              <p className="text-sm text-slate-600">
                {items.length > 0
                  ? `Showing ${page.offset + 1}-${page.offset + items.length} of ${totalCount} roles`
                  : "No roles on this page"}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || applicationsQuery.isError || offset === 0}
                  onClick={() =>
                    setOffset((current) => Math.max(0, current - PAGE_SIZE))
                  }
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={busy || applicationsQuery.isError || !page.hasMore}
                  onClick={() => setOffset((current) => current + PAGE_SIZE)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </nav>
          )}
        </section>
      </main>
    </div>
  );
}
