# Edit and archive controls: frontend milestone

Your full backend suite passed 40 tests. This package connects those tested operations to the existing teal/slate dashboard.

## What changes, and why

| File | Responsibility |
| --- | --- |
| frontend/src/components/application-actions.tsx | Provides each row's Edit and Archive buttons, an edit form, an archive confirmation, and the existing mark-applied form. |
| frontend/src/components/application-dashboard.tsx | Runs the new mutations with a fresh Clerk session token, refreshes the account's list/totals, and announces successful archives outside the disappearing row. |
| frontend/src/lib/applications-api.ts | Sends PATCH and archive POST requests, maps field names, validates confirmations, and reports useful errors. |
| frontend/tests/applications-api.test.mjs | Extends the existing simulated-response client suite from 12 to 22 tests. |
| frontend/src/components/save-role-form.tsx | Uses template literals for the success message to address the earlier style suggestion. |
| frontend/src/components/mark-applied-form.tsx | Uses template literals and fits the date controls into the new row actions. |

No extra npm package is required. Your existing Clerk configuration, API address, and TanStack Query dependency are used.

## 1. Download and apply the files

Save the ZIP in Downloads with the name `job-tracker-edit-archive-frontend.zip`. The commands below also accept the usual `(1)` download suffix.

From PowerShell:

```powershell
cd C:\Users\USER\job-tracker

$trackerFrontendZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter "job-tracker-edit-archive-frontend*.zip" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $trackerFrontendZip) {
    throw "Download job-tracker-edit-archive-frontend.zip into Downloads first."
}

$trackerFrontendBackup = Join-Path $env:TEMP ("job-tracker-frontend-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

Compress-Archive -LiteralPath @(
    ".\frontend\src\components\application-dashboard.tsx",
    ".\frontend\src\components\save-role-form.tsx",
    ".\frontend\src\components\mark-applied-form.tsx",
    ".\frontend\src\lib\applications-api.ts",
    ".\frontend\tests\applications-api.test.mjs"
) -DestinationPath $trackerFrontendBackup -ErrorAction Stop

Expand-Archive -LiteralPath $trackerFrontendZip.FullName -DestinationPath $PWD.Path -Force -ErrorAction Stop

Write-Output "Previous frontend files saved at: $trackerFrontendBackup"
```

The backup contains the five existing files being replaced. Extraction also adds the new row-actions component and this guide.

If your Next.js development server is still running, it can reload these source changes automatically. Continue using `http://localhost:3000`.

## 2. Run the frontend checks

Run each command in order, stopping at the first failure:

```powershell
cd C:\Users\USER\job-tracker\frontend

npm.cmd run lint:fix
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:api
npm.cmd run build
```

Expected client-test result: 22 tests pass.

The existing test command is still `node --test tests/applications-api.test.mjs`. Node may print the same module-detection warning as before; that warning does not indicate a failed test.

Validation completed while preparing this package:

- All 22 API-client tests passed locally with simulated HTTP responses.
- All five TypeScript/TSX source files passed syntax parsing.
- The full Next.js typecheck, Biome checks, production build, and interactive browser workflow must run in your Windows project with its installed dependencies and Clerk configuration.

## 3. Ensure the application servers are running

If FastAPI is stopped, start it in its own PowerShell terminal:

```powershell
cd C:\Users\USER\job-tracker\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Use the existing Next.js server when one is already running. If it is stopped:

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run dev
```

Open `http://localhost:3000`. A message saying another Next.js server already runs means you should use that existing server. Your configured frontend origin is localhost on port 3000.

## 4. Verify the browser workflow

Use a practice role so you can check both cancellation and confirmation.

1. Save a role and choose Edit in its row.
2. Change only its company name, then choose Save changes. Confirm the title is preserved.
3. Refresh the browser. Confirm the new company name remains.
4. Edit the title, then choose Cancel. Confirm the stored title is unchanged.
5. Open Edit and choose Save changes without changing anything. It should say No changes to save and keep the editor open.
6. Mark the role as applied, then edit its title. Confirm the application date and Applied stage are preserved.
7. Choose Archive. The confirmation should identify the role and company. Choose Cancel first; the row should remain.
8. Choose Archive again, then Confirm archive. Confirm the row disappears, a success message appears, and the active overview totals update.
9. Refresh. Confirm the archived role stays out of the active list.
10. Use Tab and Enter to operate Edit, Cancel, Archive, and Confirm archive. Opening Edit focuses the company input. Opening archive confirmation focuses Cancel. Cancelling returns focus to the triggering button. A successful archive focuses the dashboard message because its row is removed.

If there is one role left on a later page, archiving it returns to the previous page.

To check draft preservation, open Edit and type a change, then stop FastAPI and attempt a request or Refresh. After the connection error, restart FastAPI and choose Refresh. The draft remains while that editor stays open on the same page. A full browser reload or cancelling the editor discards an unsaved draft.

## How editing works

1. Clicking Edit takes a snapshot of the role currently displayed and opens an inline form.
2. The form reads and trims both labels. It validates text and the 200-character limits.
3. It compares the labels with that snapshot and builds a payload containing only changed fields.
4. The dashboard gets a current Clerk token and starts a mutation. A shared guard prevents overlapping writes from this dashboard instance.
5. The client sends PATCH with `company` and/or `job_title`; the backend decides ownership from the verified identity.
6. The client validates the returned application and checks that the ID matches the requested role.
7. TanStack Query refreshes the account's list and global totals. The editor closes after the write succeeds. A failed write keeps its inputs.

React preserves the open editor during ordinary rerenders because its component position and key remain stable. The opening snapshot prevents a background refetch from silently replacing a draft.

Concurrent edits to the same field use the backend's last-save-wins behavior. The frontend sends only changed labels, reducing accidental overwrites of other fields.

## How archiving works

1. Archive opens a confirmation identifying the selected role.
2. Cancel closes it without an API request. Confirm archive sends POST with an empty JSON object.
3. The backend retains the record and supplies its archive timestamp. The client checks the timestamp and ID before reporting success.
4. The dashboard refreshes the list and totals from the server.
5. The confirmation message lives outside the row, so it survives removal and can receive keyboard focus.

The active workspace does not yet have an archive browsing/restoration screen. The stored record remains available for that future feature.

## Failed requests and refreshes

- A failed edit or archive request keeps the form/confirmation open and shows the error.
- Writes are not retried automatically.
- A lost connection can leave the client uncertain whether a write committed. The error asks you to refresh before retrying.
- If a write was confirmed but the following list refresh fails, the write remains a success. The dashboard separately labels its data as the last loaded results until Refresh succeeds.
- The list and overview use server responses. A confirmed archive can therefore still appear in the last loaded list if its refresh failed; actions remain disabled until the list recovers.
- Query caches remain separated by account, and the backend continues to enforce ownership.

## 5. Commit after checks and browser verification pass

This stages the backend edit/archive milestone and the new frontend controls together:

```powershell
cd C:\Users\USER\job-tracker

git check-ignore .env backend/.env backend/.env.migrations frontend/.env.local

git add backend/app/applications.py backend/app/schemas.py backend/app/main.py
git add backend/tests/test_application_management.py EDIT-ARCHIVE-BACKEND.md

git add frontend/src/components/application-dashboard.tsx frontend/src/components/application-actions.tsx
git add frontend/src/components/save-role-form.tsx frontend/src/components/mark-applied-form.tsx
git add frontend/src/lib/applications-api.ts frontend/tests/applications-api.test.mjs EDIT-ARCHIVE-FRONTEND.md

git diff --cached --stat
git commit -m "Add application editing and archive workflows"
git status
```

## Primary documentation

- [React component state and keys](https://react.dev/learn/preserving-and-resetting-state)
- [React accessible IDs](https://react.dev/reference/react/useId)
- [TanStack Query invalidation after mutations](https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations)
