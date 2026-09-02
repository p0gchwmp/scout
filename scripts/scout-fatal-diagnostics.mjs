// Loaded before Scout's local dev runtime so fatal Node errors cannot disappear
// behind a bare child-process exit code. uncaughtExceptionMonitor observes without
// changing Node's default fail-fast behavior.
process.on("uncaughtExceptionMonitor", (error, origin) => {
  const detail = error instanceof Error ? (error.stack || `${error.name}: ${error.message}`) : String(error);
  process.stderr.write(`\nScout local runtime fatal (${origin}):\n${detail}\n`);
});
