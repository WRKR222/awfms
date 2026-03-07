/**
 * AWFMS Database Seed
 * Creates: 5 test users (one per role), 8 houses, sample suppliers,
 * vaccination schedules, price tiers, and system config.
 * Run: npx ts-node prisma/seed.ts
 */

import { PrismaClient, UserRole, BirdType, SalesTier, VaccinationRoute } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding AWFMS database...');

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
    { name: 'House 1 — Layers', code: 'H1', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House 2 — Layers', code: 'H2', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
    { name: 'House 3 — Layers', code: 'H3', capacity: 3000, birdType: BirdType.LAYER_COMMERCIAL },
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
  const kenchic = await prisma.supplier.upsert({
    where: { id: 'supplier-kenchic-001' },
    create: { id: 'supplier-kenchic-001', name: 'Kenchic Limited', contact: '+254 722 000 001' },
    update: {},
  });
  const poultryBreeders = await prisma.supplier.upsert({
    where: { id: 'supplier-pb-001' },
    create: { id: 'supplier-pb-001', name: 'Poultry Breeders Kenya', contact: '+254 722 000 002' },
    update: {},
  });
  console.log('✓ 2 suppliers seeded');

  // ── Users — one per role ─────────────────────────────────────────────────
  const TEMP_PASSWORD = 'AwfmsTemp2025!'; // All test users start with this
  const passwordHash = await bcrypt.hash(TEMP_PASSWORD, 12);

  const users = await Promise.all([
    prisma.user.upsert({
      where: { username: 'james.attendant' },
      create: {
        username: 'james.attendant',
        email: 'james@anzawf.co.ke',
        passwordHash,
        role: UserRole.ATTENDANT,
        fullName: 'James Muriithi',
        houseIds: [houses[0].id, houses[1].id], // H1 and H2
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { username: 'grace.supervisor' },
      create: {
        username: 'grace.supervisor',
        email: 'grace@anzawf.co.ke',
        passwordHash,
        role: UserRole.SUPERVISOR,
        fullName: 'Grace Wanjiku',
        houseIds: [],
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { username: 'peter.manager' },
      create: {
        username: 'peter.manager',
        email: 'peter@anzawf.co.ke',
        passwordHash,
        role: UserRole.MANAGER,
        fullName: 'Peter Kamau',
        houseIds: [],
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { username: 'amina.accountant' },
      create: {
        username: 'amina.accountant',
        email: 'amina@anzawf.co.ke',
        passwordHash,
        role: UserRole.ACCOUNTANT,
        fullName: 'Amina Hassan',
        houseIds: [],
      },
      update: {},
    }),
    prisma.user.upsert({
      where: { username: 'director.anza' },
      create: {
        username: 'director.anza',
        email: 'director@anzawf.co.ke',
        passwordHash,
        role: UserRole.OWNER,
        fullName: 'Director Anza',
        houseIds: [],
      },
      update: {},
    }),
  ]);
  console.log(`✓ ${users.length} users seeded (all password: ${TEMP_PASSWORD})`);

  // ── Egg Price Tiers ─────────────────────────────────────────────────────
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
  console.log('✓ 2 egg price tiers seeded (Tier 1: KES 360/tray, Tier 2: KES 330/tray)');

  // ── Vaccination Schedules ────────────────────────────────────────────────
  const schedules = [
    { vaccineName: 'Marek\'s Disease', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 0, route: VaccinationRoute.INJECTION, notes: 'At hatchery' },
    { vaccineName: 'Newcastle Disease (ND) 1st', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 1, route: VaccinationRoute.EYE_DROP },
    { vaccineName: 'Infectious Bronchitis (IB)', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 1, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Gumboro (IBD)', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 2, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Gumboro Booster', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 3, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle Disease (ND) 2nd', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 4, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle + IB Booster', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 8, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Newcastle Booster (Inactivated)', birdType: BirdType.LAYER_COMMERCIAL, ageWeeks: 16, route: VaccinationRoute.INJECTION, notes: 'Before production start' },
    { vaccineName: 'Kienyeji Newcastle 1st', birdType: BirdType.KIENYEJI, ageWeeks: 1, route: VaccinationRoute.EYE_DROP },
    { vaccineName: 'Kienyeji Gumboro', birdType: BirdType.KIENYEJI, ageWeeks: 2, route: VaccinationRoute.DRINKING_WATER },
    { vaccineName: 'Kienyeji Newcastle Booster', birdType: BirdType.KIENYEJI, ageWeeks: 5, route: VaccinationRoute.DRINKING_WATER },
  ];

  for (const s of schedules) {
    await prisma.vaccinationSchedule.upsert({
      where: { id: `vac-${s.vaccineName.replace(/\s+/g, '-').toLowerCase()}-${s.birdType}` },
      create: {
        id: `vac-${s.vaccineName.replace(/\s+/g, '-').toLowerCase()}-${s.birdType}`,
        ...s,
      },
      update: {},
    });
  }
  console.log(`✓ ${schedules.length} vaccination schedules seeded`);

  console.log('\n🎉 AWFMS seed complete!');
  console.log('\nTest login credentials (all users):');
  console.log('Password: AwfmsTemp2025!');
  console.log('\nUsers:');
  users.forEach(u => console.log(`  ${u.role}: ${u.username}`));
}

main()
  .catch(e => { console.error('Seed error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
