import type { SourceAdapter, AuthCredentials, SecretSummary, ValidationResult } from "./index.js";
import { password, text } from "../lib/prompts.js";
import { UserError, ServiceError } from "../lib/errors.js";

/**
 * AWS Secrets Manager source adapter.
 *
 * Auth methods:
 *   - iam-access-keys     LIVE — collects access key + secret + region,
 *                         calls Secrets Manager via @aws-sdk v3.
 *   - oidc-federation     STUB — returns a clear error pointing at the
 *                         OIDC provider work in v0.3 and recommending
 *                         IAM access keys as the v0.2 path.
 *
 * AWS keys are NEVER persisted by the adapter — they live in the SRE's
 * environment (FLOW_AWS_ACCESS_KEY_ID / FLOW_AWS_SECRET_ACCESS_KEY for
 * non-interactive mode) or in process memory only (interactive mode).
 *
 * The AWS SDK is lazy-imported inside each method that needs it so
 * non-AWS code paths (e.g. picking flow-hosted) don't pay the ~1MB
 * bundle cost on startup.
 *
 * FLOW_TEST_MODE=true short-circuits the SDK calls with fixture data so
 * the interactive flow can be exercised without a real AWS account.
 */

const AWS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "eu-west-1",
  "eu-central-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
];

interface AwsCreds extends AuthCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

function isTestMode(): boolean {
  return process.env.FLOW_TEST_MODE === "true";
}

const TEST_SECRETS: Record<string, Record<string, string>> = {
  "prod/myapp/google-oauth": {
    GOOGLE_CLIENT_ID: "test-prod-client-id-1234567890.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-prod-client-secret-abcdef",
  },
  "staging/myapp/google-oauth": {
    GOOGLE_CLIENT_ID: "test-staging-client-id-0987654321.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "test-staging-client-secret-zyxwvu",
  },
  "prod/myapp/stripe": {
    STRIPE_SECRET_KEY: "sk_test_...",
  },
};

function readEnvCreds(): Partial<AwsCreds> {
  return {
    accessKeyId: process.env.FLOW_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.FLOW_AWS_SECRET_ACCESS_KEY,
    region: process.env.FLOW_AWS_REGION,
  };
}

function iamPolicyFor(secretName: string, region: string): string {
  return [
    "{",
    '  "Version": "2012-10-17",',
    '  "Statement": [{',
    '    "Effect": "Allow",',
    '    "Action": [',
    '      "secretsmanager:GetSecretValue",',
    '      "secretsmanager:DescribeSecret"',
    "    ],",
    `    "Resource": "arn:aws:secretsmanager:${region}:*:secret:${secretName}-*"`,
    "  }, {",
    '    "Effect": "Allow",',
    '    "Action": "secretsmanager:ListSecrets",',
    '    "Resource": "*"',
    "  }]",
    "}",
  ].join("\n");
}

/**
 * Map AWS SDK errors to FlowError subclasses with actionable messages.
 */
function translateAwsError(err: unknown, context: { secretName?: string; region?: string }): never {
  const name = (err as { name?: string })?.name ?? "";
  const message = (err as { message?: string })?.message ?? String(err);

  if (
    name === "UnrecognizedClientException" ||
    name === "InvalidSignatureException" ||
    name === "InvalidClientTokenId" ||
    name === "AuthFailure"
  ) {
    throw new ServiceError(
      "AWS rejected the credentials.",
      [
        "Common causes:",
        "  - Typo in access key ID or secret access key",
        "  - Key has been rotated or deactivated",
        "  - IAM user lacks secretsmanager:ListSecrets permission",
        "Check your AWS console and try again.",
      ].join("\n")
    );
  }

  if (name === "ExpiredTokenException") {
    throw new ServiceError(
      "AWS credentials expired.",
      "If you're using temporary credentials (STS), refresh them and try again."
    );
  }

  if (name === "AccessDeniedException") {
    if (context.secretName && context.region) {
      throw new ServiceError(
        `Access denied to secret '${context.secretName}'.`,
        [
          "Your IAM user needs secretsmanager:GetSecretValue and",
          "secretsmanager:DescribeSecret permissions on this secret.",
          "Add this to the IAM policy:",
          "",
          iamPolicyFor(context.secretName, context.region),
        ].join("\n")
      );
    }
    throw new ServiceError(
      "Access denied.",
      "Your IAM user lacks the required Secrets Manager permissions. Check the policy attached to the user."
    );
  }

  if (name === "ResourceNotFoundException") {
    throw new UserError(
      `Secret '${context.secretName ?? "(unknown)"}' not found in this AWS account / region.`,
      "Check the spelling or run `flow setup production` again to pick from the list of available secrets."
    );
  }

  if (name === "DecryptionFailure") {
    throw new ServiceError(
      "AWS could not decrypt the secret.",
      "The KMS key used to encrypt this secret is not accessible to your IAM user. Check the KMS key policy and try again."
    );
  }

  // Network-style errors
  if (
    name === "NetworkingError" ||
    /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/.test(message)
  ) {
    throw new ServiceError(
      "Could not reach AWS.",
      "Check your network connection and try again. If you're behind a proxy, ensure HTTPS_PROXY is set."
    );
  }

  // Fallback — surface the AWS error name and message but wrap in our shape
  throw new ServiceError(
    `AWS error (${name || "unknown"}): ${message}`,
    "If this looks like a permissions issue, check your IAM policy. If it persists, run with FLOW_DEBUG=1 for more detail."
  );
}

async function makeClient(creds: AwsCreds) {
  const sdk = await import("@aws-sdk/client-secrets-manager");
  return {
    sdk,
    client: new sdk.SecretsManagerClient({
      region: creds.region,
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
      },
    }),
  };
}

export const awsSecretsManagerAdapter: SourceAdapter = {
  id: "aws-secrets-manager",
  displayName: "AWS Secrets Manager",
  status: "live",
  authMethods: [
    {
      id: "iam-access-keys",
      displayName: "IAM access keys",
      status: "live",
      hint: "(available now)",
      description:
        "Collects an IAM user's access key ID and secret access key. The CLI uses them to call AWS APIs during setup; flow-vault uses them at app boot in v0.3 (read from FLOW_AWS_ACCESS_KEY_ID / FLOW_AWS_SECRET_ACCESS_KEY env vars on the deployed compute).",
    },
    {
      id: "oidc-federation",
      displayName: "OIDC federation",
      status: "stub",
      hint: "(recommended; requires Flow OIDC provider — not yet deployed)",
      description:
        "Federate from Flow's own OIDC provider into an AWS IAM role via sts:AssumeRoleWithWebIdentity. No long-lived credentials. Requires oidc.flow.kindtree.us, which lands in v0.3 (see CLAUDE.md roadmap).",
    },
  ],

  async promptCredentials(authMethodId: string): Promise<AuthCredentials> {
    if (authMethodId === "oidc-federation") {
      throw new UserError(
        "OIDC federation is not yet available.",
        [
          "OIDC federation requires Flow's OIDC provider at oidc.flow.kindtree.us,",
          "which is not yet deployed (planned for v0.3 — see CLAUDE.md roadmap).",
          "",
          "For now, use IAM access keys. The setup is the same conversationally.",
          "You'll be able to migrate to OIDC federation once the provider is live",
          "without reconfiguring the integration.",
          "",
          "→ Run `flow setup production` again and select 'IAM access keys' at",
          "  the auth method prompt.",
        ].join("\n")
      );
    }

    if (authMethodId !== "iam-access-keys") {
      throw new UserError(`Unknown auth method '${authMethodId}' for AWS Secrets Manager.`);
    }

    if (isTestMode()) {
      return {
        accessKeyId: "AKIAFAKETEST",
        secretAccessKey: "fake-test-secret-do-not-use",
        region: "us-east-1",
      } satisfies AwsCreds;
    }

    const env = readEnvCreds();
    const accessKeyId =
      env.accessKeyId ??
      (await text("AWS access key ID:", {
        validate: (v) => (v.startsWith("AKIA") || v.startsWith("ASIA") ? true : "AWS access key IDs start with AKIA (long-lived) or ASIA (temporary). Double-check what you pasted."),
      }));
    const secretAccessKey = env.secretAccessKey ?? (await password("Secret access key:"));

    // Region picker — dropdown for the common ones, free-text fallback
    const { pickList } = await import("../lib/prompts.js");
    const regionChoices = AWS_REGIONS.map((r) => ({ name: r, value: r }));
    regionChoices.push({ name: "Other (enter manually)…", value: "__other__" });
    let region = env.region ?? (await pickList("AWS region:", regionChoices, "us-east-1"));
    if (region === "__other__") {
      region = await text("AWS region:", {
        validate: (v) => (/^[a-z]{2,}-[a-z]+-\d+$/.test(v) ? true : "Region should look like 'us-east-1' or 'eu-central-1'."),
      });
    }

    return { accessKeyId, secretAccessKey, region } satisfies AwsCreds;
  },

  async listSecrets(rawCreds: AuthCredentials): Promise<SecretSummary[]> {
    const creds = rawCreds as AwsCreds;
    if (isTestMode()) {
      return Object.keys(TEST_SECRETS).map((name) => ({
        name,
        fullId: `arn:aws:secretsmanager:${creds.region}:000000000000:secret:${name}-fakeId`,
      }));
    }

    let client: Awaited<ReturnType<typeof makeClient>>["client"];
    let sdk: Awaited<ReturnType<typeof makeClient>>["sdk"];
    try {
      ({ client, sdk } = await makeClient(creds));
    } catch (err) {
      translateAwsError(err, { region: creds.region });
    }

    const out: SecretSummary[] = [];
    let nextToken: string | undefined;
    try {
      do {
        const resp = await client.send(
          new sdk.ListSecretsCommand({ MaxResults: 100, NextToken: nextToken })
        );
        for (const s of resp.SecretList ?? []) {
          if (s.Name) {
            out.push({
              name: s.Name,
              fullId: s.ARN,
              lastChanged: s.LastChangedDate?.toISOString(),
            });
          }
        }
        nextToken = resp.NextToken;
      } while (nextToken);
    } catch (err) {
      translateAwsError(err, { region: creds.region });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  async validateAccess(rawCreds: AuthCredentials, secretName: string): Promise<ValidationResult> {
    const creds = rawCreds as AwsCreds;
    if (isTestMode()) {
      const ok = secretName in TEST_SECRETS;
      return ok
        ? { ok: true }
        : {
            ok: false,
            reason: `Secret '${secretName}' not found in test fixtures. Available: ${Object.keys(TEST_SECRETS).join(", ")}.`,
          };
    }

    try {
      const { client, sdk } = await makeClient(creds);
      await client.send(new sdk.DescribeSecretCommand({ SecretId: secretName }));
      return { ok: true };
    } catch (err) {
      const name = (err as { name?: string })?.name ?? "";
      if (name === "ResourceNotFoundException") {
        return { ok: false, reason: `Secret '${secretName}' not found in ${creds.region}.` };
      }
      if (name === "AccessDeniedException") {
        return {
          ok: false,
          reason: `Access denied to '${secretName}'.`,
          iamPolicySnippet: iamPolicyFor(secretName, creds.region),
        };
      }
      translateAwsError(err, { secretName, region: creds.region });
    }
  },

  async resolveSecret(rawCreds: AuthCredentials, secretName: string): Promise<Record<string, string>> {
    const creds = rawCreds as AwsCreds;
    if (isTestMode()) {
      const fixture = TEST_SECRETS[secretName];
      if (!fixture) {
        throw new UserError(
          `Test fixture '${secretName}' not found.`,
          `Available test secrets: ${Object.keys(TEST_SECRETS).join(", ")}.`
        );
      }
      return { ...fixture };
    }

    try {
      const { client, sdk } = await makeClient(creds);
      const resp = await client.send(new sdk.GetSecretValueCommand({ SecretId: secretName }));
      const raw = resp.SecretString;
      if (!raw) {
        throw new ServiceError(
          `Secret '${secretName}' has no string value.`,
          "Flow expects JSON or key=value secrets, not binary. Re-store the value as JSON in AWS and try again."
        );
      }
      // Try JSON; fall back to single-key (treat raw string as opaque value)
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            out[k] = typeof v === "string" ? v : JSON.stringify(v);
          }
          return out;
        }
      } catch {
        // not JSON — treated as opaque below
      }
      return { value: raw };
    } catch (err) {
      translateAwsError(err, { secretName, region: creds.region });
    }
  },
};
