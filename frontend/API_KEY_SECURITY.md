# AWFMS — API Key Security Guide

## Overview

Your Anthropic API key (and other secrets) must **never** appear in:
- Any file committed to Git
- Any log output
- Any client-side/frontend code
- Any public URL or screenshot

This guide covers local development and Railway production.

---

## 1. Local Development (.env file)

Your secrets live in a `.env` file at `/awfms/backend/.env`.
This file is already listed in `.gitignore` — it will never be committed.

**Step 1 — Open the file:**
```
awfms/backend/.env
```

**Step 2 — Set your keys:**
```env
ANTHROPIC_API_KEY=sk-ant-api03-YjVk-...your-full-key...
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

**Step 3 — Verify .gitignore includes it:**
```
cat awfms/.gitignore
```
You should see `.env` listed. If not, add it:
```
echo "**/.env" >> awfms/.gitignore
```

**Step 4 — Never use the key in frontend code.**
The key only exists in the NestJS backend. The frontend calls your own API
(`/api/v1/...`), never Anthropic directly. The backend holds the key in memory
via `process.env.ANTHROPIC_API_KEY`. It is never sent to the browser.

---

## 2. Railway Production (Recommended — Zero Config Files)

Railway stores secrets as encrypted environment variables. They are injected
at runtime and never written to disk or visible in logs.

**Step 1 — Open Railway dashboard:**
https://railway.app → Your Project → Your Service → Variables tab

**Step 2 — Add each variable:**
Click "Add Variable" for each:

| Variable name              | Value                                 |
|---------------------------|---------------------------------------|
| `ANTHROPIC_API_KEY`       | sk-ant-api03-...your-full-key...      |
| `ANTHROPIC_MODEL`         | claude-sonnet-4-20250514              |
| `JWT_SECRET`              | (generate 32+ char random string)    |
| `REFRESH_TOKEN_SECRET`    | (generate 32+ char random string)    |
| `DATABASE_URL`            | (Railway provides this automatically) |
| `FRONTEND_URL`            | https://your-frontend.railway.app     |
| `R2_ACCOUNT_ID`           | (when R2 credentials received)       |
| `R2_ACCESS_KEY_ID`        | (when R2 credentials received)       |
| `R2_SECRET_ACCESS_KEY`    | (when R2 credentials received)       |
| `R2_BUCKET_NAME`          | (when R2 credentials received)       |

**Step 3 — Railway encrypts these at rest** using AES-256. They are only
decrypted into the container's process environment at runtime. No one
(including Railway staff) can read the raw values after entry.

**Step 4 — Redeploy after adding variables.**
Railway auto-redeploys when you add/change variables.

---

## 3. Cloudflare Approach (If Hosting Frontend on Cloudflare Pages)

If you deploy the React frontend to Cloudflare Pages instead of Vercel/Railway:

**Step 1 — Cloudflare Dashboard → Pages → Your project → Settings → Environment variables**

**Step 2 — Add ONLY frontend-safe variables:**
```
VITE_API_URL = https://your-backend.railway.app
```

⚠️ Never add `ANTHROPIC_API_KEY` or any backend secret to Cloudflare Pages.
Frontend env vars are bundled into the JavaScript and visible to any user
who opens browser devtools. Only the backend URL belongs here.

**The Cloudflare approach for secret encryption** is their Secrets Store
(via Workers KV or D1), but this only applies if you're running a Cloudflare
Worker as your backend — which AWFMS is not. For NestJS on Railway,
Railway's native encrypted variables are the correct tool.

---

## 4. Generating Strong Secrets (JWT etc.)

Run this in your terminal to generate a secure random 64-character string:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Use one output for `JWT_SECRET` and run again for `REFRESH_TOKEN_SECRET`.

---

## 5. Rotating the API Key

If the key is ever exposed (e.g. accidentally committed, logged, or screenshotted):

1. Go to https://console.anthropic.com → API Keys
2. Click "Disable" on the compromised key immediately
3. Click "Create Key" to generate a new one
4. Update Railway environment variable with the new key
5. Update your local `.env` with the new key
6. No code changes required — the key is read from env at startup

---

## 6. What the Code Does With the Key

The key is loaded once at NestJS startup via `ConfigService`:
```typescript
// Only ever used in AiService — never logged, never returned to client
const key = this.configService.get<string>('ANTHROPIC_API_KEY');
```

The `AiService` creates an Anthropic client with this key and uses it
for report generation. The client instance is module-scoped (created once).
The key value never appears in any response body, log line, or error message.

---

## 7. Quick Security Checklist Before Railway Deploy

- [ ] `awfms/.gitignore` contains `.env`
- [ ] Run `git status` — confirm `.env` does not appear as a tracked file
- [ ] All secrets set in Railway Variables tab
- [ ] `VITE_API_URL` in frontend `.env` points to `http://localhost:3000` only (not the Railway URL — that goes in Railway's frontend env)
- [ ] No `console.log(process.env.ANTHROPIC_API_KEY)` anywhere in code
- [ ] Anthropic console: confirm the key shows "Active" status

---

*Last updated: April 2026 — AWFMS Phase 6*
