export type AgentFailureStage = "request" | "authentication" | "execution";

export type AgentFailureDescriptor = {
  status: 400 | 401 | 500;
  publicError: string;
  logLabel: string;
  errorType: string;
  category: string;
};

function errorType(error: unknown) {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

function safeFailureCategory(error: unknown) {
  if (!(error instanceof Error)) return typeof error;
  const message = error.message.toLowerCase();
  if (/expected pattern|pattern/.test(message)) return "syntax_pattern";
  if (/timeout|timed out|abort/.test(message)) return "timeout";
  if (/fetch|network|econn|enotfound|socket|dns/.test(message)) return "network";
  if (/\b(?:url|uri)\b/.test(message)) return "url_validation";
  return error.name && error.name !== "Error" ? error.name : "error";
}

export function describeAgentFailure(stage: AgentFailureStage, error: unknown): AgentFailureDescriptor {
  const common = {
    errorType: errorType(error),
    category: safeFailureCategory(error),
  };
  if (stage === "request") {
    return {
      ...common,
      status: 400,
      publicError: "Invalid agent request",
      logLabel: "Scout agent request invalid",
    };
  }
  if (stage === "authentication") {
    return {
      ...common,
      status: 401,
      publicError: "Unauthorized or invalid agent request",
      logLabel: "Scout agent authentication rejected",
    };
  }
  return {
    ...common,
    status: 500,
    publicError: "Scout agent operation failed",
    logLabel: "Scout agent execution failed",
  };
}
