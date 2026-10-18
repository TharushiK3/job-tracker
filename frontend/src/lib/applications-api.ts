export type ApplicationStatus =
  | "saved"
  | "applied"
  | "screening"
  | "interview"
  | "offer"
  | "rejected"
  | "withdrawn";

export type JobApplication = {
  id: string;
  company: string;
  jobTitle: string;
  status: ApplicationStatus;
  appliedOn: string | null;
};

export type ApplicationEdits = {
  company?: string;
  jobTitle?: string;
};

export type ArchivedApplication = {
  id: string;
  archivedAt: string;
};

export type ApplicationOverview = {
  trackedRoles: number;
  submittedApplications: number;
  interviews: number;
  offers: number;
};

export type ApplicationPage = {
  items: JobApplication[];
  limit: number;
  offset: number;
  hasMore: boolean;
  overview: ApplicationOverview;
};

export class ApiError extends Error {
  readonly status: number;
  readonly mayHaveSaved: boolean;

  constructor(message: string, status = 0, mayHaveSaved = false) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.mayHaveSaved = mayHaveSaved;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isStatus(value: unknown): value is ApplicationStatus {
  return (
    value === "saved" ||
    value === "applied" ||
    value === "screening" ||
    value === "interview" ||
    value === "offer" ||
    value === "rejected" ||
    value === "withdrawn"
  );
}

export function isCalendarDate(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ||
    value.startsWith("0000-")
  ) {
    return false;
  }

  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function parseApplication(value: unknown): JobApplication {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.company !== "string" ||
    !value.company.trim() ||
    typeof value.job_title !== "string" ||
    !value.job_title.trim() ||
    !isStatus(value.status) ||
    (value.applied_on !== null && !isCalendarDate(value.applied_on))
  ) {
    throw new Error("Invalid application response.");
  }

  if (
    (value.status === "saved" && value.applied_on !== null) ||
    (value.status !== "saved" && value.applied_on === null)
  ) {
    throw new Error("Inconsistent application date.");
  }

  return {
    id: value.id,
    company: value.company,
    jobTitle: value.job_title,
    status: value.status,
    appliedOn: value.applied_on,
  };
}

function parseArchivedApplication(value: unknown): ArchivedApplication {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.archived_at !== "string" ||
    !isCalendarDate(value.archived_at.slice(0, 10)) ||
    !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,6})?(?:Z|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$/.test(
      value.archived_at,
    ) ||
    !Number.isFinite(Date.parse(value.archived_at))
  ) {
    throw new Error("Invalid archive response.");
  }
  return { id: value.id, archivedAt: value.archived_at };
}

function parsePage(value: unknown): ApplicationPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonnegativeInteger(value.limit) ||
    value.limit < 1 ||
    value.limit > 100 ||
    !isNonnegativeInteger(value.offset) ||
    typeof value.has_more !== "boolean" ||
    value.items.length > value.limit ||
    !isRecord(value.overview) ||
    !isNonnegativeInteger(value.overview.tracked_roles) ||
    !isNonnegativeInteger(value.overview.submitted_applications) ||
    !isNonnegativeInteger(value.overview.interviews) ||
    !isNonnegativeInteger(value.overview.offers)
  ) {
    throw new Error("Invalid applications page.");
  }

  return {
    items: value.items.map(parseApplication),
    limit: value.limit,
    offset: value.offset,
    hasMore: value.has_more,
    overview: {
      trackedRoles: value.overview.tracked_roles,
      submittedApplications: value.overview.submitted_applications,
      interviews: value.overview.interviews,
      offers: value.overview.offers,
    },
  };
}

function serverMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.detail === "string") return payload.detail;
  if (!Array.isArray(payload.detail)) return undefined;

  const detail = payload.detail.find(
    (item: unknown) => isRecord(item) && typeof item.msg === "string",
  );

  if (!isRecord(detail) || typeof detail.msg !== "string") return undefined;

  const labels: Record<string, string> = {
    company: "Company",
    job_title: "Job title",
    applied_on: "Application date",
    time_zone: "Time zone",
  };
  const field: unknown = Array.isArray(detail.loc) ? detail.loc.at(-1) : null;
  const label = typeof field === "string" ? labels[field] : undefined;
  const message = detail.msg.replace(/^Value error, /, "");

  return label ? `${label}: ${message}` : message;
}

function apiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!configured) {
    throw new ApiError(
      "The API address is missing. Check the frontend configuration.",
    );
  }

  try {
    const url = new URL(configured);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid API URL.");
    }

    return url.href.replace(/\/+$/, "");
  } catch {
    throw new ApiError("The configured API address is invalid.");
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal | undefined;
};

async function request<T>(
  path: string,
  token: string,
  decode: (value: unknown) => T,
  options: RequestOptions = {},
): Promise<T> {
  if (!token.trim()) {
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }

  const url = `${apiBaseUrl()}${path}`;
  const method = options.method ?? "GET";
  const isWrite = method !== "GET";
  const timeout = AbortSignal.timeout(20_000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "omit",
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;

    throw new ApiError(
      isWrite
        ? "Could not confirm the change. It may have been saved. Refresh the list before trying again."
        : "Could not reach the server. Check your connection and try Refresh.",
      0,
      isWrite,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new ApiError(
        "Your session could not be verified. Please sign in again.",
        401,
      );
    }

    if (response.status === 404 && isWrite) {
      throw new ApiError(
        "This role is no longer available. Refresh the list.",
        404,
      );
    }

    const message =
      serverMessage(payload) ?? "The request could not be completed.";
    throw new ApiError(
      response.status >= 500 && isWrite
        ? `${message} Refresh the list before trying again.`
        : message,
      response.status,
      isWrite && response.status >= 500,
    );
  }

  try {
    return decode(payload);
  } catch {
    throw new ApiError(
      isWrite
        ? "The change may have been saved, but its confirmation was invalid. Refresh the list before trying again."
        : "The server returned an unexpected response. Try Refresh.",
      response.status,
      isWrite,
    );
  }
}

export function listApplications(
  token: string,
  offset: number,
  limit = 25,
  signal?: AbortSignal,
): Promise<ApplicationPage> {
  return request(
    `/api/applications?limit=${limit}&offset=${offset}`,
    token,
    parsePage,
    { signal },
  );
}

export function createApplication(
  token: string,
  company: string,
  jobTitle: string,
): Promise<JobApplication> {
  return request("/api/applications", token, parseApplication, {
    method: "POST",
    body: { company, job_title: jobTitle },
  });
}

export function recordApplicationDate(
  token: string,
  applicationId: string,
  appliedOn: string,
): Promise<JobApplication> {
  return request(
    `/api/applications/${encodeURIComponent(applicationId)}/mark-applied`,
    token,
    parseApplication,
    {
      method: "POST",
      body: {
        applied_on: appliedOn,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
  );
}

export async function updateApplication(
  token: string,
  applicationId: string,
  changes: ApplicationEdits,
): Promise<JobApplication> {
  const body: { company?: string; job_title?: string } = {};
  if (changes.company !== undefined) body.company = changes.company;
  if (changes.jobTitle !== undefined) body.job_title = changes.jobTitle;

  if (Object.keys(body).length === 0) {
    throw new ApiError("Change a company or job title before saving.");
  }

  return request(
    `/api/applications/${encodeURIComponent(applicationId)}`,
    token,
    (value) => {
      const result = parseApplication(value);
      if (result.id !== applicationId)
        throw new Error("Unexpected application ID.");
      return result;
    },
    { method: "PATCH", body },
  );
}

export function archiveApplication(
  token: string,
  applicationId: string,
): Promise<ArchivedApplication> {
  return request(
    `/api/applications/${encodeURIComponent(applicationId)}/archive`,
    token,
    (value) => {
      const result = parseArchivedApplication(value);
      if (result.id !== applicationId)
        throw new Error("Unexpected application ID.");
      return result;
    },
    { method: "POST", body: {} },
  );
}
