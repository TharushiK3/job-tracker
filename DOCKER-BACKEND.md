# Run the FastAPI backend in Docker

This milestone follows commit `595fc30` (`Add application stage updates with stale-change checks`). It adds an API container and a separate container for running the existing backend test suite.

The browser still opens the Next.js frontend at **http://localhost:3000**. Its API address stays **http://127.0.0.1:8000**. PostgreSQL continues to use your existing `job-tracker` Compose project, `postgres_data` volume, database, roles, and tables.

## The five new files

| File | Purpose |
| --- | --- |
| `backend/Dockerfile` | Builds a shared Python/application layer, a test target, and the final API runtime target. |
| `backend/.dockerignore` | Restricts build inputs to the source, requirements, tests, and readiness probe. |
| `backend/docker/healthcheck.py` | Calls the container's `/ready` endpoint and succeeds only when the API reports a database connection. |
| `compose.api.yaml` | Adds `api` and the optional `api-tests` service alongside your existing database configuration. |
| `DOCKER-BACKEND.md` | Explains setup, verification, everyday commands, and committing. |

Your application Python files, requirements, base `compose.yaml`, and frontend files do not need edits for this milestone.

## How the addresses fit together

| Caller | Destination | Address |
| --- | --- | --- |
| Browser | Next.js frontend | `http://localhost:3000` |
| Browser / frontend API client | Containerized API | `http://127.0.0.1:8000` |
| API container | PostgreSQL container | `db:5432` |
| Windows Python virtual environment | PostgreSQL published on Windows | `127.0.0.1:5433` |

Compose services on the same network can find one another by service name. The API therefore uses `db` and PostgreSQL's internal port `5432`. Inside the API container, `127.0.0.1` refers to that API container itself.

The API services read your existing `backend/.env` at runtime. Their Compose `environment` entries override only `DB_HOST` and `DB_PORT`. Your host environment file retains the Windows database address for the virtual-environment workflow.

## 1. Download and extract

Save **job-tracker-docker-backend.zip** in Downloads. Run this block in PowerShell:

```powershell
& {
    $ErrorActionPreference = "Stop"
    Set-Location C:\Users\USER\job-tracker

    $trackerDockerZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter "job-tracker-docker-backend*.zip" -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1

    if ($null -eq $trackerDockerZip) {
        throw "Save job-tracker-docker-backend.zip in Downloads first."
    }

    $trackerDockerTargets = @(
        ".\backend\Dockerfile",
        ".\backend\.dockerignore",
        ".\backend\docker\healthcheck.py",
        ".\compose.api.yaml",
        ".\DOCKER-BACKEND.md"
    )
    $trackerDockerExisting = @($trackerDockerTargets | Where-Object { Test-Path -LiteralPath $_ })

    if ($trackerDockerExisting.Count -gt 0) {
        $trackerDockerBackup = Join-Path $env:TEMP ("job-tracker-before-api-docker-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".zip")
        Compress-Archive -LiteralPath $trackerDockerExisting -DestinationPath $trackerDockerBackup -ErrorAction Stop
        Write-Output "Existing Docker files backed up: $trackerDockerBackup"
    }

    Expand-Archive -LiteralPath $trackerDockerZip.FullName -DestinationPath . -Force -ErrorAction Stop
    Write-Output "Backend Docker files extracted."
}
```

This ZIP contains only the five files listed above. The base database Compose file is not replaced.

## 2. Check Docker and validate the configuration

```powershell
cd C:\Users\USER\job-tracker
docker info --format '{{.ServerVersion}} ({{.OSType}})'
docker compose -f compose.yaml -f compose.api.yaml --profile test config --quiet
```

The first command should show a Docker server version and `linux`. If Docker cannot connect, open Docker Desktop, wait until its engine is running, and repeat that command.

The configuration command should finish without errors. `--quiet` validates the merged configuration without printing expanded environment values. The test profile includes the test service in this validation.

## 3. Build the API and test images

```powershell
docker compose -f compose.yaml -f compose.api.yaml --profile test build --pull api api-tests
```

The first build downloads the Python image and the Linux packages listed in your existing requirements file. Allow it to finish. Stop here if the build reports an error.

The Dockerfile uses the official **Python 3.13.16 slim Bookworm** image, retaining the same Python 3.13 minor version as your Windows environment. It installs your pinned requirements and runs `pip check` during the build.

Requirements are copied before the application source so later source edits can reuse the dependency layer. Both targets use that same layer. The final runtime target adds the readiness probe and starts Uvicorn. The test target adds the test folder and runs unittest.

Both targets run as the `tracker` Linux account, UID/GID `10001`. Compose drops Linux capabilities and prevents the process from gaining new privileges. Uvicorn listens on port 8000 inside the container, and Compose publishes that port on Windows loopback.

## 4. Run the existing tests inside Linux

Start or reuse the existing database, then run the test image:

```powershell
docker compose -f compose.yaml -f compose.api.yaml up -d --wait --wait-timeout 60 db
docker compose -f compose.yaml -f compose.api.yaml run --rm api-tests
```

Expect the existing **66 backend tests** to pass. The fixtures use `job_tracker_app` and roll back their database verification records. This verifies the installed Linux dependencies, authentication code, application operations, and database access together.

The `api-tests` service belongs to the `test` profile. Naming it explicitly in `run` enables that service. `--rm` removes the finished test container; the database remains running.

If a build or test fails, share its error output before continuing.

## 5. Start the API container

In the terminal running Windows Uvicorn, press **Ctrl+C** first so port 8000 is available. Your existing Next.js server at localhost:3000 can keep running.

```powershell
cd C:\Users\USER\job-tracker
docker compose -f compose.yaml -f compose.api.yaml up -d --wait --wait-timeout 60 api
docker compose -f compose.yaml -f compose.api.yaml ps
```

The API and database should show **healthy**. The API health probe calls `/ready`, which checks the database connection. Uvicorn runs without reload in this image; application edits are applied by rebuilding the image.

Check the HTTP endpoints from Windows:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/ready
```

Expected values are `status: ok` for health, and `status: ready`, `database: connected` for readiness.

Check the Linux account:

```powershell
docker compose -f compose.yaml -f compose.api.yaml exec api id
```

It should show UID/GID `10001` with the account name `tracker`.

To confirm which database account the running API uses:

```powershell
@'
from sqlalchemy import text
from app.database import engine

try:
    with engine.connect() as connection:
        account = connection.execute(text("SELECT current_user")).scalar_one()
        print("Database account:", account)
        if account != "job_tracker_app":
            raise RuntimeError("Expected the runtime application account.")
finally:
    engine.dispose()
'@ | docker compose -f compose.yaml -f compose.api.yaml exec -T api python -
```

Expected output: `Database account: job_tracker_app`.

## 6. Check the real browser connection

Open [http://localhost:3000](http://localhost:3000) using the existing frontend server. The message that another Next dev server is running means you can use that existing server.

Check these behaviors against the Docker API:

1. Sign in and confirm your existing roles load.
2. Save a test role and refresh the browser; it should remain saved.
3. Mark it as applied and change its stage to Interview.
4. Archive and restore it, confirming its stage and application date are preserved.

This checks the browser, Clerk bearer token, containerized API, and existing PostgreSQL database together. No new frontend build is needed for this backend-only packaging change.

## Everyday commands

Run API Compose commands from `C:\Users\USER\job-tracker`, with both files supplied.

Show recent API logs:

```powershell
docker compose -f compose.yaml -f compose.api.yaml logs --tail 80 api
```

Stop only the API container:

```powershell
docker compose -f compose.yaml -f compose.api.yaml stop api
```

Start it again:

```powershell
docker compose -f compose.yaml -f compose.api.yaml up -d --wait --wait-timeout 60 api
```

After changing Python application code, repeat the build and test commands from steps 3 and 4, then run the API startup command. Compose will recreate the API container from the newly built image.

To use Windows Uvicorn again, stop the Docker API first, then run:

```powershell
cd C:\Users\USER\job-tracker\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

The Windows settings still use the published database port 5433. The database container and stored roles remain available.

## How configuration and storage are used

Your base file declares `name: job-tracker`, the `db` service, and `postgres_data`. The additional file declares only the API services, so merging the two retains those existing database settings and volume.

The root `.env` continues supplying the database administrator's container configuration. `backend/.env` supplies the API's runtime credentials and Clerk settings through Compose `env_file`. These values are passed when containers are created. They are not Docker build arguments or copied image files.

The build context is the backend directory. Its ignore file permits only the Dockerfile inputs and excludes local environment files, virtual environments, and Python caches. The final runtime target copies the application and health probe; the test folder belongs to the separate test target. Migration scripts and migration credentials are not used by these runtime commands because this milestone uses the schema you already migrated.

## Verification performed while preparing these files

- The Compose YAML parsed successfully, and its service settings were checked against your supplied configuration.
- Dockerfile command arrays and the Python health probe passed syntax checks.
- The official Python image tag and the Compose features used here were checked against primary documentation.

Docker is unavailable in the preparation environment, so these images have **not** been built or run here. The build, `pip check`, **66-test Linux run**, container health, and browser verification must run on your Windows Docker Desktop installation.

## Commit after the checks pass

```powershell
cd C:\Users\USER\job-tracker
git status --short
git diff --check

git add backend/Dockerfile backend/.dockerignore backend/docker/healthcheck.py compose.api.yaml DOCKER-BACKEND.md
git diff --cached --stat
git commit -m "Containerize FastAPI with readiness checks and a test image"
git status
```

## Primary references

- [FastAPI in Docker](https://fastapi.tiangolo.com/deployment/docker/)
- [Official Python image tags](https://github.com/docker-library/official-images/blob/master/library/python)
- [Compose networking](https://docs.docker.com/compose/how-tos/networking/)
- [Compose environment precedence](https://docs.docker.com/compose/how-tos/environment-variables/envvars-precedence/)
- [Merging Compose files](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)
- [Docker build contexts and ignore rules](https://docs.docker.com/build/concepts/context/)
- [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/)
