/**
 * AWFMS Database Seed — v2.0
 * Updated March 2026 — new username conventions per director requirements.
 * Creates: 6 test users (updated usernames), 8 houses, suppliers,
 * vaccination schedules, price tiers, and system config.
 * Run: npx ts-node prisma/seed.ts
 */

import { PrismaClient, UserRole, BirdType, SalesTier, VaccinationRoute } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding AWFMS database...');

  // ── CLEANUP: Delete all historical test/transactional data before seeding ──
  // Order matters — children before parents to respect FK constraints
  console.log('🗑️  Clearing historical test data...');
  await prisma.eggBreakageAdjustment.deleteMany({});
  await prisma.eggTallyVerification.deleteMany({});
  await prisma.eggCollectionSession.deleteMany({});
  await prisma.invoicePayment.deleteMany({});
  await prisma.arEntry.deleteMany({});
  await prisma.invoice.deleteMany({});
  await prisma.salesOrderItem.deleteMany({});
  await prisma.salesOrder.deleteMany({});
  await prisma.advanceBooking.deleteMany({});
  await prisma.expenseLog.deleteMany({});
  await prisma.dailyEggPrice.deleteMany({});
  await prisma.storeStockOut.deleteMany({});
  await prisma.storeStockIn.deleteMany({});
  await prisma.feedIntakeLog.deleteMany({});
  await prisma.vaccinationRecord.deleteMany({});
  await prisma.mortalityLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.localPurchaseOrderItem.deleteMany({});
  await prisma.localPurchaseOrder.deleteMany({});
  await prisma.purchaseRequestItem.deleteMany({});
  await prisma.purchaseRequest.deleteMany({});
  await prisma.batch.deleteMany({});
  console.log('✓ Historical test data cleared');

  // ── System Config ──────────────────────────────────────────────────────────
  await prisma.systemConfig.upsert({
    where: { key: 'FEED_ALERT_THRESHOLD_DAYS' },
    create: { key: 'FEED_ALERT_THRESHOLD_DAYS', value: '3' },
    update: {},
  });
  await prisma.systemConfig.upsert({
    where: { key: 'MORTALITY_ANOMALY_THRESHOLD_PCT' },
    create: { key: 'MORTALITY_ANOMALY_THRESHOLD_PCT', value: '15' },
    update: {},
  });

  // ── Houses ─────────────────────────────────────────────────────────────────
  const houseData = [
    { name: 'House D — Layers', code: 'HD', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House E — Layers', code: 'HE', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House F — Layers', code: 'HF', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House 4 — Layers', code: 'H4', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House 5 — Layers', code: 'H5', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House 6 — Layers', code: 'H6', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'Kienyeji House A', code: 'KA', capacity: 1500, birdType: BirdType.KIENYEJI },
    { name: 'Kienyeji House B', code: 'KB', capacity: 1500, birdType: BirdType.KIENYEJI },
  ];

  const houses: any[] = [];
  for (const h of houseData) {
    const house = await prisma.house.upsert({
      where: { code: h.code },
      create: h,
      update: {},
    });
    houses.push(house);
  }
  console.log(`✓ ${houses.length} houses seeded`);

  // ── Suppliers ──────────────────────────────────────────────────────────────
  await prisma.supplier.upsert({
    where: { id: 'supplier-kenchic-001' },
    create: { id: 'supplier-kenchic-001', name: 'Kenchic Limited', contact: '+254 722 000 001' },
    update: {},
  });
  await prisma.supplier.upsert({
    where: { id: 'supplier-pb-001' },
    create: { id: 'supplier-pb-001', name: 'Poultry Breeders Kenya', contact: '+254 722 000 002' },
    update: {},
  });
  console.log('✓ 2 suppliers seeded');

  // ── Users — updated username conventions ──────────────────────────────────
  // Format: role + number (e.g. attendant1, manager1, director1)
  const TEMP_PASSWORD = 'AwfmsTemp2025!';
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);

  const userData = [
    { username: 'attendant1', fullName: 'Lead Attendant',     email: 'attendant1@anzawholefoods.com', passwordHash, role: UserRole.ATTENDANT },
    { username: 'manager1',   fullName: 'Production Manager', email: 'manager1@anzawholefoods.com',   passwordHash, role: UserRole.MANAGER },
    { username: 'accountant1',fullName: 'Accountant',         email: 'accountant1@anzawholefoods.com',passwordHash, role: UserRole.ACCOUNTANT },
    { username: 'director1',  fullName: 'Director',           email: 'director@anzawholefoods.com',   passwordHash, role: UserRole.OWNER },
    { username: 'sales1',     fullName: 'Sales Person',       email: 'sales1@anzawholefoods.com',     passwordHash, role: UserRole.SALES },
    { username: 'store1',     fullName: 'Store',              email: 'store1@anzawholefoods.com',     passwordHash, role: UserRole.STORE },
    { username: 'security1',  fullName: 'Security Main Gate', email: 'security1@anzawholefoods.com',  passwordHash, role: UserRole.SECURITY1 },
    { username: 'security2',  fullName: 'Security Farm Gate', email: 'security2@anzawholefoods.com',  passwordHash, role: UserRole.SECURITY2 },
  ];

  const users: any[] = [];
  for (const u of userData) {
    const user = await prisma.user.upsert({
      where: { username: u.username },
      create: { ...u, houseIds: [] },
      update: { fullName: u.fullName, email: u.email },
    });
    users.push(user);
  }
  console.log(`✓ ${users.length} users seeded`);

  // ── Feed Store Items ──────────────────────────────────────────────────────
  // Feed has historically been tracked only via FeedDelivery/FeedIntakeLog, not
  // as a StoreItem. The Issuance Plan stock-out gate requires every issuable
  // item — feed included — to exist as a StoreItem with a currentStock figure.
  // Names below match FEED_LABELS in issuance-plan.service.ts exactly so the
  // PM's weekly feed plan can find the right StoreItem to attach to.
  const storeUser = users.find(u => u.role === UserRole.STORE);
  const feedItemData = [
    { sku: 'FEED-CHICK-MASH',        name: 'Chick & Duckling Mash', feedType: 'CHICK_MASH' },
    { sku: 'FEED-GROWER-MASH',       name: "Grower's Mash",         feedType: 'GROWER_MASH' },
    { sku: 'FEED-LAYER-MASH',        name: 'Layer Mash',            feedType: 'LAYER_MASH' },
    { sku: 'FEED-KIENYEJI-STARTER',  name: 'Kienyeji Starter',      feedType: 'KIENYEJI_STARTER' },
    { sku: 'FEED-KIENYEJI-GROWER',   name: 'Kienyeji Grower',       feedType: 'KIENYEJI_GROWER' },
    { sku: 'FEED-KIENYEJI-FINISHER', name: 'Kienyeji Finisher',     feedType: 'KIENYEJI_FINISHER' },
  ];
  if (storeUser) {
    for (const f of feedItemData) {
      await prisma.storeItem.upsert({
        where: { sku: f.sku },
        create: {
          sku: f.sku,
          name: f.name,
          category: 'FEED_SUPPLEMENT' as any,
          unit: 'KG' as any,
          description: `Auto-created for Issuance Plan feed tracking (${f.feedType})`,
          reorderLevel: 200,
          unitCostKes: 0,
          currentStock: 0,
          isActive: true,
          createdById: storeUser.id,
        },
        update: {},
      });
    }
    console.log(`✓ ${feedItemData.length} feed store items seeded`);
  } else {
    console.warn('⚠️  No STORE user found — skipped feed store item seeding');
  }

  // ── Egg Price Tiers ────────────────────────────────────────────────────────
  await prisma.eggPriceTier.upsert({
    where: { id: 'tier-1-2025' },
    create: {
      id: 'tier-1-2025',
      tier: SalesTier.TIER_1,
      minTrays: 1,
      maxTrays: 10,
      pricePerTray: 360,
      effectiveFrom: new Date('2025-01-01'),
    },
    update: {},
  });
  await prisma.eggPriceTier.upsert({
    where: { id: 'tier-2-2025' },
    create: {
      id: 'tier-2-2025',
      tier: SalesTier.TIER_2,
      minTrays: 11,
      maxTrays: null,
      pricePerTray: 330,
      effectiveFrom: new Date('2025-01-01'),
    },
    update: {},
  });
  console.log('✓ Egg price tiers seeded (Tier 1: KES 360/tray, Tier 2: KES 330/tray)');

  // ── Vaccination Schedules ──────────────────────────────────────────────────
  const schedules = [
    { vaccineName: "Marek's Disease",              birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 0,  route: VaccinationRoute.INJECTION,      notes: 'At hatchery' },
    { vaccineName: 'Newcastle Disease (ND) 1st',   birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 1,  route: VaccinationRoute.EYE_DROP },
    { vaccineName: 'Infectious Bronchitis (IB)',    birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 1,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Gumboro (IBD)',                 birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 2,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Gumboro Booster',               birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 3,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle Disease (ND) 2nd',    birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 4,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle + IB Booster',        birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 8,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle Booster (Inactivated)',birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 16, route: VaccinationRoute.INJECTION, notes: 'Before production start' },
    { vaccineName: 'Kienyeji Newcastle 1st',        birdType: BirdType.KIENYEJI,         ageWeeks: 1,  route: VaccinationRoute.EYE_DROP },
    { vaccineName: 'Kienyeji Gumboro',              birdType: BirdType.KIENYEJI,         ageWeeks: 2,  route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Kienyeji Newcastle Booster',    birdType: BirdType.KIENYEJI,         ageWeeks: 5,  route: VaccinationRoute.DRINKING_WATER },
  ];

  for (const s of schedules) {
    const id = `vac-${s.vaccineName.replace(/\s+/g, '-').toLowerCase()}-${s.birdType}`;
    await prisma.vaccinationSchedule.upsert({
      where: { id },
      create: { id, ...s },
      update: {},
    });
  }
  console.log(`✓ ${schedules.length} vaccination schedules seeded`);


  // ── Farm Infrastructure — Block 1 (Production House) ───────────────────────
  // Required for the cage map to load. Block 2 is under construction.
  const block1 = await prisma.farmBlock.upsert({
    where: { code: 'BLK1' },
    create: { code: 'BLK1', name: 'Block 1 — Production House', isActive: true, isUnderConstruction: false },
    update: {},
  });

  await prisma.farmBlock.upsert({
    where: { code: 'BLK2' },
    create: { code: 'BLK2', name: 'Block 2 — Under Construction', isActive: false, isUnderConstruction: true },
    update: {},
  });

  const sectionDefs = [
    { code: 'A', sortOrder: 1, rows: ['A1', 'A2'] },
    { code: 'B', sortOrder: 2, rows: ['B1', 'B2'] },
    { code: 'C', sortOrder: 3, rows: ['C1', 'C2'] },
  ];

  for (const secDef of sectionDefs) {
    let section = await prisma.farmSection.findFirst({
      where: { blockId: block1.id, code: secDef.code },
    });
    if (!section) {
      section = await prisma.farmSection.create({
        data: { blockId: block1.id, code: secDef.code, sortOrder: secDef.sortOrder },
      });
    }
    for (const rowCode of secDef.rows) {
      const existingRow = await prisma.farmRow.findFirst({
        where: { sectionId: section.id, rowCode },
      });
      if (!existingRow) {
        await prisma.farmRow.create({
          data: { sectionId: section.id, rowCode, isActive: true },
        });
      }
    }
  }
  console.log('✓ Farm infrastructure seeded (Block 1: 3 sections × 2 rows, Block 2: under construction)');

  // ── Brooder Cage Map — 6 fixed rows/decks × 4 levels (bottom→top) ──────────
  // Mirrors what migration 20260621000000_phase9_brooder_cage_map seeds for
  // `prisma migrate deploy`. Kept here too so `prisma db seed` / local resets
  // that don't replay raw-SQL migration inserts still get the grid.
  for (let rowNumber = 1; rowNumber <= 6; rowNumber++) {
    const row = await prisma.brooderRow.upsert({
      where: { rowNumber },
      create: { rowNumber, label: `Row ${rowNumber}`, isActive: true },
      update: {},
    });
    for (let levelNumber = 1; levelNumber <= 4; levelNumber++) {
      const label =
        levelNumber === 1 ? 'Level 1 (Bottom)' :
        levelNumber === 4 ? 'Level 4 (Top)' :
        `Level ${levelNumber}`;
      await prisma.brooderLevel.upsert({
        where: { rowId_levelNumber: { rowId: row.id, levelNumber } },
        create: { rowId: row.id, levelNumber, label, isActive: true },
        update: {},
      });
    }
  }
  console.log('✓ Brooder cage map seeded (6 rows × 4 levels = 24 cells)');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n🎉 AWFMS seed complete!');
  console.log('\nTest login credentials (all users):');
  console.log('Password: AwfmsTemp2025!');
  console.log('\nUsers:');
  users.forEach(u => console.log(`  ${u.role.padEnd(12)} : ${u.username}`));
}

main()
  .catch(e => { console.error('Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
