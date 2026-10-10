# AWFMS — Agent Reference

Refreshed alongside the 2025-05-08 cleanup migration.

## Roles (8 total)

| Role        | UserRole enum | Primary responsibilities                                                                          |
|-------------|---------------|---------------------------------------------------------------------------------------------------|
| Lead Attendant | `ATTENDANT` | Submits AM and PM `EggCollectionSession`. Logs feed intake, mortalities, weights, vaccines.       |
| Production Manager | `MANAGER` | Same-evening verifies PM session. Edits row data during morning 3-party tally (clears signatures). Signs tally as PM party. Uploads vet PDFs onto `HealthEvent`. Raises simple stock requests. |
| Sales       | `SALES`       | Manages customers, sales orders (with `paymentMethod`), advance bookings, deliveries. Co-signs morning tally as SALES party. Raises simple stock requests. |
| Store       | `STORE`       | Logs `StoreEggIntake`. Co-signs morning tally as STORE party. Fulfils `SimpleStockRequest`. Raises `PurchaseRequest` to Accountant. Logs construction labor records. |
| Accountant  | `ACCOUNTANT`  | Reviews `PurchaseRequest`, raises `LocalPurchaseOrder` (LPO) to Director. Manages invoices, AR, payments, finance reports. May raise simple stock requests. |
| Director / Owner | `OWNER`  | Approves LPOs (`LPO_APPROVE`). Approves `VisitorAdvanceNotice`. Read-all everywhere.              |
| Security 1  | `SECURITY1`   | Logs visitors at gate. Sees only APPROVED advance notices.                                        |
| Security 2  | `SECURITY2`   | Same as Security 1 — second post.                                                                 |

`SUPERVISOR` no longer exists.

## Egg-collection workflow (canonical)

```
Day N
 ├─ AM  Lead Attendant  →  EggCollectionSession (PENDING)
 │      Manager same-evening verify → APPROVED (or RETURNED)
 └─ PM  Lead Attendant  →  EggCollectionSession (PENDING)
        Service auto-creates EggTallyVerification skeleton
        Store logs StoreEggIntake (any time before lock)
        Manager same-evening verify → APPROVED

Day N+1 morning — PM, Sales, Store present
 ├─ Manager may EDIT rowData → tally.editCount++, all 3 signatures cleared
 ├─ Each role POSTs /tally-verifications/:sessionId/sign
 └─ When pmSignedById && salesSignedById && storeSignedById all set:
        isLocked = true
        finalGoodEggs / finalFullTrays / finalLooseEggs frozen
        expectedRevenueKes = DailyEggPrice.pricePerEgg * finalGoodEggs
        Notification 'TALLY_LOCKED' fanned out to MANAGER, SALES, STORE, OWNER, ACCOUNTANT
        EggCollectionSession is now read-only for everyone.
```

The two competing tally code paths (`session.verifiedById` and
`store.cosignTally`) are gone. Authoritative state lives on
`EggTallyVerification` only.

## Procurement — two distinct flows

### SimpleStockRequest (PM / Sales / Accountant → Store)
Items are already on the shelf. Store fulfils by issuing a `StoreStockOut` and
links it to each `SimpleStockRequestItem.stockOutId`. No external procurement.
Status lifecycle: `PENDING → ISSUED | PARTIAL | REJECTED | CANCELLED`.

### PurchaseRequest → LPO (Store → Accountant → Director)
Store is running low on equipment / consumables.
1. Store creates `PurchaseRequest` (status `SUBMITTED`).
2. Accountant reviews, then raises `LocalPurchaseOrder` (status `SUBMITTED`).
3. Director (`OWNER`) approves the LPO (`LPO_APPROVE` permission).
4. On goods receipt, Store creates `StoreStockIn` linked back to the LPO.

## Production houses (Block 1 & Block 2)

Both houses are live. Layout per house: sections A/B/C × rows 1/2 (A1 … C2);
every row has 4 levels (1 = bottom, 4 = top) × tiers (Block 1: 24, Block 2: 38)
× 4 cages; plus 8 isolation cages. **A cage holds at most 4 birds.**

- `ProductionCage` (code `BLK1-A1-L4-T07-C2`, `BLK2-ISO-3`) +
  `ProductionCageAssignment` (one batch per cage) are the source of truth.
  `BatchCageAssignment` is an auto-maintained per-row rollup
  (`ProductionCageService.recomputeRowRollups`) — never write it directly.
- Transfer brooder → production: `POST /production/houses/transfer`
  (`houseCode`, `birdCount`, optional `rowCodes`). All birds = batch moves;
  some birds = split into a child batch `<code>-B1|B2` (`parentBatchId`).
  Refused when the chosen house has no room; both full = no transfer.
- Egg collection sessions carry `block` (`BLOCK1`/`BLOCK2`). Each block is
  recorded **once per shift per day** (eggs, feed, vaccines, mortalities).
  Mortalities are per cage (`mortalityCagesJson`) and hit the cage map +
  `Batch.currentBirdCount` only when the Manager approves.
- Cages are addressed as row · level · **cage number along the level**
  (Block 1: 1–96, Block 2: 1–152). Tiers are only physical grouping —
  never required in UI, descriptions or placement (still understood if given).
- Isolation cages record `origin` (where the birds were taken from). Birds can
  only enter isolation by moving them from a named cage (map: "Came from";
  text: "moved 2 from A2 level 3 cage 37 to isolation cage 1").
- Cage reassignments are written in plain words (no grammar):
  `production-cage-text.util.ts` (production) and
  `cage-layout-parser.util.ts` (brooder). Always previewed before applying;
  production descriptions can also be saved as a note only.

## Auto-logged expenses (Accountant)

`AutoExpenseService` (global) writes `ExpenseLog` rows keyed by
`(sourceType, sourceId)` so re-submissions update instead of duplicating:
- `STORE_STOCK_OUT` — every Store issue (stock-out, stock request, report correction).
- `EGG_COLLECTION_DAMAGED` — attendant damaged eggs × standard bulk price.
- `TALLY_BROKEN_SPLIT` — PM split at tally: unsellable × bulk + sellable × (bulk − broken price).
- `EGG_BREAKAGE_ADJUSTMENT` — Sales breakage adjustments, same costing.
Bulk price = `DailyEggPrice.pricePerEggBulk` (falls back to `pricePerEgg`),
latest price on or before the date.

## AI reports — only when the data supports it

`AiReadinessService` gates every AI call (no credits spent otherwise):
- A batch-day is **recorded** when: brooder — all 3 session logs + feed;
  production — AM and PM for every block it has sessions in; or Store's
  uploaded production report has that date. Today is never counted.
- **Ready** = ≥ `AI_MIN_DATA_COMPLETENESS_PCT` (default 80%) of days recorded
  and ≥ `AI_MIN_DATA_DAYS` (default 3) days. Weekly/improvement reports only
  analyse ready batches and are skipped (Director notified) if none are; the
  per-batch report checks the last 14 days; forecasts and disease analysis
  also require recent completeness.
- **Changed** = some record in scope was created/updated after the last report
  of that kind; otherwise the previous report is returned (`reused: true`).
- `GET /ai/readiness[?batchId=]` shows readiness + missing days without an AI call.

## Vet visits

Live on `HealthEvent` (single source of truth). Manager-only upload via
`HEALTH_VET_UPLOAD`, persisted to `HealthEvent.vetPdfUrl`. Old standalone
`StoreVetVisitLog` table is removed; legacy `VetPdfReport` table is read-only
for historical records.

## Soft-delete rule

Everywhere a model has a `deletedAt` column, queries MUST filter
`deletedAt: null`. Hard `deleteMany` is forbidden. The `cage-map` service
demonstrates the soft-deactivation pattern for relationships
(`isActive=false, deactivatedAt, deactivatedById`).

Models with soft delete: `User`, `Batch`, `Customer`, `EggCollectionSession`,
`AdvanceBooking`, `SalesOrder`. Plus soft-deactivation on
`BatchCageAssignment`.

## Permission keys to know

- `PRODUCTION_EGGS_LOG` — Lead Attendant
- `PRODUCTION_EGGS_APPROVE` — Manager (same-evening verify + tally edit)
- `TALLY_SIGN` — Manager, Sales, Store
- `STOCK_REQUEST_CREATE` — Manager, Sales, Accountant, Owner
- `STOCK_REQUEST_FULFILL` — Store, Owner
- `PURCHASE_REQUEST_CREATE` — Store, Manager, Sales, Accountant
- `PURCHASE_REQUEST_REVIEW` — Accountant
- `LPO_MANAGE` — Accountant
- `LPO_APPROVE` — Owner
- `VISITOR_NOTICE_APPROVE` — Owner
- `HEALTH_VET_UPLOAD` — Manager
- `CONSTRUCTION_LABOR_LOG` — Store

## Decimal handling

All money / weight / count fields use `Decimal`. When summing in JS, wrap with
`Number()` once per row. Persist back as `number` — Prisma converts.

## Notifications taxonomy

- `EGG_TALLY_TRIGGERED` — PM session submitted
- `TALLY_EDITED` — Manager edited; re-sign required
- `TALLY_SIGNED` — one party signed
- `TALLY_LOCKED` — all three signed; finalised
- `STOCK_REQUEST` — new SimpleStockRequest
- `STOCK_REQUEST_FULFILLED` — Store issued / partial / rejected
- `PURCHASE_REQUEST` — Store raised to Accountant
- `LPO_SUBMITTED` — Accountant raised to Director
- `LPO_APPROVED` — Director signed
