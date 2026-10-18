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
import SaveRoleForm from "@/components/save-role-form";
import {
  ApiError,
  type ApplicationEdits,
  type ApplicationStatus,
  archiveApplication,
  createApplication,
  errorMessage,
  listApplications,
  type JobApplication,
  recordApplicationDate,
  updateApplication,
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
  const [actionNotice, setActionNotice] = useState("");
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const focusAfterArchive = useRef(false);
  const writeInFlight = useRef(false);
  const queryPrefix = ["applications", userId];

  async function sessionToken() {
    const token = await getToken();
    if (!token) {
      throw new ApiError("Your session has ended. Please sign in again.", 401);
    }
    return token;
  }

  const applicationsQuery = useQuery({
    queryKey: ["applications", userId, offset],
    queryFn: async ({ signal }) =>
      listApplications(await sessionToken(), offset, PAGE_SIZE, signal),
  });

  async function cancelOldReads() {
    setActionNotice("");
    focusAfterArchive.current = false;
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

  const archiveMutation = useMutation({
    mutationFn: async (application: JobApplication) =>
      archiveApplication(await sessionToken(), application.id),
    onMutate: cancelOldReads,
    onSuccess: async (_result, application) => {
      setActionNotice(
        `Archived ${application.jobTitle} at ${application.company}.`,
      );
      focusAfterArchive.current = true;
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

  function archiveRole(application: JobApplication): Promise<void> {
    return runWrite(() => archiveMutation.mutateAsync(application));
  }

  const page = applicationsQuery.data;
  const mutating =
    saveMutation.isPending ||
    appliedMutation.isPending ||
    editMutation.isPending ||
    archiveMutation.isPending;
  const busy = mutating || applicationsQuery.isFetching;
  const canWrite = Boolean(page) && !applicationsQuery.isError && !mutating;
  const items = page?.items ?? [];
  const overview = page?.overview;
  const listStatus = applicationsQuery.isFetching
    ? page
      ? "Updating your applications..."
      : "Loading your applications..."
    : page && !applicationsQuery.isError
      ? "Applications are up to date."
      : "";

  useEffect(() => {
    if (actionNotice && !mutating && focusAfterArchive.current) {
      actionNoticeRef.current?.focus();
      focusAfterArchive.current = false;
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
                  Applications
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Your saved opportunities and application progress.
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
                Tracked job opportunities. Application dates use year-month-day.
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
                    <td className="px-6 py-5 align-top">
                      <ApplicationActions
                        application={application}
                        disabled={!canWrite}
                        onEdit={(changes) => editRole(application.id, changes)}
                        onArchive={() => archiveRole(application)}
                        onApply={(appliedOn) =>
                          markAsApplied(application.id, appliedOn)
                        }
                      />
                    </td>
                  </tr>
                ))}

                {items.length === 0 && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-6 py-10 text-center text-slate-600"
                    >
                      {!page
                        ? applicationsQuery.isError
                          ? "Use Refresh to load your applications."
                          : "Loading your applications..."
                        : overview?.trackedRoles === 0
                          ? "Your workspace is ready. Save your first role above."
                          : "There are no roles on this page. Return to the first page."}
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
              aria-label="Application pages"
              className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-6 py-4"
            >
              <p className="text-sm text-slate-600">
                {items.length > 0
                  ? `Showing ${page.offset + 1}-${page.offset + items.length} of ${page.overview.trackedRoles} roles`
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
