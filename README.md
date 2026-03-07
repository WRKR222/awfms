# Anza Whole Foods Farm Management System (AWFMS)

A mobile-first Progressive Web Application for managing commercial poultry operations. Replaces manual spreadsheets and isolated QuickBooks with a unified role-based platform + AI intelligence layer.

**Stack:** NestJS · PostgreSQL · Prisma · React · Tailwind CSS · Cloudflare R2 · Claude API  
**Deployment:** Railway (backend + DB) · Vercel (frontend) · Cloudflare R2 (vet PDFs)  
**Cost:** ~KES 3,200–6,000/month

---

## Quick Start

### Prerequisites
- Node.js 20+
- Docker (for local PostgreSQL) or Railway account
- Cloudflare R2 bucket
- Anthropic API key (Phase 4+)

### 1. Clone and Install
```bash
git clone https://github.com/your-org/awfms.git
cd awfms

# Install all dependencies
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Configure Environment
```bash
# Backend
cd backend
cp .env.example .env
# Edit .env with your DATABASE_URL, JWT secrets, R2 credentials

# Frontend
cd frontend
cp .env.example .env.local
# Set VITE_API_URL=http://localhost:3001/api/v1
```

### 3. Setup Database
```bash
cd backend

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed test data (5 users, 8 houses, suppliers)
npx ts-node prisma/seed.ts
```

### 4. Run Development Servers
```bash
# Terminal 1 — Backend (port 3001)
cd backend
rm -rf dist
npm run start:dev

# Terminal 2 — Frontend (port 5173)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and login with any test account.

---

## Test Accounts (Password: `AwfmsTemp2025!`)

| Username | Role |
|----------|------|
| `james.attendant` | Poultry Attendant |
| `grace.supervisor` | Group Leader / Supervisor |
| `peter.manager` | Production Manager |
| `amina.accountant` | Accountant |
| `director.anza` | Farm Owner / Director |

---

## Run Tests
```bash
# Business logic unit tests
cd backend && npx vitest run src/modules/__tests__/business-logic.spec.ts

# All backend tests
cd backend && npm test
```

---

## Deploy

See [AGENTS.md](./AGENTS.md) for deployment commands and full developer guide.

---

## Documentation
- **PRD v2.0** — Product requirements, personas, use cases, risk assessment
- **TechDesign v1.0** — Permission matrix, database schema, deployment guide  
- **AGENTS.md** — Developer AI guide, code rules, business logic reference
