# Job Application Tracker

A full-stack application for organising a personal job search. Save opportunities, record application dates, update progress, and archive or restore roles from an authenticated dashboard. Records are stored in PostgreSQL and persist across browser refreshes and container restarts.

The project combines a Next.js and TypeScript frontend with a FastAPI backend, Clerk authentication, SQLAlchemy models, Alembic migrations, and Docker Compose.

## Features

- **Personal workspace:** Clerk sign-in and sign-up, with API ownership checks using the verified issuer and subject.
- **Saved opportunities:** create roles with a company and job title, then edit those details without changing application progress.
- **Application progress:** record an application date and move between Applied, Screening, Interview, Offer, Rejected, and Withdrawn.
- **Archive and restore:** keep archived records in a separate paginated view and restore their details, stage, and application date.
- **Overview cards:** track active roles, submitted applications, interviews, and offers across all pages.
- **Request feedback:** loading and pending states, validation messages, stale-stage conflict handling, and refresh guidance when a write cannot be confirmed.

## Technology

| Area | Implementation |
| --- | --- |
| Frontend | Next.js 16.4.1 App Router, React 19.3, TypeScript, Tailwind CSS |
| API integration | TanStack Query and an authenticated fetch client |
| Backend | Python 3.13, FastAPI, Pydantic, SQLAlchemy, Psycopg |
| Authentication | Clerk, with backend verification of bearer session tokens |
| Database | PostgreSQL 18.6 and Alembic migrations |
| Containers | Docker multi-stage builds and Docker Compose health checks |
| Checks | Python unittest, Node.js test runner, Biome, TypeScript |

## How the services connect

The browser loads Next.js pages and obtains a Clerk session token. Its API client sends that token in the `Authorization: Bearer ...` header to FastAPI. The API verifies the identity and scopes database operations to the corresponding internal user.

| Connection | Address in this setup |
| --- | --- |
| Browser to frontend | `http://localhost:3000` |
| Browser to API | `http://127.0.0.1:8000` |
| API container to PostgreSQL | `db:5432` |
| Host Python to PostgreSQL | `127.0.0.1:5433` |

The Compose services are published on loopback for local use. The database uses the named `postgres_data` volume in the `job-tracker` Compose project.

## Requirements

- Docker Desktop running Linux containers.
- Git.
- Python 3.13 with the Windows `py` launcher for host-side setup and migrations.
- Node.js 24 and npm for host-side frontend development and checks.
- A Clerk application with development API keys.

The commands below use Windows PowerShell and run from the repository root unless a directory change is shown. The frontend and API images install their own Linux dependencies.

**Already configured the environment files, database roles, and migrations? Go to [Run with Docker](#run-with-docker).**

## First-time setup

### 1. Install the host dependencies

Clone this repository and open PowerShell in its root directory. Create the backend virtual environment:

```powershell
py -3.13 -m venv backend/.venv
.\backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
.\backend\.venv\Scripts\python.exe -m pip check
```

Install frontend dependencies:

```powershell
cd frontend
npm.cmd ci
cd ..
```

### 2. Create local configuration

On a fresh checkout, copy the committed templates:

```powershell
Copy-Item .env.example .env
Copy-Item backend/.env.example backend/.env
Copy-Item backend/.env.migrations.example backend/.env.migrations
```

Configure these local files with your own values:

| File | Settings |
| --- | --- |
| `.env` | `POSTGRES_DB=job_tracker`, `POSTGRES_USER=job_tracker_admin`, and a database administrator password in `POSTGRES_PASSWORD`. |
| `backend/.env` | `DB_HOST=127.0.0.1`, `DB_PORT=5433`, `DB_NAME=job_tracker`, `DB_USER=job_tracker_app`, and the application-role password in `DB_PASSWORD`. Also set the Clerk values described below. |
| `backend/.env.migrations` | `MIGRATION_DB_HOST=127.0.0.1`, `MIGRATION_DB_PORT=5433`, `MIGRATION_DB_NAME=job_tracker`, `MIGRATION_DB_USER=job_tracker_migrator`, and the migration-role password in `MIGRATION_DB_PASSWORD`. |

Use distinct passwords for the administrator, application, and migration accounts. Replace the templates' password placeholders before starting services. The application and migration passwords will also be assigned to the matching PostgreSQL roles in step 4.

In `backend/.env`, configure:

- `CLERK_SECRET_KEY`: the secret key for your Clerk instance.
- `CLERK_ISSUER`: that instance's Frontend API origin, including `https://` and with no trailing slash.
- `CLERK_AUTHORIZED_PARTIES`: the JSON list `["http://localhost:3000"]`.
- `CLERK_JWT_KEY`: optional; leave it absent unless using the supported local JWT verification-key configuration.

Create `frontend/.env.local` with your own Clerk keys and these local addresses:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=YOUR_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY=YOUR_CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Use the same Clerk application and instance for both services. The local configuration uses development keys. Clerk's [environment variable reference](https://clerk.com/docs/guides/development/clerk-environment-variables) explains the key types and redirect settings.

The four local environment files are ignored by Git. Confirm the ignore rules without printing their contents:

```powershell
git check-ignore .env backend/.env backend/.env.migrations frontend/.env.local
```

### 3. Start PostgreSQL

```powershell
docker compose config --quiet
docker compose up -d --wait --wait-timeout 60 db
```

The administrator settings initialise a new PostgreSQL data volume. Existing volumes retain their database accounts and data.

### 4. Create the database roles and schema

For a newly initialised database, run the role-creation scripts once:

```powershell
Get-Content -Raw -Encoding UTF8 backend/sql/create_app_role.sql | docker compose exec -T db psql -U job_tracker_admin -d job_tracker -v ON_ERROR_STOP=1 -f -

Get-Content -Raw -Encoding UTF8 backend/sql/create_migration_role.sql | docker compose exec -T db psql -U job_tracker_admin -d job_tracker -v ON_ERROR_STOP=1 -f -
```

Open an interactive database session:

```powershell
docker compose exec db psql -U job_tracker_admin -d job_tracker
```

At the `psql` prompt, run `\password job_tracker_app` by itself. Enter the **same application-role password saved in `backend/.env`** twice when prompted. Password input is hidden.

Then run `\password job_tracker_migrator` by itself and enter the **same migration-role password saved in `backend/.env.migrations`** twice. Finally, run `\q` to return to PowerShell.

These commands assume the default administrator and database names listed above. If you chose different names, adjust the scripts and connection arguments consistently.

### 5. Apply database migrations

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m alembic current
.\.venv\Scripts\python.exe -m alembic check
cd ..
```

Alembic uses the separate migration account. The API uses `job_tracker_app`, which has scoped runtime permissions. The initial migration creates `tracker.users`, `tracker.applications`, their constraints, and application table grants. The API container does not run migrations at startup.

### 6. Build the images

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml --profile test config --quiet

docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml --profile test build --pull api api-tests frontend
```

The first build downloads the base images and dependencies. It also needs network access for any fonts fetched by the existing Next.js layout.

The API image uses Python 3.13 and the pinned backend requirements. The frontend image uses Node 24.21.0, installs from `package-lock.json`, and builds Next.js standalone output. Both application containers run as non-root users.

## Run with Docker

After first-time setup, start the full application from the repository root:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --wait --wait-timeout 90 db api frontend

docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml ps
```

Open **[http://localhost:3000](http://localhost:3000)**, sign in, and save a role. Use that exact frontend origin to match the configured authorized party and CORS settings.

| Check | URL |
| --- | --- |
| API liveness | `http://127.0.0.1:8000/health` |
| API database readiness | `http://127.0.0.1:8000/ready` |
| Frontend HTTP serving | `http://localhost:3000/healthz.html` |
| Interactive API documentation | `http://127.0.0.1:8000/docs` |

The API readiness probe verifies a database connection. The frontend probe verifies that its HTTP server serves the health asset; browser checks cover sign-in and application workflows.

Stop the services while retaining their containers and stored data:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml stop frontend api db
```

Read recent application logs:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml logs --tail 80 frontend api
```

### Rebuild after changes

After changing application source, rebuild the affected service, then run the startup command again. For example:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build frontend
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --wait --wait-timeout 90 frontend
```

After changing `frontend/.env.local`, rebuild with `--no-cache` and recreate the frontend container:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build --no-cache frontend
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --force-recreate --wait --wait-timeout 90 frontend
```

Next.js fixes browser-visible `NEXT_PUBLIC_*` values at build time. The existing frontend environment file is supplied as a temporary BuildKit secret outside the project folder. The build helper checks deployable files for environment files and the literal Clerk secret key before the runtime image is assembled. Server settings are supplied again at runtime. Build-secret contents do not automatically invalidate Docker's build cache.

### Port conflicts

Stop any host Uvicorn or Next.js development servers in their own terminals with **Ctrl+C** before starting the Docker services on ports 8000 and 3000.

To identify a port owner in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen |
    Select-Object LocalAddress, LocalPort, OwningProcess
```

Inspect the current process before stopping it. Use Ctrl+C in the terminal running the development server so its reload supervisor shuts down as well.

## Tests and checks

GitHub Actions runs the frontend checks and production build, and checks database migrations and backend tests in a separate job with a temporary PostgreSQL database. See [CI.md](CI.md) for the workflow configuration and how to read a failed run.

### Backend integration tests in Docker

Build the `api-tests` image during first-time setup, or rebuild it after backend/test changes:

```powershell
docker compose -f compose.yaml -f compose.api.yaml --profile test build api-tests
docker compose -f compose.yaml -f compose.api.yaml run --rm api-tests
```

The current backend suite contains **66 tests**. Its database fixtures use the runtime application account and roll back verification records. Coverage includes identity verification, account isolation, validation, ownership, pagination, edits, archive/restore, application dates, stage changes, and transaction rollback.

The same suite can run from the host with the local environment configured and PostgreSQL running:

```powershell
cd backend
.\.venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py" -v
cd ..
```

### Frontend checks

```powershell
cd frontend
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:api
cd ..
```

The current API client suite contains **40 tests**, including bearer credentials, response validation, cancellation, stage conflicts, archive/restore, and uncertain write outcomes. `lint:fix` is also available to apply Biome's automatic fixes. The Docker frontend build performs the production build in Linux.

## API overview

Application routes and `/api/me` require a verified Clerk bearer session token. Health endpoints are public.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/health` | API liveness |
| GET | `/ready` | Database connection readiness |
| GET | `/api/me` | Verified authentication identity |
| GET | `/api/applications` | Paginated active roles and active overview totals |
| POST | `/api/applications` | Create a saved role from `company` and `job_title` |
| GET | `/api/applications/archived` | Paginated archived roles, archive total, and active overview |
| PATCH | `/api/applications/{application_id}` | Edit company and/or job title |
| POST | `/api/applications/{application_id}/mark-applied` | Record `applied_on` and an IANA `time_zone` |
| POST | `/api/applications/{application_id}/stage` | Change `status` using `expected_status` to check the previous stage |
| POST | `/api/applications/{application_id}/archive` | Archive a role; body `{}` |
| POST | `/api/applications/{application_id}/restore` | Restore a role; body `{}` |

List endpoints accept `limit` from 1 to 100 and a non-negative `offset`; the default page size is 25. Active overview totals cover all owned active records, independently of the selected page. The archived list has a separate archive total.

## Data and authorization

- `tracker.users` maps a unique Clerk issuer/subject pair to an internal UUID.
- `tracker.applications` stores the owner, company, job title, status, application date, timestamps, and optional archive timestamp.
- A saved role has no application date. Submitted stages require one, enforced by both API validation and a database constraint.
- Application dates use `YYYY-MM-DD` and cannot be in the future in the supplied IANA time zone.
- Mutations lock the owned application row. Stage changes check the expected previous status; an already-achieved target is a no-op.
- Repeated archive and restore commands preserve their intended result. Mark-applied retries with a different date return a conflict.
- The API obtains ownership from the verified identity. Clients cannot assign owners through application request bodies.
- Runtime and migration database accounts have separate permissions. Clerk manages sign-in credentials; the tracker stores the external identity mapping.

## Code and implementation notes

| Location | Responsibility |
| --- | --- |
| `frontend/src/app/` | App Router pages, layout, and sign-in/sign-up routes |
| `frontend/src/components/` | Dashboard, forms, application actions, and restore controls |
| `frontend/src/lib/applications-api.ts` | Authenticated requests and runtime response validation |
| `frontend/tests/` | API client contract and failure-handling tests |
| `backend/app/` | API routes, authentication, settings, models, and schemas |
| `backend/migrations/` | Alembic configuration and schema revisions |
| `backend/sql/` | Database account and schema bootstrap scripts |
| `backend/tests/` | Authentication, database, and API integration tests |
| `compose.yaml` | PostgreSQL service and persistent volume |
| `compose.api.yaml` | API runtime and optional test service |
| `compose.frontend.yaml` | Standalone Next.js service and build-secret wiring |

The milestone documents explain individual implementation steps:

- [Backend Docker setup](DOCKER-BACKEND.md)
- [Frontend Docker setup](DOCKER-FRONTEND.md)
- [Frontend/API connection](FRONTEND-CONNECTION.md)
- [Editing and archiving: backend](EDIT-ARCHIVE-BACKEND.md)
- [Editing and archiving: frontend](EDIT-ARCHIVE-FRONTEND.md)
- [Archived view and restore](ARCHIVE-RESTORE.md)
- [Stage updates and stale-change checks](STAGE-UPDATES.md)

Use this README for the current setup; the milestone guides describe how the project was developed.
