# Run the full tracker with Docker

This update adds the Next.js frontend to your existing PostgreSQL and FastAPI containers. Open the tracker at **http://localhost:3000**. Its browser requests still go to **http://127.0.0.1:8000**.

This is a local setup using your existing Clerk development instance. The server runs an optimized build rather than `next dev`. Docker Desktop must be running with Linux containers.

## What the ZIP contains

| File | Purpose |
| --- | --- |
| `frontend/next.config.ts` | Add standalone output; keep Cache Components, Partial Prefetching, and the Tailwind Turbopack rule. |
| `frontend/Dockerfile` | Install from the lockfile, build in Linux, and run standalone Next.js as the non-root `node` user. |
| `frontend/.dockerignore` | Limit the build context and exclude local environment files and Windows dependencies. |
| `frontend/docker/build.mjs` | Validate required settings, build, and check deployable files for the Clerk secret. |
| `frontend/docker/healthcheck.mjs` | Check that the frontend serves its health asset. |
| `frontend/public/healthz.html` | Public health asset, excluded by your existing proxy matcher for HTML files. |
| `compose.frontend.yaml` | Add the frontend after the API is healthy. |
| `DOCKER-FRONTEND.md` | These instructions. |

The existing `compose.yaml` and `compose.api.yaml` are used alongside the new file. Your existing database volume and migrations continue to be used. No application source, dependency versions, or environment files are replaced by this ZIP.

## 1. Save the ZIP and install the files

Save **job-tracker-docker-frontend.zip** in your Windows **Downloads** folder. Then paste this block into PowerShell:

```powershell
cd C:\Users\USER\job-tracker

$trackerFrontendZip = Get-ChildItem -LiteralPath "$env:USERPROFILE\Downloads" -Filter "job-tracker-docker-frontend*.zip" -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1

if ($null -eq $trackerFrontendZip) {
    throw "Download job-tracker-docker-frontend.zip into Downloads first."
}

$trackerFrontendBackup = Join-Path $env:TEMP ("job-tracker-next-config-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".ts")
Copy-Item -LiteralPath ".\frontend\next.config.ts" -Destination $trackerFrontendBackup -ErrorAction Stop

Expand-Archive -LiteralPath $trackerFrontendZip.FullName -DestinationPath . -Force -ErrorAction Stop
git diff --check
```

## 2. Check the address and validate Compose

Open your existing frontend configuration:

```powershell
notepad .\frontend\.env.local
```

Make sure this line is present once:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Keep the existing Clerk publishable key, secret key, and sign-in/sign-up route settings in that file. Save and close Notepad. The browser cannot use Docker's internal service name `api` as its API address.

Run:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml config --quiet
```

Success produces no output. Use `--quiet` here because a full resolved configuration contains environment values.

## 3. Build the frontend image

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build --pull frontend
```

The first build downloads Node and Linux npm packages, then runs the Next.js production build. It needs internet access, including access to Google Fonts if your existing layout uses `next/font/google`.

Settings are passed using a BuildKit secret mounted at `/run/secrets/frontend_env`. Node loads it into the build process, outside Next's project folder. The file is excluded from the build context. The Clerk secret is not supplied through Docker build arguments or persistent Dockerfile environment variables. After building, the helper rejects environment files or the literal Clerk secret in the files copied into the runtime image.

Your `NEXT_PUBLIC_*` values are intentionally included in the browser build. The Clerk secret is server-only and is supplied again at runtime through Compose's `env_file`.

## 4. Free port 3000 and start all three services

In the PowerShell window that is **already running `next dev`**, press **Ctrl+C**. That frees port 3000. If your API is still running directly in a Windows Uvicorn terminal, stop that process with Ctrl+C too, so Docker can use port 8000.

In your project PowerShell window, run:

```powershell
cd C:\Users\USER\job-tracker

docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --wait --wait-timeout 90 db api frontend
```

This uses the API image you built in the previous Docker step. If that image is missing, build it, then repeat the `up` command:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build --pull api
```

Check the result:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml ps
Invoke-RestMethod http://127.0.0.1:8000/ready
(Invoke-WebRequest -UseBasicParsing http://localhost:3000/healthz.html).StatusCode
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml exec frontend id
```

Expected: `db`, `api`, and `frontend` are healthy; `/ready` says `ready` and `connected`; the frontend health asset returns `200`; `id` shows `uid=1000(node)`.

The frontend probe checks HTTP serving. The separate API readiness check verifies the database connection. Use the browser checks below to verify sign-in and application features.

## 5. Check the tracker in your browser

Open **http://localhost:3000**, using that exact hostname and port to match your existing Clerk authorized party setting.

1. In a private window, confirm the dashboard asks you to sign in.
2. Sign in to your normal account and confirm existing roles still appear.
3. Save a test role and refresh the browser; confirm it remains saved.
4. Mark it applied and change its stage; confirm the application date remains the same.
5. Archive it, open Archived, restore it, then open Active and confirm it returns.

To check persistence across a frontend restart:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml restart frontend
```

Refresh the browser once the frontend is healthy again. Existing data should remain.

## 6. Check formatting and commit after the browser checks pass

```powershell
cd C:\Users\USER\job-tracker\frontend
npm.cmd run lint:fix
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test:api
```

The API client suite should still report **40 tests passed**. The Docker build already performs the production build and TypeScript build checks in Linux. Standalone output is generated inside Linux, avoiding Windows directory-symlink requirements for a local standalone build.

Then:

```powershell
cd C:\Users\USER\job-tracker
git diff --check
git check-ignore frontend/.env.local
git add frontend/next.config.ts frontend/Dockerfile frontend/.dockerignore
git add frontend/docker/build.mjs frontend/docker/healthcheck.mjs frontend/public/healthz.html
git add compose.frontend.yaml DOCKER-FRONTEND.md
git diff --cached --stat
git commit -m "Run the Next.js frontend with Docker Compose"
git status
```

## Daily use

Start the full tracker from the project root:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --wait --wait-timeout 90 db api frontend
```

Stop the full tracker while retaining its containers and data:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml stop frontend api db
```

After editing frontend source, rebuild it and recreate its container:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build frontend
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --wait --wait-timeout 90 frontend
```

**After changing `frontend/.env.local`, use `--no-cache` and recreate the container:** build-secret contents do not automatically invalidate Docker's build cache, and public values are fixed during the Next.js build.

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml build --no-cache frontend
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml up -d --no-build --force-recreate --wait --wait-timeout 90 frontend
```

To return to frontend development on Windows, stop only the frontend container, then start your dev server:

```powershell
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml stop frontend
cd .\frontend
npm.cmd run dev
```

## If a command fails

Stop at the first failed step and copy its error output. For startup or health errors:

```powershell
cd C:\Users\USER\job-tracker
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml ps
docker compose -f compose.yaml -f compose.api.yaml -f compose.frontend.yaml logs --tail 80 frontend api
```

If port 3000 is already allocated, stop the existing Next.js dev terminal before repeating the Docker `up` command. Docker does not automatically choose port 3001 for this setup.

## References and validation

This update uses your supplied installed Next.js 16.4.1 `self-hosting.md` and `output.md` guides, plus the official [Next.js Docker example](https://github.com/vercel/next.js/tree/canary/examples/with-docker), [Docker build secrets](https://docs.docker.com/build/building/secrets/), [secret cache behavior](https://docs.docker.com/build/cache/invalidation/#build-secrets), and [Clerk environment variables](https://clerk.com/docs/guides/development/clerk-environment-variables).

Preparation checks cover JavaScript/TypeScript syntax, Compose structure and merge assumptions, build-setting validation, secret-output rejection, the frontend HTTP probe, and the existing API client tests. Docker and your full frontend dependencies are not available in the preparation environment, so the actual image build, Next.js lint/typecheck, and Clerk/browser checks must run on your laptop using the steps above.
