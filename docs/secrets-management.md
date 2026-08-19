# Secrets Management

> Storing, distributing, and rotating sensitive values — API keys, database passwords, signing keys, certificates — so they never appear in code, config, or logs.

---

## What is it?

Secrets management is the practice of handling sensitive credentials (passwords, API keys, tokens, private keys, certificates) through a dedicated system rather than embedding them in source code or configuration. A secret manager (AWS Secrets Manager, Vault, GCP Secret Manager) stores secrets encrypted at rest, controls access via policies, and supports rotation and auditing. The goal: **no secrets in code, no secrets in config files, no secrets in logs** — and the ability to revoke and rotate any secret on demand.

---

## Problem

Secrets leak through predictable channels:

- **Committed to git** — a `.env` or config file pushed to a repository (public or private) is scraped by bots within minutes
- **Hard-coded in code** — API keys and passwords embedded in source files
- **Logged** — connection strings, tokens, and request bodies printed to logs
- **Shared in plaintext** — secrets passed in chat, email, or config management tools
- **Never rotated** — a leaked secret stays valid indefinitely because there is no rotation process

A single leaked secret can expose a database, an external API account, or the ability to sign tokens. Secrets management centralises storage, access control, rotation, and audit so a leak is contained and revocable.

---

## Example

### The wrong way — secrets in code

```typescript
// Never do this — the secret ships with the code and ends up in git history
const dbPassword = 'P@ssw0rd123';
const stripeKey = 'sk_live_4eC39HqLyjWDarjtT1zdp7dc';
```

### The right way — secrets from the environment / secret manager

```typescript
// 1. Local dev: .env file (gitignored), loaded at startup
// 2. Production: injected by the secret manager / orchestrator
const dbPassword = process.env.DB_PASSWORD!;
const stripeKey = process.env.STRIPE_SECRET_KEY!;

if (!dbPassword || !stripeKey) {
  throw new Error('Missing required secrets');
}
```

### Fetching from a secret manager (AWS Secrets Manager)

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });

async function getDbPassword(): Promise<string> {
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: 'prod/db/password' }),
  );
  return SecretString!;
}
```

---

## Architecture / Flow

```text
Developer / CI ──► Secret Manager (Vault, AWS SM, GCP SM)
                    │  encrypted at rest (KMS)
                    │  access policies (IAM / ACLs)
                    │  rotation schedules
                    │  audit logs
                    │
                    ├──► App instance (fetches at startup / on demand)
                    ├──► CI/CD pipeline (injects at deploy time)
                    └──► Rotation job (updates secret + dependent systems)
```

---

## How it Works

1. **Secrets are stored in a secret manager** — encrypted at rest with a key-management service (KMS).
2. **Access is controlled by policy** — only specific roles, services, or environments can read each secret (least privilege).
3. **Applications fetch secrets at runtime** — from environment variables injected by the orchestrator, or directly from the secret manager.
4. **Secrets are rotated on a schedule** — the manager generates a new value, updates the dependent system, and invalidates the old one.
5. **Access is audited** — every read is logged, so a compromised secret can be traced and revoked.

---

## Advantages

- **No secrets in code or git** — the most common leak vector is eliminated
- **Centralised access control** — least-privilege policies per secret, per environment
- **Rotation** — secrets can be rotated automatically, containing the blast radius of a leak
- **Auditing** — every access is logged for investigation and compliance
- **Environment separation** — dev, staging, and prod secrets are isolated

---

## Trade-offs

| Concern | Risk | Mitigation |
|---------|------|------------|
| **Operational overhead** | A secret manager is another system to run and secure | Use a managed service (AWS Secrets Manager, GCP, Azure) |
| **Startup dependency** | Apps cannot start if the secret manager is unavailable | Cache secrets; fail fast with clear errors; local dev fallbacks |
| **Latency** | Fetching secrets per request adds a network call | Fetch at startup or cache with TTL; inject via env at deploy |
| **Rotation complexity** | Rotating a secret must update every consumer atomically | Versioned secrets; dual-key windows; automated rotation |
| **Human error** | Secrets still leak via chat, email, or misconfigured permissions | Training, scanning (git-secrets, secret scanners), DLP |

---

## When to Use

- **Any application with credentials** — database passwords, API keys, signing keys, certificates
- **Multiple environments** — dev/staging/prod need isolated secrets
- **Regulated data** — PCI, HIPAA, GDPR require controlled access and audit
- **Teams of any size** — even a single developer benefits from keeping secrets out of git
- **Automated rotation** — compliance or security requirements demand periodic rotation

---

## When NOT to Use

- **Local development only** — a gitignored `.env` file is acceptable for local dev; use a secret manager for anything shared or deployed
- **Public read-only data** — no secrets involved, nothing to manage
- **Tiny throwaway projects** — the overhead may not be justified, but still never commit secrets

---

## Related Concepts

- [TLS & mTLS](tls-mtls.md) — certificates and private keys are secrets that must be stored and rotated
- [Webhook Security](webhook-security.md) — the shared webhook secret must be stored in a secret manager
- [OAuth 2.0](oauth2.md) — client secrets and signing keys are managed secrets
- [API Security (OWASP Top 10)](owasp-top-10.md) — security misconfiguration includes leaked secrets
- [API Authentication](api-authentication.md) — JWT signing keys are secrets
- Vault
- AWS Secrets Manager
- KMS
- `.env`

---

## Key Takeaways

> Never put secrets in code, config files, or logs — the most common leak is a committed `.env` or hard-coded key. Store secrets in a dedicated secret manager (Vault, AWS Secrets Manager), control access with least-privilege policies, and rotate them on a schedule so a leak is contained and revocable. Applications should read secrets from environment variables injected at deploy time or fetch them at startup, never embed them. Audit every secret access, and use secret scanners to catch accidental commits.