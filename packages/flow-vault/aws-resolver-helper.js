/**
 * aws-resolver-helper.js — async AWS Secrets Manager fetcher.
 *
 * Spawned synchronously from aws-resolver.js via child_process.execFileSync
 * to bridge the sync constraint of the --require preload context. Mirrors
 * the same pattern as vault-helper.js.
 *
 * argv:
 *   [2] secretName  — e.g. "prod/myapp/google-oauth"
 *   [3] region      — e.g. "us-east-1"
 *   [4] envVars     — comma-joined env-var names this secret produces;
 *                     used as a hint when the secret value is a non-JSON
 *                     string (the value maps to envVars[0])
 *
 * env (read here, NOT passed via argv):
 *   FLOW_AWS_ACCESS_KEY_ID      required
 *   FLOW_AWS_SECRET_ACCESS_KEY  required
 *   FLOW_TEST_MODE              if "true", returns hardcoded test fixtures
 *                               without touching AWS at all
 *
 * stdout: JSON object of credential map. Empty {} on any failure.
 * stderr: single warning line on failure (parent forwards to user).
 * exit code: always 0. Failures degrade to empty map; never crash the host app.
 */

const TEST_FIXTURES = {
  "prod/myapp/google-oauth": {
    GOOGLE_CLIENT_ID: "test-prod-client-id-1234567890.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-prod-client-secret-abcdef",
  },
  "staging/myapp/google-oauth": {
    GOOGLE_CLIENT_ID: "test-staging-client-id-0987654321.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-staging-client-secret-zyxwvu",
  },
  "prod/myapp/stripe": {
    STRIPE_SECRET_KEY: "sk_test_abcdef",
  },
};

function emitEmpty() {
  process.stdout.write("{}");
}

function emitMap(map) {
  process.stdout.write(JSON.stringify(map));
}

async function main() {
  const [, , secretName, region, envVarsJoined] = process.argv;
  const envVars = (envVarsJoined || "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!secretName || !region) {
    process.stderr.write("[flow-vault] aws-resolver-helper: missing secretName or region\n");
    return emitEmpty();
  }

  // Test mode short-circuit — no SDK call, no creds needed.
  if (process.env.FLOW_TEST_MODE === "true") {
    const fixture = TEST_FIXTURES[secretName];
    if (!fixture) {
      process.stderr.write(`[flow-vault] FLOW_TEST_MODE: no fixture for '${secretName}'\n`);
      return emitEmpty();
    }
    return emitMap(fixture);
  }

  const accessKeyId = process.env.FLOW_AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FLOW_AWS_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    process.stderr.write(
      "[flow-vault] FLOW_AWS_ACCESS_KEY_ID / FLOW_AWS_SECRET_ACCESS_KEY not set; cannot resolve aws-secrets-manager source. Falling back to hosted source.\n"
    );
    return emitEmpty();
  }

  // Lazy require — @aws-sdk/client-secrets-manager is an optional dep. If
  // absent, treat as a graceful fallback rather than a crash.
  let sdk;
  try {
    sdk = require("@aws-sdk/client-secrets-manager");
  } catch {
    process.stderr.write(
      "[flow-vault] @aws-sdk/client-secrets-manager is not installed. `npm install --save-dev @aws-sdk/client-secrets-manager` to enable AWS source resolution; falling back to hosted source for now.\n"
    );
    return emitEmpty();
  }

  let value;
  try {
    const client = new sdk.SecretsManagerClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    });
    const resp = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretName }));
    value = resp.SecretString;
  } catch (err) {
    const name = err && err.name ? err.name : "unknown";
    process.stderr.write(`[flow-vault] AWS GetSecretValue failed for '${secretName}' (${name}): ${err && err.message ? err.message : err}\n`);
    return emitEmpty();
  }

  if (typeof value !== "string" || value.length === 0) {
    process.stderr.write(`[flow-vault] secret '${secretName}' has no string value\n`);
    return emitEmpty();
  }

  // Try JSON first — that's the canonical Secrets Manager shape for OAuth
  // and similar multi-key credentials.
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
        else out[k] = JSON.stringify(v);
      }
      return emitMap(out);
    }
  } catch {
    // Fall through to opaque-string handling below.
  }

  // Plain-string secret — map to the first envVar declared in the manifest.
  if (envVars.length === 0) {
    process.stderr.write(
      `[flow-vault] secret '${secretName}' is a plain string but no envVars declared in manifest; cannot map\n`
    );
    return emitEmpty();
  }
  return emitMap({ [envVars[0]]: value });
}

main().catch((err) => {
  process.stderr.write(`[flow-vault] aws-resolver-helper unexpected error: ${err && err.message ? err.message : err}\n`);
  emitEmpty();
});
