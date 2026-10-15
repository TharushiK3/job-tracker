"use client";

import { useState } from "react";
import SaveRoleForm from "@/components/save-role-form";
type ApplicationStatus =
  | "Saved"
  | "Applied"
  | "Screening"
  | "Interview"
  | "Offer"
  | "Rejected"
  | "Withdrawn";

type JobApplication = {
  id: string;
  company: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedOn: string | null;
};

const exampleApplications: JobApplication[] = [
  {
    id: "example-1",
    company: "Example Labs",
    jobTitle: "Machine Learning Intern",
    status: "Applied",
    appliedOn: "2026-10-14",
  },
  {
    id: "example-2",
    company: "Sample Systems",
    jobTitle: "Junior Frontend Developer",
    status: "Interview",
    appliedOn: "2026-10-09",
  },
  {
    id: "example-3",
    company: "Demo Analytics",
    jobTitle: "Data Analyst",
    status: "Saved",
    appliedOn: null,
  },
];

type SummaryCardProps = {
  label: string;
  value: number;
};

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        {value}
      </dd>
    </div>
  );
}

export default function ApplicationDashboard() {
  const [applications, setApplications] =
    useState<JobApplication[]>(exampleApplications);

  function saveRole(company: string, jobTitle: string) {
    const newApplication: JobApplication = {
      id: crypto.randomUUID(),
      company,
      jobTitle,
      status: "Saved",
      appliedOn: null,
    };

    setApplications((current) => [newApplication, ...current]);
  }
  const submittedCount = applications.filter(
    (application) => application.appliedOn !== null,
  ).length;

  const interviewCount = applications.filter(
    (application) => application.status === "Interview",
  ).length;

  const offerCount = applications.filter(
    (application) => application.status === "Offer",
  ).length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5">
          <p className="font-semibold tracking-tight">
            Job Application Tracker
          </p>

          <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-800">
            Interface preview
          </span>
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
        <SaveRoleForm onSave={saveRole} />

        <section aria-labelledby="overview-heading">
          <h2 id="overview-heading" className="sr-only">
            Application overview
          </h2>

          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Tracked roles" value={applications.length} />
            <SummaryCard
              label="Applications submitted"
              value={submittedCount}
            />
            <SummaryCard label="At interview stage" value={interviewCount} />
            <SummaryCard label="Offers" value={offerCount} />
          </dl>
        </section>

        <section
          id="applications"
          aria-labelledby="applications-heading"
          className="scroll-mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        >
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 id="applications-heading" className="text-lg font-semibold">
              Applications
            </h2>

            <p className="mt-1 text-sm text-slate-600">
              Preview workspace. Changes reset when you refresh the page.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-left text-sm">
              <caption className="sr-only">
                Example job applications. Dates use year-month-day.
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
                </tr>
              </thead>

              <tbody>
                {applications.map((application) => (
                  <tr
                    key={application.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="px-6 py-5 font-medium text-slate-950"
                    >
                      {application.jobTitle}
                      <span className="mt-1 block font-normal text-slate-600">
                        {application.company}
                      </span>
                    </th>

                    <td className="px-6 py-5">
                      <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                        {application.status}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
