# Automated checks with GitHub Actions

The `CI` workflow runs on pushes to `main`, pull requests targeting `main`, and manual runs from the repository's Actions tab. The frontend and backend jobs run independently.

## What runs

| Job | Checks |
| --- | --- |
| Frontend checks | Install the locked npm dependencies, run Biome, generate route types and check TypeScript, run the API client tests, and build Next.js. |
| Backend checks | Install the pinned Python dependencies, check dependency compatibility, initialise a temporary PostgreSQL 18.6 database, apply Alembic migrations, check for schema drift, and run the full unittest suite. |

The backend job runs the existing role-creation SQL scripts. Migrations connect as `job_tracker_migrator`, and API tests connect as `job_tracker_app`. This preserves the permissions used by the local application.

The workflow uses Node.js 24.21.0 and Python 3.13 on Ubuntu 24.04. Official GitHub setup actions are pinned to commit hashes, with their major versions in comments.

## Configuration

No repository secrets are required for these checks.

The workflow supplies synthetic Clerk values for compilation and configuration loading. The publishable key decodes to `ci.clerk.invalid$`, and the secret-key placeholder does not identify a real Clerk application. Authentication tests generate their own RSA keys and signed tokens. Application tests replace the identity dependency with test identities.

Database passwords in the workflow belong only to the temporary database created for that backend job. GitHub removes that service container after the job. Your local environment files and Docker database are not used by these checks.

The frontend build checks compilation and prerendering. It does not sign into Clerk or perform browser workflows. Its output uses dummy configuration and is not a deployment artifact. Continue to use the existing Docker build with your local settings to run the application.

## Install and run

Place `.github/workflows/ci.yml` at the repository root with this guide. If using the supplied ZIP, extract it into `C:\Users\USER\job-tracker` so the workflow ends up at `C:\Users\USER\job-tracker\.github\workflows\ci.yml`.

Review and publish the files from PowerShell:

```powershell
cd C:\Users\USER\job-tracker

git diff --check
git add .github/workflows/ci.yml CI.md README.md
git diff --cached --stat
git commit -m "Add automated frontend and backend checks"
git push
```

Open [the repository's Actions tab](https://github.com/TharushiK3/job-tracker/actions) and select the latest **CI** run. Both **Frontend checks** and **Backend checks** should finish successfully. Expand a failed step to see its command output.

After the workflow is on `main`, you can also select **CI → Run workflow → main → Run workflow**.

## Read a failure

| Failed step | What to inspect |
| --- | --- |
| Install dependencies | A lockfile or pinned package may be unavailable or inconsistent. Use the same dependency versions locally. |
| Check formatting and lint | Run `npm.cmd run lint:fix` in `frontend`, review the changes, and commit them. |
| Check TypeScript | Run `npm.cmd run typecheck` in `frontend` and fix the reported file. |
| Test API client | Read the failed test name and assertion in the job output. |
| Build Next.js | Read the build error. The existing Google font imports also need network access during the build. |
| Create application and migration roles | Check the PostgreSQL service log and the existing role-creation SQL files. |
| Apply migrations and check schema | Check that model changes have a matching committed Alembic migration. |
| Run backend tests | Read the failed test's traceback; the job uses a fresh database on every run. |

Fix the source, commit it, and push again. The new run replaces an older in-progress run for the same branch. A green CI result covers these automated checks; the sign-in, save, stage, archive, and restore browser checks remain useful after application changes.
