import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { describeAgentFailure } from "../agent/request-failure.ts";

test("agent failure policy keeps request, authentication and execution failures distinct", () => {
  assert.equal(describeAgentFailure("request", new Error("bad request")).status, 400);
  assert.equal(describeAgentFailure("authentication", new Error("bad signature")).status, 401);
  assert.equal(describeAgentFailure("execution", new Error("resolver failed")).status, 500);
});

test("pattern errors are classified without exposing the original message", () => {
  const error = new Error("The string did not match the expected pattern");
  error.name = "SyntaxError";
  const failure = describeAgentFailure("execution", error);
  assert.equal(failure.errorType, "SyntaxError");
  assert.equal(failure.category, "syntax_pattern");
  assert.equal(failure.publicError, "Scout agent operation failed");
  assert.doesNotMatch(JSON.stringify(failure), /did not match the expected pattern/i);
});

test("agent server changes failure stage only around request authentication", async () => {
  const source = await readFile(new URL("../agent/server.ts", import.meta.url), "utf8");
  assert.match(source, /let failureStage: AgentFailureStage = "request"/);
  assert.match(source, /const webRequest = toWebRequest\(request, rawBody\);\s+failureStage = "authentication";\s+const verified = await verifyAgentServiceRequest\(webRequest, secret\);\s+failureStage = "execution";/);
  assert.match(source, /const failure = describeAgentFailure\(failureStage, error\)/);
  assert.match(source, /return json\(response, failure\.status, \{ error: failure\.publicError \}\)/);
  assert.doesNotMatch(source, /Scout agent request rejected/);
});
