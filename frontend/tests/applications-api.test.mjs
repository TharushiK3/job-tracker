import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  ApiError,
  createApplication,
  isCalendarDate,
  listApplications,
  recordApplicationDate,
} from "../src/lib/applications-api.ts";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
const id = "7f4a7a50-7b02-4c61-9b93-324558ae5898";

function role(overrides = {}) {
  return {
    id,
    company: "Test Company",
    job_title: "Frontend Developer",
    status: "saved",
    applied_on: null,
    ...overrides,
  };
}

function page(overrides = {}) {
  return {
    items: [role()],
    limit: 25,
    offset: 0,
    has_more: false,
    overview: {
      tracked_roles: 1,
      submitted_applications: 0,
      interviews: 0,
      offers: 0,
    },
    ...overrides,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:8000";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBaseUrl === undefined) {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
  } else {
    process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
  }
});

test("list requests use bearer credentials and map the API response", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "http://127.0.0.1:8000/api/applications?limit=25&offset=0",
    );
    assert.equal(options.headers.Authorization, "Bearer test-token");
    assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return Response.json(page());
  };

  const result = await listApplications("test-token", 0);
  assert.equal(result.items[0].jobTitle, "Frontend Developer");
  assert.equal(result.items[0].appliedOn, null);
  assert.equal(result.overview.trackedRoles, 1);
  assert.equal(result.hasMore, false);
});

test("a save sends company and job title without an owner", async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      company: "Test Company",
      job_title: "Frontend Developer",
    });
    return Response.json(role(), { status: 201 });
  };

  const result = await createApplication(
    "test-token",
    "Test Company",
    "Frontend Developer",
  );
  assert.equal(result.id, id);
});

test("marking applied includes the browser time zone", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "http://127.0.0.1:8000/api/applications/" + id + "/mark-applied",
    );
    assert.deepEqual(JSON.parse(options.body), {
      applied_on: "2026-01-15",
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    return Response.json(role({ status: "applied", applied_on: "2026-01-15" }));
  };

  const result = await recordApplicationDate("test-token", id, "2026-01-15");
  assert.equal(result.status, "applied");
  assert.equal(result.appliedOn, "2026-01-15");
});

test("unauthenticated responses produce a useful session error", async () => {
  globalThis.fetch = async () =>
    Response.json({ detail: "Authentication required" }, { status: 401 });

  await assert.rejects(listApplications("test-token", 0), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    assert.match(error.message, /sign in/i);
    return true;
  });
});

test("validation responses expose the field message", async () => {
  globalThis.fetch = async () =>
    Response.json(
      {
        detail: [
          {
            loc: ["body", "company"],
            msg: "String should have at most 200 characters",
          },
        ],
      },
      { status: 422 },
    );

  await assert.rejects(
    createApplication("test-token", "x".repeat(201), "Developer"),
    (error) =>
      error instanceof ApiError && error.message.startsWith("Company:"),
  );
});

test("malformed page responses are rejected", async () => {
  globalThis.fetch = async () =>
    Response.json(page({ overview: { tracked_roles: -1 } }));

  await assert.rejects(
    listApplications("test-token", 0),
    (error) =>
      error instanceof ApiError && /unexpected response/i.test(error.message),
  );
});

test("impossible and inconsistent application dates are rejected", async () => {
  for (const invalidRole of [
    role({ status: "applied", applied_on: "2026-02-30" }),
    role({ status: "applied", applied_on: null }),
    role({ status: "saved", applied_on: "2026-01-15" }),
  ]) {
    globalThis.fetch = async () =>
      Response.json(page({ items: [invalidRole] }));
    await assert.rejects(listApplications("test-token", 0), ApiError);
  }
});

test("a failed write is not retried and reports uncertain confirmation", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    throw new TypeError("Network unavailable");
  };

  await assert.rejects(
    createApplication("test-token", "Test Company", "Developer"),
    (error) =>
      error instanceof ApiError &&
      error.mayHaveSaved &&
      /refresh the list/i.test(error.message),
  );
  assert.equal(attempts, 1);
});

test("an invalid successful write response also reports uncertain confirmation", async () => {
  globalThis.fetch = async () => Response.json({}, { status: 201 });

  await assert.rejects(
    createApplication("test-token", "Test Company", "Developer"),
    (error) => error instanceof ApiError && error.mayHaveSaved,
  );
});

test("query cancellation remains a cancellation", async () => {
  const controller = new AbortController();
  controller.abort();
  const cancellation = new DOMException("Cancelled", "AbortError");

  globalThis.fetch = async (_url, options) => {
    assert.equal(options.signal.aborted, true);
    throw cancellation;
  };

  await assert.rejects(
    listApplications("test-token", 0, 25, controller.signal),
    (error) => error === cancellation,
  );
});

test("calendar dates validate leap years and reject ambiguous formats", () => {
  assert.equal(isCalendarDate("2024-02-29"), true);
  assert.equal(isCalendarDate("2026-02-29"), false);
  assert.equal(isCalendarDate("2026-04-31"), false);
  assert.equal(isCalendarDate("2026/01/15"), false);
  assert.equal(isCalendarDate("0000-01-01"), false);
});

test("a missing API address fails before sending a token", async () => {
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json(page());
  };

  await assert.rejects(
    listApplications("test-token", 0),
    (error) =>
      error instanceof ApiError && /address is missing/i.test(error.message),
  );
  assert.equal(calls, 0);
});
