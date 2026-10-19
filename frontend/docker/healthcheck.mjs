try {
  const response = await fetch("http://127.0.0.1:3000/healthz.html", {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  const content = await response.text();
  if (!response.ok || !content.includes("job-tracker-frontend-ok")) {
    throw new Error("Unexpected health response");
  }
} catch {
  console.error("Frontend health check failed.");
  process.exit(1);
}
