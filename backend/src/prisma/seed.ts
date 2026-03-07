/**
 * AWFMS Database Seed Script
 * Run: npx prisma db seed   (configured in package.json prisma.seed)
 *
 * Creates:
 *   - 5 roles (attendant, supervisor, manager, accountant, owner)
 *   - All permissions from PERMISSIONS constant
 *   - Role-permission assignments from ROLE_PERMISSIONS map
 *   - 8 poultry houses (3 layer cages, 2 Kienyeji, 2 brooders, 1 Kienyeji brooder)
 *   - 2 suppliers (Kenchic for chicks, Jumuia Farm Feeds for feed)
 *   - 5 test users — one per role
 */

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../common/permissions.constants';

const prisma = new PrismaClient();

const ROLES = [
  { name: 'attendant',  displayName: 'Poultry Attendant' },
  { name: 'supervisor', displayName: 'Group Leader / Supervisor' },
  { name: 'manager',    displayName: 'Production Manager' },
  { name: 'accountant', displayName: 'Accountant' },
  { name: 'owner',      displayName: 'Farm Owner / Director' },
];

const HOUSES = [
  { name: 'Cage House 1',        houseType: 'LAYERS_CAGE',       capacity: 3000 },
  { name: 'Cage House 2',        houseType: 'LAYERS_CAGE',       capacity: 3000 },
  { name: 'Cage House 3',        houseType: 'LAYERS_CAGE',       capacity: 3000 },
  { name: 'Kienyeji House 1',    houseType: 'KIENYEJI',          capacity: 2000 },
  { name: 'Kienyeji House 2',    houseType: 'KIENYEJI',          capacity: 2000 },
  { name: 'Brooder House 1',     houseType: 'BROODER',           capacity: 5000 },
  { name: 'Brooder House 2',     houseType: 'BROODER',           capacity: 5000 },
  { name: 'Kienyeji Brooder',    houseType: 'KIENYEJI_BROODER',  capacity: 3000 },
];

const SUPPLIERS = [
  { name: 'Kenchic Limited',      supplierType: 'CHICK_SUPPLIER', contactPhone: '+254700000001' },
  { name: 'Jumuia Farm Feeds Ltd', supplierType: 'FEED_SUPPLIER',  contactPhone: '+254700000002' },
];

const TEST_PASSWORD = 'Test1234!';
const TEST_USERS = [
  { username: 'james.attendant',  email: 'james@awfms.test',    roleName: 'attendant'  },
  { username: 'grace.supervisor', email: 'grace@awfms.test',    roleName: 'supervisor' },
  { username: 'peter.manager',    email: 'peter@awfms.test',    roleName: 'manager'    },
  { username: 'amina.accountant', email: 'amina@awfms.test',    roleName: 'accountant' },
  { username: 'director.owner',   email: 'director@awfms.test', roleName: 'owner'      },
];

async function seed() {
  console.log('🌱 Starting AWFMS database seed...\n');

  // ── 1. Roles ───────────────────────────────────────────────────────────────
  console.log('Creating roles...');
  const roleMap: Record<string, string> = {};
  for (const role of ROLES) {
    const created = await prisma.role.upsert({
      where: { name: role.name },
      update: { displayName: role.displayName },
      create: role,
    });
    roleMap[role.name] = created.id;
    console.log(`  ✓ Role: ${role.displayName}`);
  }

  // ── 2. Permissions ─────────────────────────────────────────────────────────
  console.log('\nCreating permissions...');
  const permKeys = Object.values(PERMISSIONS);
  const permMap: Record<string, string> = {};

  for (const key of permKeys) {
    const module = key.split('.')[0];
    const perm = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, module, description: key },
    });
    permMap[key] = perm.id;
  }
  console.log(`  ✓ ${permKeys.length} permissions created`);

  // ── 3. Role-Permission Assignments ─────────────────────────────────────────
  console.log('\nAssigning permissions to roles...');
  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const roleId = roleMap[roleName];
    if (!roleId) continue;

    let count = 0;
    for (const key of permissionKeys) {
      const permissionId = permMap[key];
      if (!permissionId) {
        console.warn(`  ⚠ Permission key not found: ${key}`);
        continue;
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
      count++;
    }
    console.log(`  ✓ ${roleName}: ${count} permissions assigned`);
  }

  // ── 4. Houses ──────────────────────────────────────────────────────────────
  console.log('\nCreating houses...');
  for (const house of HOUSES) {
    await prisma.house.upsert({
      where: { name: house.name } as any,
      update: {},
      create: house as any,
    });
    console.log(`  ✓ ${house.name} (capacity: ${house.capacity})`);
  }

  // ── 5. Suppliers ───────────────────────────────────────────────────────────
  console.log('\nCreating suppliers...');
  for (const supplier of SUPPLIERS) {
    await prisma.supplier.upsert({
      where: { name: supplier.name } as any,
      update: {},
      create: supplier as any,
    });
    console.log(`  ✓ ${supplier.name}`);
  }

  // ── 6. Test Users ──────────────────────────────────────────────────────────
  console.log('\nCreating test users...');
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);

  for (const u of TEST_USERS) {
    const roleId = roleMap[u.roleName];
    await prisma.user.upsert({
      where: { username: u.username },
      update: {},
      create: {
        username: u.username,
        email: u.email,
        passwordHash,
        roleId,
      },
    });
    console.log(`  ✓ ${u.username} [${u.roleName}]`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('Test credentials (ALL use password: Test1234!)');
  console.log('┌─────────────────────────┬──────────────────────────────┐');
  console.log('│ Username                │ Role                         │');
  console.log('├─────────────────────────┼──────────────────────────────┤');
  for (const u of TEST_USERS) {
    console.log(`│ ${u.username.padEnd(23)} │ ${u.roleName.padEnd(28)} │`);
  }
  console.log('└─────────────────────────┴──────────────────────────────┘');
  console.log('\n⚠️  DELETE TEST USERS BEFORE GOING LIVE WITH REAL FARM DATA\n');
}

seed()
  .catch(e => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
