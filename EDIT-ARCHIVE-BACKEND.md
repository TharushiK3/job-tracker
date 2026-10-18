# Edit and archive job applications: backend milestone

Prepared against the five source/test files supplied after commit `75a983b`.

This package adds the API operations. The next milestone connects the dashboard buttons after these backend tests pass.

## What each file does, and why

| File | Change | Why it matters |
| --- | --- | --- |
| backend/app/schemas.py | Adds validated edit/archive request models and an archive response model. Reuses one label definition for creation and editing. | Keeps validation consistent and rejects attempts to change ownership or unrelated fields. |
| backend/app/applications.py | Adds PATCH editing, POST archiving, and a shared ownership/row-lock helper. | Applies each write to an owned record inside a transaction. |
| backend/app/main.py | Adds PATCH to the existing CORS method list. | Allows the configured frontend origin to send browser edit requests. |
| backend/tests/test_application_management.py | Adds 14 PostgreSQL integration tests. | Checks persistence, isolation, validation, retries, rollback, totals, and CORS. |

The existing `archived_at` column is sufficient, so this milestone needs no database migration or additional dependency.

## 1. Install the replacement files

Save the ZIP in Downloads as `job-tracker-edit-archive-backend.zip`.

Stop FastAPI with Ctrl+C in its own terminal before replacing the three application files. Keep Docker running.

In another PowerShell window:

```powershell
cd C:\Users\USER\job-tracker

$trackerBackendPackage = Join-Path $env:USERPROFILE "Downloads\job-tracker-edit-archive-backend.zip"
if (-not (Test-Path -LiteralPath $trackerBackendPackage)) {
    throw "Save job-tracker-edit-archive-backend.zip in Downloads first."
}

$trackerBackendBackup = Join-Path $env:TEMP ("job-tracker-backend-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")

Compress-Archive -LiteralPath @(
    ".\backend\app\applications.py",
    ".\backend\app\schemas.py",
    ".\backend\app\main.py"
) -DestinationPath $trackerBackendBackup -ErrorAction Stop

Expand-Archive -LiteralPath $trackerBackendPackage -DestinationPath $PWD.Path -Force -ErrorAction Stop

Write-Output "Previous backend files saved at: $trackerBackendBackup"
```

This backs up the three files being replaced, then adds the replacements, the new test file, and this guide.

## 2. Check the new behavior against PostgreSQL

Start the database, then run the new test file:

```powershell
cd C:\Users\USER\job-tracker
docker compose up -d --wait --wait-timeout 60 db

cd .\backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_application_management.py" -v
```

Expected result: 14 tests pass.

Then run the full backend suite:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
```

Expected result: 40 tests pass, assuming the existing suite still contains the 26 tests previously reported.

Each new integration test uses a temporary transaction and rolls it back. The fixture also checks that it is connected as `job_tracker_app`, so it verifies the runtime database permissions.

If a command fails, share the first failing test and its traceback before continuing.

## 3. Restart FastAPI

After the tests pass:

```powershell
cd C:\Users\USER\job-tracker\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Keep using the existing Next.js server at `http://localhost:3000`. Its current save, list, and mark-applied features continue to use the same API contracts. Edit/archive controls will be connected in the frontend milestone.

## The two API contracts

Both operations require the existing Clerk bearer authentication.

### Edit labels

`PATCH /api/applications/{application_id}`

Send one or both fields:

```json
{"company": "Corrected Company", "job_title": "Software Engineer"}
```

Sending only `company` leaves `job_title` unchanged, and vice versa. Labels are trimmed, must contain text, must not contain control characters, and must be at most 200 characters long. An empty object, explicit null, or an extra field returns 422.

A successful request returns 200 and the existing application response shape. Status, application date, owner, ID, and creation time are preserved. The existing SQLAlchemy `onupdate` behavior supplies `updated_at` when a real update occurs.

### Archive a role

`POST /api/applications/{application_id}/archive`

Send an empty JSON object:

```json
{}
```

A successful request returns 200 with the role ID and its archive timestamp:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "archived_at": "2026-10-18T04:00:00Z"
}
```

The timestamp above is illustrative; the API supplies the actual time.

Archiving sets `archived_at`; it retains the row, company, title, status, and application date. Existing list and overview queries already exclude archived rows, so the active dashboard counts change automatically.

Repeating an archive request as the owner returns the original archive timestamp. This makes a retry safe when the first response was lost. Archived roles reject editing and mark-applied requests with 404.

A missing role or a role belonging to another verified issuer/subject returns the same 404 response. Archive retries still enforce ownership, including when the row is already archived.

## How the implementation works

1. FastAPI validates the path ID and JSON body. This catches invalid input before a write begins.
2. The existing authentication dependency supplies the verified issuer and subject.
3. A transaction begins. The ownership query joins applications to users and checks both identity fields.
4. `FOR UPDATE OF applications` locks the application row while the operation completes. The runtime role has update permission on applications; locking only that table fits the existing scoped database permissions.
5. Editing assigns only explicitly supplied labels. `model_dump(exclude_unset=True)` distinguishes an omitted field from a supplied field.
6. Archiving assigns the timestamp once. Subsequent archive requests return the stored timestamp.
7. SQLAlchemy flushes the change, and the response model is validated before the transaction commits.
8. Successful responses include `Cache-Control: no-store`.

The edit model uses `None` internally to represent omission, rejects explicitly supplied null values, and uses `SkipJsonSchema` so the API documentation describes the accepted string fields.

Concurrent changes to the same label use last-save-wins behavior. The row lock serializes writes and coordinates them with archiving and mark-applied operations.

## Verification performed while preparing the package

- Python compilation passed for all four Python files.
- Request validation passed 3 valid edit cases and rejected 20 invalid edit cases.
- The empty archive request passed; 5 archive requests with extra fields were rejected.
- The edit JSON schema and existing create-label trimming were checked.
- These checks used Pydantic 2.14.0. The supplied Windows environment reports Pydantic 2.14.1.
- The 14 new PostgreSQL/FastAPI integration tests have not been run here because those dependencies and your database are not available in this environment. Run the commands above to verify them in your project.

## Primary documentation

- [FastAPI partial updates and exclude_unset](https://fastapi.tiangolo.com/tutorial/body-updates/)
- [FastAPI CORS configuration](https://fastapi.tiangolo.com/tutorial/cors/)
- [SQLAlchemy row locking](https://docs.sqlalchemy.org/en/21/core/selectable.html#sqlalchemy.sql.expression.Select.with_for_update)
- [Pydantic JSON schema annotations](https://docs.pydantic.dev/latest/concepts/json_schema/)
