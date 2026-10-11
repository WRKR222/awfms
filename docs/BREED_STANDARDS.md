# Breed Standards & Notification Clean-up

This change adds breed performance guides to AWFMS (starting with the **Hy-Line Brown Performance Guide, January 2024 edition**) and stops notifications from repeating.

The guide is used in three ways:
- as a **benchmark**: every batch is compared with it, week by week;
- as a **control**: deviations are flagged once, with what they mean;
- as a **starting point the farm can improve on**: farm standards and lessons from earlier batches.

The design works for any breed's notes, not only Hy-Line.

- **Part A** is for developers.
- **Part B** is for the people who run the farm.

---

## Part A — Programmer's view

### A1. What changed at a glance

| Area | Change |
|---|---|
| Reference data | New tables: `Breed`, `BreedGuide` (versioned), `BreedStandardPoint` (one row per metric × age × variant), `FarmStandard`, `BatchStandardMetric`, `BatchPracticeNote`. Migration `20261012090000_breed_standards` (idempotent). |
| Hy-Line Brown 2024 | Transcribed in full into `modules/breed-standards/guides/hyline-brown-2024.guide.ts`, 1,548 points. Seeded on start-up and made ACTIVE if the breed has no active guide. Covers: rearing table weeks 1–17, laying table weeks 18–100, egg quality, egg size, brooding temperature, light intensity and light hours by day, both light programmes, diet phases, both nutrition programmes, Ca/P, vitamins, water quality, space, body-score ideals, and the rules (transfer age, light stimulation, pre-lay timing, days to 50%, peak, FCR milestones). |
| De Heus chart removed | `common/feed/feed-standard.util.ts` now derives `HYLINE_SCHEDULE` from the guide for **weeks 1–100**; it used to cover weeks 1–19 only. The migration also rewrites `brooder_control_standards` rows 1–19. `gramsPerBirdPerDay()` follows the guide for layer feeds instead of a flat 115 g. |
| Breed on batches | `Batch.breedId/breedVariety` come from alias matching on `strain`. "Hy-Line", "hyline brown", "Hyline Brown Max" all → Hy-Line Brown, and the variety is kept for display. Existing batches are back-filled at start-up. **Bug fixed:** the registration form's `birdBreed` was never saved to `strain`, so it always read "LAYER COMMERCIAL". |
| Recording plan | New batch fields: `untrackedMetrics[]`, `housingType`, `housingDescription`, `declaredLightHours`, `nutritionProgram`. They are set at registration, editable later, and copied to split child batches. |
| Compliance engine | `StandardComplianceService` scores completed guide weeks from existing records and upserts `BatchStandardMetric`. It runs nightly at 02:15 EAT and on demand. |
| Notifications | One `STANDARD_DEVIATION` per *run* of off-standard weeks (not per week). |
| AI reports | Batch report, weekly report, improvement suggestions and closure forecasts receive the benchmark context. |
| HDP controls | A guide with a `HEN_DAY_PCT` table replaces the uploaded curve for that breed. Uploading is still possible for breeds without a guide. |
| Weight alerts | Use the batch's own breed guide or farm standard. They no longer clamp to week 19, which used to raise false "above max" alerts in lay. A run of same-direction alerts notifies once. |
| Anti-spam | Every `notification.create/createMany` passes through one de-duplication layer in `PrismaService`, including inside transactions. |
| Uploads | Re-uploading an unchanged production report does not notify again. Re-importing the same expense sheet does not duplicate expenses. |
| UI | New **Breed Standards** page for Manager and Director. Recording-plan section in **New Batch**. HDP Controls shows guide coverage. |

### A2. Data model

```
Breed (code, name, aliases[])
  └─ BreedGuide (versionLabel "January 2024", versionYear, variety|null,
  │              status DRAFT|ACTIVE|ARCHIVED, sourceKind SEED|TEMPLATE|AI,
  │              supersededById/At)
  │    └─ BreedStandardPoint (metric, variant, ageUnit WEEK|DAY,
  │                           ageFrom, ageTo, min, target, max, unit, label,
  │                           phase, textValue, seq)
  └─ FarmStandard (metric, points[{ageFrom,ageTo,min,target,max}], reason,
                   evidence, status PROPOSED|APPROVED|REJECTED|RETIRED)
Batch (+breedId, breedVariety, untrackedMetrics[], housingType,
       housingDescription, declaredLightHours, nutritionProgram)
  ├─ BatchStandardMetric (metric, ageUnit WEEK|DAY|MILESTONE, ageIndex,
  │                       actual, band applied, basis GUIDE|GUIDE_EXTENDED|FARM,
  │                       status IN_BAND|BELOW|ABOVE|MISMATCH, guideStatus,
  │                       notifiedAt)  — unique (batch, metric, ageUnit, ageIndex)
  └─ BatchPracticeNote (metric, practice, guideRecommendation, reason,
                        source MANUAL|AUTO, effectiveFrom/To, deletedAt)
Notification (+dedupeKey)
```

- **Guide versions.** `(breedId, versionLabel, variety)` identifies an edition. Activating one archives the previous active edition for the same breed and variety, and sets `supersededById`. Every UI and AI text names the edition, e.g. "January 2024 edition".
- **Variety rule.** A guide with `variety = null` applies to all varieties of the breed. A variety-specific edition, if one is uploaded, wins for batches of that variety.

### A3. Metric catalogue (breed-agnostic)

`breed-metrics.catalog.ts` holds one definition per parameter:
- label and unit
- `direction`: `IN_BAND`, `HIGHER_BETTER` or `LOWER_BETTER`
- `capture`: `SYSTEM`, `DECLARED`, `NO_INPUT` or `REFERENCE`
- `extrapolation`: `HOLD_LAST` or `NONE`
- optional tolerance
- farmer-facing texts: `ifNotRecorded`, `ifBelow`, `ifAbove`

A guide only supplies numbers. Unknown metric keys in an uploaded guide are stored as reference data.

| Capture | Metrics |
|---|---|
| SYSTEM (farm may choose) | BODY_WEIGHT, UNIFORMITY, MORTALITY_CUM_REARING, MORTALITY_CUM_LAY, FEED_INTAKE, FEED_CUM_REARING, WATER_INTAKE, HEN_DAY_PCT, HD_EGGS_CUM, HH_EGGS_CUM, EGG_WEIGHT, EGG_MASS_CUM, FCR_CUM, DAYS_TO_50_PCT, PEAK_HDP, BROODING_TEMP, LIGHT_INTENSITY, FEED_PHASE, TRANSFER_AGE |
| DECLARED | LIGHT_HOURS (from `Batch.declaredLightHours`) |
| NO_INPUT (always "not recorded") | EGG_SIZE_DISTRIBUTION, HAUGH_UNITS, BREAKING_STRENGTH, SHELL_COLOR, BODY_CONDITION_SCORE, WATER_QUALITY |
| REFERENCE (shown, never scored) | NUTRIENT_REARING, NUTRIENT_DAILY, NUTRITION_PHASE, CALCIUM_PHOSPHORUS, VITAMINS_MINERALS, SPACE, LIGHT_STIM_*, PRELAY_EARLIEST_WEEK, GUIDE_NOTE |

**Past the guide's last row** (`pickPoint`):
- `HOLD_LAST` keeps the last row and marks the period `GUIDE_EXTENDED`. Used for body weight, HD%, feed, water, egg weight, light hours and uniformity.
- `NONE` stops comparing. Used for cumulative totals, brooding-only values and one-off milestones, where holding the last value flat would be wrong.
- Gaps inside a guide (egg quality is given every second week) take the latest earlier row.

**Directional bands** (`applyTolerance`):
- HIGHER_BETTER metrics never flag "above"; LOWER_BETTER metrics never flag "below".
- Single-value guide rows get a system default tolerance. These defaults are **not from the guide**, and a farm standard can override them:
  - egg weight ±5%
  - egg mass −10%
  - light hours ±0.5 h

### A4. Band resolution

`BreedStandardService.resolveBand(ctx, metric, age, {ageUnit, variant})`:
1. Takes the batch's active guide: a variety-specific edition, else the breed-wide one.
2. Picks the guide row (A3).
3. If an **APPROVED** `FarmStandard` exists for the breed and metric, its values replace the band (`basis: FARM`). The guide band is kept in `band.guide`, and `BatchStandardMetric.guideStatus` records the status against the guide alone.

Guide points are cached in memory once a guide is no longer DRAFT.

### A5. How actuals are computed (`StandardComplianceService.evaluateBatch`)

Only **complete** weeks are scored: week *w* = hatch + 7(w−1) … hatch + 7w − 1. Today is never counted.

| Source | Used for |
|---|---|
| `EggCollectionSession` (not deleted, not RETURNED) | Eggs laid = good + starter + broken + damaged + soft-shell + deformed, across AM+PM and all blocks. Population = first shift's `openingPop` per block, summed. Also feed kg and lines, water, mortalities. |
| `BrooderGeneralFeedLog`, `FeedIntakeLog` (fallback) | Feed per bird |
| `BrooderGeneralMortalityLog`, session mortalities, `FlockDailyEntry` (fallback) | Deaths; population when no session (received − DOA − deaths so far) |
| `BrooderLog` (incl. 3 am / 6 am readings) | Brooding temperature (compared with the **cage** band), lux, water |
| `BirdWeightSample` (sample-weighted), `BatchWeightTrackPoint` (fallback) | Body weight; uniformity from `individualWeightsG` (≥10 birds, % within ±10% of mean) |

**Minimum data before a figure counts:**
- Weekly averages need at least 4 days with data.
- Cumulative figures (rearing feed, HD/HH eggs, egg mass, FCR) need at least 90% of days recorded, otherwise they are skipped rather than shown low.

**How each figure is built:**
- **Lay mortality:** counted from the start of week 18. Rearing mortality is counted from arrival, and only for batches received in week 1.
- **Egg weight:** trays weighed ÷ good eggs. Days averaging outside 30–90 g are ignored as data errors.
- **Feed phase:** recorded feed families vs the guide phase for the week, with one phase of tolerance either side for transitions. Two more checks:
  - pre-lay fed before week 15;
  - pre-lay fed once weekly HD% is 5% or more (lay has started).

  Both create an **AUTO** practice note.
- **Light hours:** the declared value vs the programme for `housingType`, from the declaration date onward. Rows are never rewritten, so changing the declaration keeps history. Light raised above the programme in weeks 14–24 while the last body weight is under 1,350 g or uniformity is under 85% creates an AUTO practice note.
- **Transfer age:** recorded from the `batch.transferred` event. It is emitted by `ProductionCageService.transferFromBrooder` and by `BatchLifecycleService` stage changes. Outside weeks 15–16 it creates an AUTO note.
- **Milestones:**
  - age at 50% production;
  - peak HD% (weeks 18–35, scored once week 35 is complete);
  - FCR at weeks 60, 72 and 90 (kg feed ÷ kg egg from week 20).

`persist()` only writes rows whose figures changed, so the second run of the same data writes 0 rows.

### A6. Deviation notifications

- A **run** is consecutive periods of one metric with the same off-standard status.
- Each run is announced **once**, to OWNER and MANAGER, if its latest period ended in the last 14 days.
- Runs that ended earlier are history and are marked seen silently.
- `dedupeKey = std:<batch>:<metric>:<status>:<ageUnit>:<firstAgeIndex>`.
- A row that later leaves and re-enters deviation keeps `notifiedAt`.
- The message names the current week, when the run started, the actual value, the band and its basis (guide edition / farm / held last week), and the implication.

### A7. Notification de-duplication (system-wide)

`common/prisma/notification-dedupe.ts` is wired into `PrismaService` as a Prisma query extension. The extended client keeps every `PrismaService` member.

| Key | Meaning |
|---|---|
| `k:<caller key>` | Passed as `dedupeKey` (meta of `notifyUser/notifyRole`, or `data.dedupeKey`). The same recipient never receives it again. |
| `h:<sha1(type, entity, title, message)>` | Default. Skipped while an identical notification is unread or newer than `NOTIFICATION_REPEAT_WINDOW_HOURS` (default 168). A changed text (new date or count) is new information and goes through. |

Other behaviour:
- `notification.create` on a repeat returns the existing row, marked with the `DEDUPED` symbol.
- `NotificationsService` sends no socket push for suppressed rows.
- Explicit keys are now used for: deviations, guide activation, farm-standard proposals, and production-report uploads (key = hash of the parsed rows).

### A8. API (`/api/v1/breed-standards`)

| Method & path | Permission | Purpose |
|---|---|---|
| GET `catalog`, `breeds`, `registration-options?strain=` | FLOCK_VIEW | Catalogue, breeds with editions, registration form options |
| POST `breeds`, PATCH `breeds/:id/aliases` | BREED_STANDARD_MANAGE | New breed, alias edits (re-links batches) |
| GET `guides/template`, `guides/:id` | BREED_STANDARD_VIEW | CSV template, guide points by metric |
| POST `guides/upload` (multipart) | BREED_STANDARD_MANAGE | New edition as **DRAFT** — template CSV/XLSX/JSON read exactly, PDF/photo read by Claude (`AiService.extractBreedGuide`, streaming) |
| POST `guides/:id/activate`, `guides/:id/archive` | BREED_GUIDE_APPROVE | Use / discard an edition |
| GET `batches/:id` | BREED_STANDARD_VIEW | Full batch benchmark: plan, metrics + history, open and past deviations, practices, this week's guide reference, lessons |
| PATCH `batches/:id/setup` | FLOCK_BATCH_MANAGE | Recording plan, housing, light hours, nutrition programme, breed |
| POST `batches/:id/evaluate` | BREED_STANDARD_VIEW | Re-check now |
| POST `batches/:id/practices`, PATCH `practices/:id/end`, DELETE `practices/:id` | BREED_STANDARD_MANAGE | Practices outside the guide (DELETE is a soft delete) |
| GET `breeds/:id/compare?metric=`, `breeds/:id/lessons` | BREED_STANDARD_VIEW | Same-breed comparison, lessons |
| GET `breeds/:id/farm-standards`; POST `breeds/:id/farm-standards/suggest`, `farm-standards` | VIEW / MANAGE | List, system proposals, manual proposal |
| POST `farm-standards/:id/decide`, `farm-standards/:id/retire` | BREED_GUIDE_APPROVE | Approve / reject / retire |

Also: `GET /production/hdp-controls/guide-coverage`. `GET /production/hdp-controls/comparison/:batchId` now returns `source: GUIDE|UPLOAD` and the min/max band.

`POST /flock/batches` and `PATCH /flock/batches/:id` accept the recording-plan fields directly.

### A9. Farm standards and lessons

- **`proposeFarmStandards(breedId)`:**
  - considers only metrics with a clear "better" direction: HD%, HH/HD eggs, uniformity, egg mass, both mortalities, FCR;
  - for each week where ≥ `FARM_STANDARD_MIN_BATCHES` (default 3) batches have results, takes the farm's best quartile;
  - if that beats the guide in at least 3 weeks, creates a PROPOSED standard with evidence and notifies the Director.
- **Manual proposals** need a reason. Approving one retires the previous approved standard for the same metric.
- **`lessons(breedId)`** returns:
  - repeated problems: the same metric off standard in ≥2 earlier batches, with weeks and implication;
  - strengths: the best batch per metric, ≥80% of weeks on standard;
  - earlier practices with their outcome.

  It is shown on the batch page and passed to AI prompts.

### A10. AI

- `StandardComplianceService.buildAiContext(batchId)` builds a text block with:
  - guide edition and housing;
  - parameters **not recorded**, with implications — **only if any**;
  - practices outside the guide, with implications calculated numerically against the band where the practice states a number;
  - current deviations with run length, earlier deviations, what is on standard, and lessons from earlier batches.
- Prompts tell the model to mention not-recorded parameters only where they limit a conclusion.
- `AiService.extractBreedGuide()` uses `ANTHROPIC_MODEL_GUIDE` → `ANTHROPIC_MODEL_BATCH_REPORT` → `claude-opus-5-5`. It streams up to 64k output tokens. AI-read guides are always DRAFT.

### A11. Config

```
ANTHROPIC_MODEL_GUIDE=            # model for reading uploaded guides (optional)
NOTIFICATION_REPEAT_WINDOW_HOURS=168
FARM_STANDARD_MIN_BATCHES=3
```

### A12. Adding a breed or a new edition

1. Breed Standards → Guides → "Add a guide". Either:
   - pick the breed, or type a new name plus other spellings;
   - give the edition label and year, and the variety only if the guide is variety-specific.
2. Upload the filled template (exact) or the PDF/photo (AI draft). Check the warnings and the AI reading.
3. The Director clicks **Use this edition**. The old edition is archived, and all batches of that breed switch at the next evaluation.

A code seed is also possible: add a `GuideSeed` file and call `seedGuide()` in `onModuleInit`. Re-seeding only adds metrics missing from an edition; it never rewrites existing ones.

### A13. Verification done

- Backend: `tsc` clean; ESLint 0 errors (only `any` warnings, as in the rest of the codebase); **160/160 vitest tests pass**. 27 are new, in `breed-standards/__tests__/breed-standards.spec.ts`, covering band picking and extension, tolerance, uniformity, feed mapping, guide data, the util replacing De Heus, the template parser and dedupe keys.
- Migration: applied to a fresh PostgreSQL 16 database **from zero** and re-run (idempotent).
- End-to-end on the local DB with a synthetic 30-week Hy-Line batch:
  - "Hyline Brown Max" → Hy-Line Brown (variety Brown Max) at registration;
  - planted problems flagged correctly: underfeeding in weeks 8–12, cold brooder on days 0–3, pre-lay in week 13, HD% dip in weeks 26–28;
  - only the one still-current issue (lay mortality) was notified, once per user; a second run notified nothing and wrote 0 rows;
  - notification dedupe checked for `create`, `createMany`, and `create` inside a transaction;
  - guide upload → activate → supersede → re-activate.
- Frontend: `tsc` clean; ESLint clean on changed files; `vite build` passes; pages checked in a browser (Playwright screenshots).

### A14. Assumptions and known limits

- Egg weight assumes the tray weight entered covers the good (trayed) eggs.
- Brooder temperature is compared with the guide's **cage** temperatures, because the brooder uses cages.
- Weekly light hours use the guide's light-programme chart (p.12). The brooding chart's hours (p.9) differ slightly and are kept as reference.
- `brooder_control_standards` and the synchronous feed helpers use the Hy-Line table for all layer batches, as before. Breed-aware comparisons go through `resolveBand`.
- Nutrient specifications are reference only. Feed composition is not recorded, so it cannot be checked.
- Store production report rows are not yet a data source for the engine. It uses system tables plus the report's weight track.
- Pre-existing issues found while testing, not changed here:
  - `OrderStatus.DELIVERING` is in `schema.prisma` but in no migration, so sales/dashboard queries fail on a database built only from migrations;
  - `prisma/seed.ts` fails (`deleteMany` on an undefined model);
  - the migrations folder drifts from `schema.prisma` in other places.

---

## Part B — Farmer's view

### B1. What is new, in short

- The system now knows the **Hy-Line Brown guide (January 2024 edition)**. Any batch registered as "Hy-Line", "Hyline Brown", "Hyline Brown Max" and similar is checked against it automatically.
- **Every week**, each batch's records are compared with the guide: weight, feed, laying %, egg weight, mortality, brooding temperature, light and so on.
- When something goes off standard, the Director and the Production Manager get **one message** saying:
  - what is off;
  - by how much;
  - since which week;
  - why it matters.

  If it stays off for five weeks, you still get one message, not five.
- **Notifications no longer repeat.** If something was already flagged, it is not flagged again. Re-uploading the same report does not send the same message again.
- **HDP% Controls:** Hy-Line batches use the guide's laying targets. You no longer need to upload an HDP curve for them.

### B2. The old weight/feed chart has been replaced

The brooder chart used before (De Heus) has been replaced by the Hy-Line guide, so some targets change:

| Week | Old weight target | New (Hy-Line guide) | Old feed g/bird/day | New |
|---|---|---|---|---|
| 1 | 110–117 g | 70–80 g | 16.5 | 13 (12–14) |
| 10 | 871–921 g | 885–995 g | 59 | 60 (56–64) |
| 17 | 1,357–1,434 g | 1,485–1,590 g | 79.5 | 78.5 (72–85) |
| 40 (in lay) | compared with week 19 (wrong) | 1,950–2,090 g | flat 115 | 112 (108–116) |

Laying birds were previously compared with week 19 weights, which made healthy hens look "overweight". That no longer happens.

### B3. Registering a batch

When you type the breed in **New Batch**, a green box shows the matched guide and its edition. Then:
1. **Tick what you will record** for this batch. Everything the system can record is ticked by default.
2. Untick anything you will not record. The box immediately shows **what you give up**. For example: *"Water intake: a drop in water use is often the first sign of illness … that early warning is lost."*
3. **Not measured at the farm.** These are always skipped and listed with their consequences:
   - egg grading (small/medium/large);
   - egg quality (Haugh units, shell strength, shell colour);
   - body condition score;
   - water lab tests.
4. **Housing / lighting.** Choose light-controlled or open-sided and describe the house. Example: *windows covered with gunias, some light through the roof*. If you know your hours of light per day, enter them; the guide's lighting programme is then checked against them.
5. **Nutrition programme.** Compare with **both** the economical and optimal programmes (the default), or just one.

All of this can be changed later on the Breed Standards page under **Recording plan → Change**.

### B4. The Breed Standards page

Menu: **Breed Standards** (Production Manager and Director).

- **Batch tab:**
  - **Off standard now:** each problem, how long it has lasted and what it means.
  - **Earlier in this batch:** problems that have ended.
  - **Practices different from the guide:** write down what the farm does differently and why, e.g. "14 h light — roof gaps let in light". The system shows the guide's figure and the likely effect. Some practices it notes by itself, e.g. pre-lay feed given before week 15, or transfer outside weeks 15–16.
  - **Recording plan:** what is and isn't recorded, and the consequences.
  - **Parameters vs standard:** every parameter's latest figure and the % of weeks on standard. Tap a row to see every week.
  - **What the guide says for this week:**
    - target weight, feed, water, light, laying % and egg weight;
    - the diet phase (e.g. "Layer 3");
    - daily nutrient targets for both programmes;
    - calcium and phosphorus;
    - space.
  - **From earlier batches of this breed:** mistakes to avoid repeating, what worked best, and the practices tried before.
  - **Re-check now:** updates immediately instead of waiting for the nightly check.
- **Compare batches:** pick a parameter (e.g. hen-day %) to see every Hy-Line batch week by week, next to the guide and the farm's best.
- **Guides:** which edition is in use. When Hy-Line publishes a newer edition:
  1. upload it here (as the PDF or the template);
  2. the **Director** clicks "Use this edition";
  3. the old edition is kept but marked as replaced, so it is always clear which version is in use.

  Other breeds' guides are added the same way.
- **Farm standards:** when the farm keeps doing **better than the guide**, the system can propose a stricter "farm standard". It needs results from 3 or more batches of the breed. The Production Manager can also propose one with a reason. The **Director approves** it. After that, flags use the farm standard, and the guide figure is still shown alongside.

### B5. When the batch is older than the guide

The Hy-Line guide stops at week 100. After that:
- Weight, laying %, feed, water, egg weight and light keep following **week 100's figures**. These are marked "held".
- Running totals (eggs per hen, egg mass, mortality since week 18) and brooding-only checks stop, because holding them flat would give wrong results.

### B6. What the AI reports now say

AI reports now include, for each Hy-Line batch:
- which guide edition it is measured against;
- what is off standard and for how long;
- the effect of anything the farm does differently from the guide;
- lessons from earlier batches of the same breed.

Parameters you chose not to record (or cannot measure, like egg grading) are mentioned **only when that gap affects a conclusion**.

### B7. Good habits that make this work

- **Weigh birds regularly.** Enter individual bird weights (at least 10 birds) so uniformity can be worked out. The guide says to raise light only at 1.35 kg and 85% uniformity.
- **Weigh trays at collection.** This gives egg weight, egg mass and feed conversion (kg feed per kg eggs).
- **Record water** on each session. Falling water use is the earliest sign of trouble.
- **Note practices.** When the farm deliberately does something differently, record it with the reason. It then counts as a decision, not a mistake, in reports and in the lessons for the next batch.
