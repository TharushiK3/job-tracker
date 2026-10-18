# Connect the job tracker dashboard to FastAPI

This package connects the existing teal/slate dashboard to the backend that passed all 26 tests. It supplies complete frontend files and a small API-client test suite.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| frontend/src/lib/applications-api.ts | Sends bearer-token requests, checks response shapes, maps API field names to frontend names, and provides useful errors. |
| frontend/src/components/application-dashboard.tsx | Loads account data, displays global overview totals, handles pagination, and refreshes after writes. |
| frontend/src/components/save-role-form.tsx | Waits for the save request; clears inputs only after confirmed success. |
| frontend/src/components/mark-applied-form.tsx | Validates the local calendar date and waits for the stored update before confirmation. |
| frontend/tests/applications-api.test.mjs | Tests the API client with mocked HTTP responses, without sending real tokens or contacting Clerk/PostgreSQL. |

The dashboard is the client boundary. Its imported form components inherit that boundary.

TanStack Query manages loading, cached reads, cancellation, and refreshing. Each signed-in account receives a fresh QueryClient, and every query key includes the user ID. These caches stay in memory.

The server continues to decide ownership from the verified Clerk token. The frontend user ID is used only to separate caches.

## 1. Apply the source files

Save the downloaded ZIP in Downloads with the name job-tracker-frontend.zip.

Stop the Next.js development server with Ctrl+C in its own terminal. Leave FastAPI and PostgreSQL running.

In a new PowerShell window:

    cd C:\Users\USER\job-tracker

    $trackerPackage = Join-Path $env:USERPROFILE "Downloads\job-tracker-frontend.zip"
    if (-not (Test-Path -LiteralPath $trackerPackage)) {
        throw "Save job-tracker-frontend.zip in your Downloads folder first."
    }

    $trackerUiBackup = Join-Path $env:TEMP ("job-tracker-ui-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

    Compress-Archive -LiteralPath @(
        ".\frontend\src\components\application-dashboard.tsx",
        ".\frontend\src\components\save-role-form.tsx",
        ".\frontend\src\components\mark-applied-form.tsx"
    ) -DestinationPath $trackerUiBackup -ErrorAction Stop

    Expand-Archive -LiteralPath $trackerPackage -DestinationPath $PWD.Path -Force -ErrorAction Stop

    Write-Output "Previous components saved at: $trackerUiBackup"

This creates a local backup of the three existing components, then extracts the replacement files into the project.

## 2. Install the query library and add the test command

    cd C:\Users\USER\job-tracker\frontend

    npm.cmd install --save-exact @tanstack/react-query@5

    npm.cmd pkg set "scripts.test:api=node --test tests/applications-api.test.mjs"

The major version is v5; save-exact records the resolved version in package.json and package-lock.json.

The API tests use Node 24's built-in test runner and TypeScript type stripping. They do not need another test-runner package.

## 3. Configure the public API address

Open the existing frontend environment file:

    notepad .\.env.local

Keep the existing Clerk entries. Add this line once:

    NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000

The API address is public configuration. The Clerk secret remains an unprefixed server-side variable.

Use http://localhost:3000 for the frontend. This matches the origin allowed by the backend configuration. The API is at http://127.0.0.1:8000.

## 4. Run the frontend checks

Run these commands in order. If one fails, fix that error before continuing.

    npm.cmd run lint:fix
    npm.cmd run lint
    npm.cmd run typecheck
    npm.cmd run test:api
    npm.cmd run build

The API-client suite should report 12 passing tests.

Validation performed while preparing this package:
- All 12 API-client tests passed using Node 24.19.
- The four TypeScript/TSX source files passed syntax parsing.
- The complete Next.js typecheck, lint, production build, and signed-in browser workflow must run in your Windows project with its installed dependencies and Clerk configuration.

The attached backend log already confirmed 26 backend tests passed. The client tests use simulated responses; the browser checks below verify the real frontend-to-backend connection.

## 5. Start the application

Keep the existing FastAPI server running. If it is closed, start it in its own terminal:

    cd C:\Users\USER\job-tracker\backend
    .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

In a separate frontend terminal:

    cd C:\Users\USER\job-tracker\frontend
    npm.cmd run dev

Open http://localhost:3000 and sign in.

An initially empty workspace is expected if you have not saved database-backed roles. The old preview examples have been replaced by real account data.

## 6. Verify the real browser workflow

1. Save a role, for example API Test Company / Junior Frontend Developer.
2. Confirm the new row appears and Tracked roles increases.
3. Refresh the browser. The saved role should remain.
4. Select a valid application date and choose Mark as applied.
5. Confirm the row shows Applied and the selected date.
6. Refresh again. The status and date should remain.
7. Check that Applications submitted increased.
8. Sign out. In a separate browser profile or Incognito window, sign in with another account. Its list must not contain the first account's role.
9. With more than 25 roles, check Previous and Next. The overview cards count all active roles, not only the displayed page.

Optional failure check:
- Stop FastAPI, then use Refresh.
- The dashboard should show a connection error instead of treating the account as empty.
- Start FastAPI and choose Refresh to recover.

If a write loses its connection after reaching the server, the client cannot always know whether it committed. It retains the inputs and asks you to refresh before trying again. Writes are not automatically retried.

## How a save works

1. The form reads and trims the two text inputs.
2. Its callback returns a Promise, so the form can wait.
3. Clerk supplies a current session token.
4. The API client sends the token in Authorization and the role fields as JSON.
5. FastAPI verifies the token and saves the owner-scoped record in PostgreSQL.
6. The client checks the returned JSON before using it.
7. TanStack Query refreshes the list and overview.
8. The form clears only after the save succeeds.

If the save succeeds but refreshing fails, the success remains a success; the list separately shows its refresh error.

## How Mark as Applied works

The request sends the chosen YYYY-MM-DD date and the browser's IANA time zone. FastAPI validates the date in that time zone and updates status/date together. Repeating the same date is safe. An existing different date returns a conflict.

The component stays mounted when its form disappears after success. Its confirmation paragraph can receive keyboard focus.

## Commit after the checks and browser workflow pass

From the project root:

    cd C:\Users\USER\job-tracker

    git check-ignore frontend/.env.local

    git add frontend/package.json frontend/package-lock.json
    git add frontend/src/components/application-dashboard.tsx frontend/src/components/save-role-form.tsx frontend/src/components/mark-applied-form.tsx
    git add frontend/src/lib/applications-api.ts frontend/tests/applications-api.test.mjs FRONTEND-CONNECTION.md

    git add backend/app/users.py backend/app/schemas.py backend/app/dependencies.py backend/app/applications.py backend/app/main.py
    git add backend/tests/test_users.py backend/tests/test_applications.py backend/tests/test_application_updates.py

    git diff --cached --stat
    git commit -m "Connect the dashboard to authenticated application APIs"
    git status

The explicit paths stage source files and tests. Review the staged summary before committing.

## Primary documentation

- [Clerk authenticated cross-origin requests](https://clerk.com/docs/guides/development/making-requests)
- [TanStack Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation)
- [Node 24 TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
