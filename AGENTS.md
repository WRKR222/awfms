# AGENTS.md — AWFMS Developer AI Guide

> **Read this before touching any code.**  
> This file tells Claude Code, Cursor, and any AI assistant exactly how this project works, what rules apply, and how to make changes safely. Every AI-assisted session should start here.

---

## Project Identity

**System:** Anza Whole Foods Farm Management System (AWFMS)  
**Type:** NestJS API + React PWA (Mobile-first, Offline-capable)  
**Purpose:** Replace manual spreadsheets at a Kenyan commercial poultry farm with a unified digital platform + AI intelligence layer.  
**Scale:** 21,000+ birds, 8 housing units, 5 user roles, simultaneous multi-batch operations.

---

## Monorepo Structure

```
awfms/
├── backend/          ← NestJS API (Node.js, TypeScript strict)
│   ├── src/
│   │   ├── auth/           — JWT auth, login, refresh, RBAC
│   │   ├── common/
│   │   │   ├── guards/     — JwtAuthGuard, PermissionsGuard
│   │   │   ├── decorators/ — @RequirePermission(), @CurrentUser()
│   │   │   ├── enums/      — Permission enum, ROLE_PERMISSIONS map
│   │   │   ├── prisma/     — PrismaService
│   │   │   └── notifications/ — NotificationsService
│   │   └── modules/
│   │       ├── flock/      — Batch management, daily entries, verification
│   │       ├── feed/       — Feed delivery, intake, stock, FCR, alerts
│   │       ├── health/     — Vaccination, disease events, vet PDF, visitors
│   │       ├── dashboard/  — Owner/Supervisor dashboard aggregation
│   │       └── __tests__/  — Vitest business logic tests
│   └── prisma/
│       ├── schema.prisma   — ALL database tables (30 tables, 11 domains)
│       └── seed.ts         — Test data: 5 users, 8 houses, suppliers
│
├── frontend/         ← React + Vite + Tailwind PWA
│   ├── src/
│   │   ├── pages/
│   │   │   ├── attendant/  — Daily entry forms (flock, feed, eggs, weights)
│   │   │   ├── supervisor/ — Verification queue, sales entry
│   │   │   ├── manager/    — Batch management, feed overview, health
│   │   │   ├── accountant/ — Invoice register, AR dashboard
│   │   │   └── owner/      — Executive KPIs, AI reports, settings
│   │   ├── stores/         — Zustand: auth.store, offline.store, notifications.store
│   │   ├── hooks/          — React Query: useAuth, useFlock, useFeed
│   │   └── lib/            — api.ts (Axios with interceptors + token refresh)
│   └── public/
│       ├── sw.js           — Service Worker (Cache First + offline queue)
│       └── manifest.json   — PWA manifest
│
└── .github/workflows/
    └── ci-cd.yml           — GitHub Actions: test → build → deploy
```

---

## The 5 Roles — Never Confuse Them

| Role | Route | Primary Daily Task | Cannot See |
|------|-------|-------------------|------------|
| `ATTENDANT` | `/attendant` | Log daily data (mortality, feed, eggs, temp, water, weights) | Financial data, AI reports |
| `SUPERVISOR` | `/supervisor` | Verify attendant entries, log sales orders | Financial module, AI reports |
| `MANAGER` | `/manager` | Oversee operations, manage batches, upload vet PDFs | Financial statements |
| `ACCOUNTANT` | `/accountant` | Manage invoices, AR, expenses, QuickBooks export | AI recommendations |
| `OWNER` | `/owner` | Full access — AI reports, all KPIs, settings | Nothing |

**RBAC is enforced at TWO levels. Both must be correct:**
1. Frontend: Routes are protected by `allowedRoles` in `ProtectedRoute`
2. Backend: Every API endpoint has `@RequirePermission(Permission.X)` decorator

---

## Non-Negotiable Code Rules

These are treated as **blocking bugs** — the CI pipeline will reject code that violates them:

### 1. TypeScript Strict Mode — No `any`
```typescript
// ❌ NEVER
const entry: any = req.body;

// ✅ ALWAYS — define the type
const entry: CreateFlockEntryDto = req.body;
```

### 2. Permission Guard on EVERY API Endpoint
```typescript
// ❌ NEVER — unguarded endpoint
@Get('batches')
getBatches() { ... }

// ✅ ALWAYS — every endpoint gets the guard
@Get('batches')
@UseGuards(JwtAuthGuard)
@RequirePermission(Permission.FLOCK_VIEW)
getBatches() { ... }
```

### 3. Explicit Try/Catch — No Silent Failures
```typescript
// ❌ NEVER — unhandled async
await this.notifications.notifyRole(...);

// ✅ ALWAYS — catch and log, don't let it crash the main flow
try {
  await this.notifications.notifyRole(...);
} catch (err) {
  this.logger.error('Notification failed', err);
}
```

### 4. Soft Deletes Only — Never Hard Delete
```typescript
// ❌ NEVER
await this.prisma.batch.delete({ where: { id } });

// ✅ ALWAYS
await this.prisma.batch.update({
  where: { id },
  data: { deletedAt: new Date() },
});
```
```typescript
// AND always filter deleted records in queries:
await this.prisma.batch.findMany({
  where: { isActive: true, deletedAt: null }, // ← both conditions
});
```

### 5. Zod/Class-Validator on Every DTO
```typescript
// Every DTO must validate all fields
export class CreateFlockEntryDto {
  @IsUUID()
  batchId: string;

  @IsDateString()
  entryDate: string;

  @IsInt()
  @Min(0)
  mortalityCount: number;

  // Biological impossibility check — deaths cannot exceed opening count
  // This is validated in the service, not just the DTO
}
```

### 6. Prisma Migrations Only — Never Touch the DB Directly
```bash
# Add a new field to a table:
# 1. Edit prisma/schema.prisma
# 2. Run: npx prisma migrate dev --name describe_the_change
# 3. Run: npx prisma generate
# NEVER: log into Railway and ALTER TABLE manually
```

### 7. Biological Validation in Services — Not Just DTOs
Some validations can't be expressed in decorators. These MUST be in the service:
```typescript
// Flock daily entry validation examples:
if (mortalityCount + cullCount > openingCount) {
  throw new BadRequestException('Deaths + culls cannot exceed opening bird count');
}
if (new Date(entryDate) > new Date()) {
  throw new BadRequestException('Entry date cannot be in the future');
}
if (gradeSum !== 0 && gradeSum !== totalWhole) {
  throw new BadRequestException('Egg grades must sum to total whole eggs, or be all zeros');
}
```

---

## Database Patterns — Use These Every Time

### Standard query structure:
```typescript
// Always: filter deleted_at, include related data, order explicitly
const batch = await this.prisma.batch.findFirst({
  where: {
    id: batchId,
    deletedAt: null,       // ← always exclude soft-deleted
    isActive: true,        // ← if applicable
  },
  include: {
    house: { select: { name: true, code: true } },
    supplier: { select: { name: true } },
  },
  orderBy: { createdAt: 'desc' },
});

if (!batch) throw new NotFoundException('Batch not found');
```

### For aggregations (KPIs, reports):
```typescript
// Use aggregate() not manual reduce() for numerical summaries
const result = await this.prisma.productionEntry.aggregate({
  where: {
    batchId,
    status: EntryStatus.APPROVED,
    deletedAt: null,
    entryDate: { gte: weekAgo, lte: today },
  },
  _sum: { totalWhole: true },
  _avg: { henDayPct: true },
  _count: { id: true },
});
```

---

## Adding a New API Module — Checklist

When adding a new backend module (e.g., Sales, Inventory), follow this order:

- [ ] Add new ENUMs to `prisma/schema.prisma` if needed
- [ ] Add new tables to `prisma/schema.prisma` with `deletedAt DateTime?` and `createdAt/updatedAt`
- [ ] Run `npx prisma migrate dev --name add_module_name`
- [ ] Run `npx prisma generate`
- [ ] Add new `Permission` values to `common/enums/permissions.enum.ts`
- [ ] Add those permissions to the correct roles in `common/enums/role-permissions.map.ts`
- [ ] Create `modules/[name]/[name].module.ts`
- [ ] Create `modules/[name]/[name].service.ts` — business logic + validation only
- [ ] Create `modules/[name]/[name].controller.ts` — thin, no business logic, `@RequirePermission` on every route
- [ ] Create `modules/[name]/dto/` — one DTO per request type
- [ ] Write unit tests in `modules/__tests__/[name]-logic.spec.ts`
- [ ] Register module in `app.module.ts`
- [ ] Test all endpoints with Postman or `curl`

---

## Adding a New Frontend Feature — Checklist

- [ ] Check which roles should see this feature — add route protection
- [ ] Add API hook in `hooks/use[Feature].ts` using React Query
- [ ] Add API calls in `lib/api/` if complex, or inline in hook if simple
- [ ] All data entry forms: show loading state, error state, and success confirmation
- [ ] All forms: mobile-first, minimum 48×48px touch targets
- [ ] Test the offline case: does the form work in airplane mode?
- [ ] If the feature has an alert/notification: add to `notifications.store.ts` handling

---

## Key Business Logic Rules — Reference These When Adding Features

### Hen-Day Production %
```
henDayPct = (totalWholeEggs / currentBirdCount) × 100
```
Round to 2 decimal places. Return `null` if `currentBirdCount === 0`.  
Alert if `henDayPct > 100` (data anomaly warning, not an error — it can happen).

### Feed Days Remaining
```
daysRemaining = currentStockKg / avgDailyConsumptionKg
```
`avgDailyConsumptionKg` = rolling 7-day average of approved feed intake logs.  
Fire low-stock alert when `daysRemaining <= threshold` (default: 3 days, stored in `system_config`).

### FCR (Feed Conversion Ratio)
```
fcr = totalFeedConsumedKg / totalEggWeightKg
totalEggWeightKg = (totalWholeEggs × 60) / 1000   // 60g average per egg
```
Return `null` if no eggs produced (avoid division by zero).  
Lower FCR = better efficiency.

### Two-Tier Egg Pricing
```
Tier 1: quantity 1-10 trays → use tier1UnitPriceKes
Tier 2: quantity 11+ trays → use tier2UnitPriceKes
```
Tier selection is AUTOMATIC based on total quantity. Accountant/Owner set the price per tier. The system applies it — no manual tier selection by Supervisor.

### Closing Bird Count
```
closingCount = openingCount - mortalityCount - cullCount
```
Must be ≥ 0. Must be validated in service, not just frontend.

### Invoice Status Transitions
```
UNPAID → PARTIAL (when partial payment logged)
UNPAID → PAID (when full payment logged)
PARTIAL → PAID (when remaining balance paid)
UNPAID/PARTIAL → OVERDUE (when today > dueDate AND balance > 0)
```
OVERDUE is set by a nightly cron job, not on every request.

---

## Offline Data Entry — How It Works

1. Attendant submits a form with no internet connection
2. React form checks `useOfflineStore().isOnline`
3. If offline: entry is serialized and pushed to `offlineStore.pendingEntries[]` (persisted to IndexedDB via Zustand persist)
4. UI shows "Saved offline — will sync when connected"
5. When online status restores, `useEffect` in App.tsx triggers sync
6. Each pending entry is replayed as a real API POST in order of `submittedAt`
7. Success: entry removed from `pendingEntries`. Failure: entry marked with `error`, retry up to 3 times

**Important:** Offline entries are still validated by the server on sync. If the server rejects an entry (e.g., batch no longer active), the attendant sees the rejection error on the sync screen.

---

## Environment Variables Reference

### Backend (`.env`)
| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Railway PostgreSQL connection string |
| `REDIS_URL` | Railway Redis connection string |
| `JWT_SECRET` | Access token signing secret (min 64 chars) |
| `JWT_REFRESH_SECRET` | Refresh token signing secret (min 64 chars) |
| `R2_ACCOUNT_ID` | Cloudflare account ID for R2 storage |
| `R2_ACCESS_KEY_ID` | R2 API access key |
| `R2_SECRET_ACCESS_KEY` | R2 API secret key |
| `R2_BUCKET_NAME` | R2 bucket name (`awfms-documents`) |
| `ANTHROPIC_API_KEY` | Claude API key for AI reports + alerts |
| `FRONTEND_URL` | Vercel frontend URL (for CORS) |

### Frontend (`.env.local`)
| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Backend API base URL (`/api/v1`) |

---

## Test Accounts (After Seeding)

All test accounts use password: `AwfmsTemp2025!`

| Username | Role | Access |
|----------|------|--------|
| `james.attendant` | ATTENDANT | H1 and H2 only |
| `grace.supervisor` | SUPERVISOR | All houses |
| `peter.manager` | MANAGER | Full operations |
| `amina.accountant` | ACCOUNTANT | Finance + read-only production |
| `director.anza` | OWNER | Full system |

**On first login**, each user should be prompted to change their password. This is enforced by the `forcePasswordChange` flag on the `User` model.

---

## Deployment Quick Reference

### Railway (Backend)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link
railway login
railway link

# Deploy
railway up

# Run migrations on production
railway run npm run db:migrate

# View logs
railway logs
```

### Vercel (Frontend)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy (run from frontend/ directory)
vercel --prod
```

### Local Development
```bash
# Backend
cd backend
cp .env.example .env       # Fill in your local values
npm install
npx prisma generate
npx prisma migrate dev
npx ts-node prisma/seed.ts # Seed test data
npm run start:dev          # Runs on localhost:3001

# Frontend (new terminal)
cd frontend
cp .env.example .env.local # Set VITE_API_URL=http://localhost:3001/api/v1
npm install
npm run dev                # Runs on localhost:5173
```

---

## What Each Phase Builds

| Phase | Weeks | Modules | Status |
|-------|-------|---------|--------|
| **1** | 1-8 | Auth + RBAC, Flock/Batch, Daily Entry, Supervisor Verification, PWA offline | ✅ **COMPLETE** |
| **2** | 9-16 | Feed management, Health & Biosecurity, Vet PDF upload, Health events | 🔄 Next |
| **3** | 17-22 | Production Tracking, Inventory, Cold Chain, Temperature logs | ⏳ Planned |
| **4** | 23-28 | Sales & Distribution, Auto-Invoicing, AR, Overdue alerts | ⏳ Planned |
| **5** | 29-32 | Finance, Cost of Production, Batch Profitability, QuickBooks export | ⏳ Planned |
| **6** | 33-36 | Full AI Layer, AI Reports, Swahili option, Franchise architecture | ⏳ Planned |

---

## When Claude Gets It Wrong

If Claude generates code that violates the rules above:

1. **Point to this file** — "Read AGENTS.md rule #2 — every endpoint needs @RequirePermission"
2. **Don't accept partial fixes** — the guard must be on the correct role, not just "any authenticated user"
3. **Run the tests** — `npm test` must pass. CI will catch violations.
4. **Check the permission matrix** — in `common/enums/role-permissions.map.ts` — the role must have that permission defined

---

## Questions AI Should Answer Confidently

- "What permissions does a Supervisor have?" → Check `role-permissions.map.ts`
- "How is FCR calculated?" → See business logic section above
- "Where do I add a new module?" → Follow the module checklist above
- "How do offline entries sync?" → See Offline Data Entry section above
- "What's the correct way to soft-delete?" → Use `deletedAt: new Date()` pattern

---

*AWFMS — Anza Whole Foods Farm Management System*  
*Phase 1 Complete. Next: Phase 2 — Feed Module, Health & Biosecurity.*
