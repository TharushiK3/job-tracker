# Browse archived roles and restore them

This update follows commit `56f5d82` (`Add application editing and archive workflows`). It adds an **Archived** view beside **Active**, shows when each role was archived, and lets you restore it.

Restoring clears `archived_at` on the existing database row. The role keeps its ID, company, title, stage, application date, and creation time. Its active summary counts return when the list refreshes. Roles archived before this update also appear in the Archived view.

There are no dependency installations or database migrations for this update. The existing `archived_at` column already stores everything this feature needs.

## What each file does

| File | Purpose |
| --- | --- |
| `backend/app/schemas.py` | Defines the empty restore command and the archived-list response, including archive timestamps and the archived total. |
| `backend/app/applications.py` | Adds an authenticated archived-list endpoint and an owner-scoped restore endpoint. Shares the active summary calculation between both lists. |
| `backend/tests/test_archive_restore.py` | Adds 14 database/API tests for listing, ownership, pagination, restore, repeat requests, and rollback. |
| `frontend/src/lib/applications-api.ts` | Sends archived-list and restore requests with the Clerk bearer token and validates the responses. |
| `frontend/src/components/application-dashboard.tsx` | Adds the view switch, archived table, pagination, restore mutation, and summary refresh. |
| `frontend/src/components/restore-role-button.tsx` | Shows Restore, pending feedback, and useful errors for each archived role. |
| `frontend/tests/applications-api.test.mjs` | Retains the existing 22 tests and adds 10 tests for archived listing and restoration. |
| `ARCHIVE-RESTORE.md` | Explains installation, testing, browser verification, and committing. |

The active-list, create, edit, mark-applied, and archive response shapes are preserved. The new archived-list response extends each role with `archived_at`; the normal active response remains unchanged.

## 1. Download, back up, and extract

Save `job-tracker-archive-restore.zip` in **Downloads**. Windows may add `(1)` to its name; the commands below select the newest matching ZIP.

In the terminal running FastAPI, press **Ctrl+C** before replacing its files. Use a separate PowerShell window for the following commands. Your existing frontend server can reload the frontend changes after extraction.

Run this entire block. It finds the ZIP before writing anything, backs up the five existing files being replaced, then extracts into the project root. The new test, component, and guide have no existing versions to back up at this milestone.

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location C:\Users\USER\job-tracker

    $trackerRestoreZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter "job-tracker-archive-restore*.zip" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $trackerRestoreZip) {
        throw "Save job-tracker-archive-restore.zip in Downloads first."
    }

    $trackerRestoreBackup = Join-Path $env:TEMP ("job-tracker-before-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

    Compress-Archive -LiteralPath @(
        ".\backend\app\schemas.py",
        ".\backend\app\applications.py",
        ".\frontend\src\lib\applications-api.ts",
        ".\frontend\src\components\application-dashboard.tsx",
        ".\frontend\tests\applications-api.test.mjs"
    ) -DestinationPath $trackerRestoreBackup -ErrorAction Stop

    Expand-Archive -LiteralPath $trackerRestoreZip.FullName -DestinationPath . -Force -ErrorAction Stop

    Write-Output "Update extracted. Backup: $trackerRestoreBackup"
}
```

The backup stores those five original files by filename for recovery. Keep it until the update is verified. The extraction adds or replaces only the eight files listed above.

Open this guide locally if useful:

```powershell
notepad C:\Users\USER\job-tracker\ARCHIVE-RESTORE.md
```

## 2. Verify the backend first

Start the existing PostgreSQL container, then run the new tests:

```powershell
cd C:\Users\USER\job-tracker
docker compose up -d --wait --wait-timeout 60 db

cd .\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_archive_restore.py" -v
```

The new file contains **14 tests**. If any fail, stop here and share the failure output before continuing.

If those pass, run the full backend suite to check the earlier workflows too:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Starting from your existing 40 tests, the expected total is **54 tests**. These database tests use an outer transaction and savepoints so their records are rolled back.

## 3. Verify the frontend

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run lint:fix
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:api
npm.cmd run build
```

Run each command after the previous one succeeds. `lint:fix` formats the files using your existing Biome settings. `typecheck` checks the TypeScript contracts; `test:api` checks the HTTP client; `build` checks the production compilation.

The API client suite should report **32 passing tests**. If Node repeats the `MODULE_TYPELESS_PACKAGE_JSON` warning you saw earlier but all tests pass, that warning is informational. This feature does not require changing your package module type.

## 4. Start the app and check it in the browser

Start FastAPI again in its own terminal and leave it running:

```powershell
cd C:\Users\USER\job-tracker\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Use your existing frontend server at [http://localhost:3000](http://localhost:3000). If it is stopped, start it in another terminal:

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run dev
```

If Next says a server is already running for this project, open the existing localhost:3000 address. Your Clerk authorized origin is localhost:3000.

Check these behaviors:

1. Sign in. **Active** shows your current roles and the same four summary cards.
2. Open **Archived**. Previously archived roles appear with their stage, application date, and archive time. Archive times are displayed in your device's time zone.
3. Restore a role. Its row leaves Archived, and a confirmation appears above the table. The summary cards update for the returned active role.
4. Open **Active** and find that role. Its company, title, stage, and application date should be preserved. Active ordering still uses the original creation time, so an older restored role may be farther down the list.
5. Reload the browser. The role stays active because restoration is stored in PostgreSQL. The selected view resets to Active on a full reload.
6. Archive and restore the same role again. There should still be one role, not a duplicate.
7. Sign out and sign in as a second account if available. Each account should see only its own active and archived roles.

The page remains in Archived after a restore so you can restore more roles. Both lists use 25 roles per page. The Archived footer counts archived roles, while the four summary cards always count active roles.

## How the requests work

| Request | Result |
| --- | --- |
| `GET /api/applications/archived?limit=25&offset=0` | A page of owned archived roles, ordered by archive time and ID, plus the archived total and active overview. |
| `POST /api/applications/{id}/restore` with `{}` | The existing role with its archive marker cleared, returned in the usual active-role format. |

Both endpoints require the verified Clerk identity. Ownership checks use issuer and subject together. A missing or differently owned role returns 404. The restore body rejects extra fields so callers cannot change ownership, stage, or dates through this command.

The restore transaction locks only the application row. Restoring an already active owned role returns it unchanged, so a repeated request after a lost response does not create another role. The frontend still avoids automatic write retries; an uncertain response tells you to refresh before trying again.

The dashboard includes the account, selected view, and page offset in its query key. A successful write invalidates both lists for that account. A failed refresh is shown separately from a confirmed write, with stale results clearly labelled and write controls disabled until the list recovers.

For the underlying patterns, see [TanStack Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys) and [SQLAlchemy tests using external transactions](https://docs.sqlalchemy.org/en/21/orm/session_transaction.html#joining-a-session-into-an-external-transaction-such-as-for-test-suites).

## Verification performed while preparing this package

- All **32 API client tests passed** using Node 24.
- The three Python files compiled, and Pydantic smoke checks verified the new archive/restore models while preserving the earlier active response fields.
- The modified TypeScript and TSX files passed syntax parsing.

The FastAPI/PostgreSQL integration tests, full Next typecheck/build, and browser workflow need to run in your Windows project with its installed dependencies and database. They have not been run against your laptop from here. Expected test totals above are targets for your verification, not claims that your local tests already passed.

## 5. Commit after the tests and browser checks pass

Review and stage only the update files:

```powershell
cd C:\Users\USER\job-tracker
git status --short
git diff --check

git add backend/app/schemas.py backend/app/applications.py backend/tests/test_archive_restore.py
git add frontend/src/lib/applications-api.ts frontend/src/components/application-dashboard.tsx frontend/src/components/restore-role-button.tsx
git add frontend/tests/applications-api.test.mjs ARCHIVE-RESTORE.md

git diff --cached --stat
git commit -m "Add archived role browsing and restoration"
git status
```

This creates the next local milestone after `56f5d82`.
