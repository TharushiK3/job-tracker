# Update application stages

This update follows the completed Archived view and Restore milestone. It adds **Change stage** to active roles that have an application date.

For example, mark a saved role as applied, then change its stage to **Screening**, **Interview**, or **Offer**. You can also record **Rejected** or **Withdrawn**, or correct the stage back to **Applied**. The original application date stays the same.

The summary cards continue to count active roles. Moving a role to Interview increases the interview count; moving it from Interview to Offer decreases interviews and increases offers. The submitted count stays the same because the application date is retained.

## Files and responsibilities

| File | What it does |
| --- | --- |
| `backend/app/schemas.py` | Defines the six permitted submitted stages and rejects unexpected fields in a stage command. |
| `backend/app/applications.py` | Adds the authenticated stage endpoint with ownership checks, a row lock, and a previous-stage check. |
| `backend/tests/test_application_stages.py` | Adds 12 integration tests for transitions, dates, permissions, stale requests, totals, and rollback. |
| `frontend/src/lib/applications-api.ts` | Sends the chosen stage and the stage shown when the form opened; validates the confirmation. |
| `frontend/src/components/application-dashboard.tsx` | Adds the stage mutation and refreshes the lists and totals after success. Includes the corrected fieldset/legend view switch. |
| `frontend/src/components/application-actions.tsx` | Adds the Change stage button and opens the inline form alongside the existing Edit and Archive workflows. |
| `frontend/src/components/update-stage-form.tsx` | Provides a labelled dropdown, Save stage, Cancel, pending feedback, errors, and keyboard focus. |
| `frontend/tests/applications-api.test.mjs` | Retains the previous 32 tests and adds 8 stage-request tests. |
| `STAGE-UPDATES.md` | Explains setup, behavior, verification, and the next commit. |

No dependency installation, database migration, environment change, or CORS change is needed. The database already supports all seven statuses, and this endpoint uses the POST method already allowed by your backend.

## 1. Download and install the files

Save **job-tracker-stage-updates.zip** in Downloads. In the FastAPI terminal, press **Ctrl+C** before extraction. Run the block below in a separate PowerShell window from your Windows project.

The block backs up the six existing files being replaced. The new form, test file, and guide have no previous versions at this milestone.

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location C:\Users\USER\job-tracker

    $trackerStageZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter "job-tracker-stage-updates*.zip" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $trackerStageZip) {
        throw "Download job-tracker-stage-updates.zip into Downloads first."
    }

    $trackerStageBackup = Join-Path $env:TEMP ("job-tracker-before-stages-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

    Compress-Archive -LiteralPath @(
        ".\backend\app\schemas.py",
        ".\backend\app\applications.py",
        ".\frontend\src\lib\applications-api.ts",
        ".\frontend\src\components\application-dashboard.tsx",
        ".\frontend\src\components\application-actions.tsx",
        ".\frontend\tests\applications-api.test.mjs"
    ) -DestinationPath $trackerStageBackup -ErrorAction Stop

    Expand-Archive -LiteralPath $trackerStageZip.FullName -DestinationPath . -Force -ErrorAction Stop
    Write-Output "Stage update extracted. Backup: $trackerStageBackup"
}
```

The backup stores the six original files by filename. Keep it until the update has been verified. The downloaded ZIP extracts only the nine files listed in the table.

## 2. Run the backend checks

```powershell
cd C:\Users\USER\job-tracker
docker compose up -d --wait --wait-timeout 60 db

cd .\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_application_stages.py" -v
```

Expect **12 tests** in the new file. Stop if a test fails and share the failure output before continuing.

After the new tests pass, run the full suite:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Starting from your verified 54 tests, the expected total is **66 tests**. The fixture uses your runtime database role and rolls back its verification records.

## 3. Run the frontend checks

Run each command after the previous one succeeds:

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run lint:fix
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:api
npm.cmd run build
```

Expect **40 passing API client tests**. The new dropdown and the Active/Archived switch use native HTML elements, including fieldsets and legends for the grouped controls.

The existing Node module-type warning may appear during the tests. If the suite passes, that informational warning does not require a package-type change for this feature.

## 4. Start the servers

Start FastAPI in its own terminal and leave it running:

```powershell
cd C:\Users\USER\job-tracker\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Open your existing frontend at [http://localhost:3000](http://localhost:3000). If it is stopped, use another terminal:

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run dev
```

If Next reports that this project already has a server running, use its existing localhost:3000 address.

## 5. Check the workflow in the browser

1. Save a test role. A saved role should offer **Mark as applied**, plus the existing Edit and Archive actions.
2. Mark it as applied with a valid application date. The row should now offer **Change stage**.
3. Open Change stage and choose **Interview**. Save it. The status badge and interview summary should update, and the application date should stay the same.
4. Change Interview to **Offer**. Interviews should decrease by one and offers should increase by one. The tracked-role and submitted counts should stay the same.
5. Reload the browser. The stage should still be Offer.
6. Try **Cancel** after choosing a different stage. No change should be saved.
7. Edit the role, then archive and restore it. Its latest stage and original application date should be retained.

You can select any of the six submitted stages to reflect the current situation or correct an earlier selection. Saved roles use Mark as applied first, which supplies the date required by the existing database rule.

Optional two-tab check: open Change stage for an Applied role in the first tab. In the second tab, change that role to Interview. Return to the first tab and try saving Offer from the old form. The server should return a conflict if the form still carries the old Applied stage. Cancel the old form, Refresh the list, reopen Change stage, then choose the stage again. This avoids overwriting a different stage without first loading it.

The form retains your selection when a request fails. On a conflict, its message explains how to reopen the form with current data. The frontend does not automatically retry writes. After a connection failure with uncertain confirmation, refresh the list before deciding whether another change is needed.

## What the backend receives

```http
POST /api/applications/{id}/stage
Authorization: Bearer <Clerk session token>
Content-Type: application/json

{
  "expected_status": "applied",
  "status": "interview"
}
```

`status` is the requested new stage. `expected_status` is the stage shown when the form opened. The server derives ownership from the verified Clerk identity, rather than accepting an owner from the request.

Inside one transaction, the server checks ownership and locks the application row. If the current stage already equals the requested target, it returns the current role without another update. Otherwise, it checks that the current stage matches `expected_status` before writing.

That permits a repeated request for an already reached stage while rejecting a stale request that would replace a different current stage. For example, a late retry of Applied to Interview is rejected if the role has since moved to Offer. This compares stage values, not a complete history of previous changes.

Archived or differently owned roles return 404. Saved roles return 409 and direct you to Mark as applied. Invalid commands or extra fields return 422. A successful response uses the usual active-role shape with `Cache-Control: no-store`.

The frontend uses a controlled React select: state holds the selected stage, and `onChange` updates it. The dashboard's mutation sends the request, then invalidates both active and archived queries so the server's totals are loaded again.

References: [React select documentation](https://react.dev/reference/react-dom/components/select), [SQLAlchemy SELECT / FOR UPDATE](https://docs.sqlalchemy.org/en/21/core/selectable.html#sqlalchemy.sql.expression.GenerativeSelect.with_for_update), and [TanStack Query invalidation](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation).

## Verification when preparing this package

- All **40 API client tests passed** locally with Node 24.
- Python syntax checks and stage-schema smoke checks passed.
- The four changed or new TypeScript/TSX source files passed syntax parsing.
- The previous active/archive response contracts and the corrected view-switch markup were retained.

The **12 new database tests**, full **66-test** backend suite, complete Next lint/typecheck/build, and browser checks must run in your Windows project. They have not been run against your database or installed Next dependencies from here. The totals above are expected results for that verification.

## 6. Commit after the checks pass

```powershell
cd C:\Users\USER\job-tracker
git status --short
git diff --check

git add backend/app/schemas.py backend/app/applications.py backend/tests/test_application_stages.py
git add frontend/src/lib/applications-api.ts frontend/src/components/application-dashboard.tsx frontend/src/components/application-actions.tsx frontend/src/components/update-stage-form.tsx
git add frontend/tests/applications-api.test.mjs STAGE-UPDATES.md

git diff --cached --stat
git commit -m "Add application stage updates with stale-change checks"
git status
```

This records a separate milestone after Archive and Restore.
