import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parseEnv } from "node:util";

function fail(message) {
  console.error(message);
  process.exit(1);
}

let settings;
try {
  const content = readFileSync(
    process.argv[2] ?? "/run/secrets/frontend_env",
    "utf8",
  );
  settings = parseEnv(content.replace(/^\uFEFF/, ""));
} catch {
  fail("Could not read the frontend environment build secret.");
}

const publishableKey = settings.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const secretKey = settings.CLERK_SECRET_KEY;
const apiBaseUrl = settings.NEXT_PUBLIC_API_BASE_URL;

if (!publishableKey || !/^pk_(test|live)_\S+$/.test(publishableKey)) {
  fail("Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY in frontend/.env.local.");
}
if (!secretKey || !/^sk_(test|live)_\S+$/.test(secretKey)) {
  fail("Set CLERK_SECRET_KEY in frontend/.env.local.");
}
if (apiBaseUrl !== "http://127.0.0.1:8000") {
  fail(
    "This local Docker setup expects NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 in frontend/.env.local.",
  );
}

// This is the same Next build command as the project's package.json script.
// The child receives the temporary environment, without a project .env file.
const result = spawnSync(
  process.execPath,
  ["node_modules/next/dist/bin/next", "build"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...settings,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
);
if (result.error || result.signal) {
  fail("The Next.js build could not finish.");
}
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// Check only the files that will enter the runtime image. Never print a key.
const secretBytes = Buffer.from(secretKey);
const checked = new Set();

function checkOutput(path) {
  const actualPath = realpathSync(path);
  if (checked.has(actualPath)) return;
  checked.add(actualPath);

  const name = basename(path);
  if (name === ".env" || name.startsWith(".env.")) {
    fail(
      "An environment file was found in the deployable output. Build stopped.",
    );
  }

  const entry = statSync(path);
  if (entry.isDirectory()) {
    for (const child of readdirSync(path)) {
      checkOutput(join(path, child));
    }
  } else if (entry.isFile() && readFileSync(path).includes(secretBytes)) {
    fail(
      "The Clerk secret key was found in the deployable output. Build stopped.",
    );
  }
}

try {
  for (const path of [".next/standalone", ".next/static", "public"]) {
    checkOutput(path);
  }
} catch {
  fail("Could not check the deployable output. Build stopped.");
}

console.log(
  "Standalone output checked: no environment files or Clerk secret key found.",
);
