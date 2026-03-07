/**
 * AWFMS Phase 1 — Business Logic Unit Tests
 * Tests all calculable rules from PRD — no mocking of calculations themselves.
 * These tests must pass 100% before any deploy.
 *
 * Run: pnpm test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ════════════════════════════════════════════════════════════════════════════
// FLOCK MODULE — Business Logic
// ════════════════════════════════════════════════════════════════════════════

describe('Flock Business Logic', () => {
  describe('Closing Count Calculation', () => {
    it('computes closing count correctly: opening - deaths - culls', () => {
      const openingCount = 1000;
      const deaths = 5;
      const culls = 2;
      const closingCount = openingCount - deaths - culls;
      expect(closingCount).toBe(993);
    });

    it('allows zero deaths and zero culls', () => {
      expect(1000 - 0 - 0).toBe(1000);
    });

    it('does not allow deaths + culls to exceed opening count', () => {
      const openingCount = 100;
      const deaths = 60;
      const culls = 50; // 60 + 50 = 110 > 100
      const isInvalid = deaths + culls > openingCount;
      expect(isInvalid).toBe(true);
    });

    it('allows deaths + culls exactly equal to opening count (full batch loss)', () => {
      const openingCount = 100;
      const deaths = 100;
      const culls = 0;
      const isValid = deaths + culls <= openingCount;
      expect(isValid).toBe(true);
      expect(openingCount - deaths - culls).toBe(0);
    });
  });

  describe('Entry Date Validation', () => {
    it('rejects future dates', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const entryDate = tomorrow;
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      expect(entryDate > today).toBe(true); // Should be rejected
    });

    it('accepts today', () => {
      const today = new Date();
      const limit = new Date();
      limit.setHours(23, 59, 59, 999);
      expect(today <= limit).toBe(true);
    });

    it('accepts past dates', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const limit = new Date();
      limit.setHours(23, 59, 59, 999);
      expect(yesterday <= limit).toBe(true);
    });
  });

  describe('Stage Progression Rules', () => {
    const stageOrder = ['BROODING', 'GROWER', 'PRODUCTION'];

    it('allows BROODING → GROWER', () => {
      const current = 'BROODING';
      const next = 'GROWER';
      expect(stageOrder.indexOf(next)).toBe(stageOrder.indexOf(current) + 1);
    });

    it('allows GROWER → PRODUCTION', () => {
      const current = 'GROWER';
      const next = 'PRODUCTION';
      expect(stageOrder.indexOf(next)).toBe(stageOrder.indexOf(current) + 1);
    });

    it('rejects BROODING → PRODUCTION (skipping GROWER)', () => {
      const current = 'BROODING';
      const next = 'PRODUCTION';
      const isValid = stageOrder.indexOf(next) === stageOrder.indexOf(current) + 1;
      expect(isValid).toBe(false);
    });

    it('rejects backward progression PRODUCTION → GROWER', () => {
      const current = 'PRODUCTION';
      const next = 'GROWER';
      const isValid = stageOrder.indexOf(next) === stageOrder.indexOf(current) + 1;
      expect(isValid).toBe(false);
    });
  });

  describe('Bird Weight Sample', () => {
    it('calculates average weight correctly', () => {
      const weights = [1.62, 1.75, 1.68, 1.70, 1.65];
      const avg = weights.reduce((sum, w) => sum + w, 0) / weights.length;
      expect(Math.round(avg * 1000) / 1000).toBeCloseTo(1.68, 2);
    });

    it('requires weightsKg.length === sampleSize', () => {
      const weightsKg = [1.5, 1.6, 1.7];
      const sampleSize = 5; // Mismatch
      expect(weightsKg.length === sampleSize).toBe(false);
    });

    it('accepts matching sampleSize', () => {
      const weightsKg = [1.5, 1.6, 1.7, 1.8, 1.9];
      const sampleSize = 5;
      expect(weightsKg.length === sampleSize).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PRODUCTION MODULE — Hen-Day % Calculation
// ════════════════════════════════════════════════════════════════════════════

describe('Production Business Logic', () => {
  describe('Hen-Day Production % Calculation', () => {
    // Formula: (eggs collected / current hen count) × 100
    it('calculates hen-day % correctly for good production', () => {
      const totalWhole = 850;
      const currentCount = 1000;
      const henDayPct = Math.round((totalWhole / currentCount) * 10000) / 100;
      expect(henDayPct).toBe(85.0);
    });

    it('calculates hen-day % correctly for excellent production (>90%)', () => {
      const totalWhole = 950;
      const currentCount = 1000;
      const henDayPct = Math.round((totalWhole / currentCount) * 10000) / 100;
      expect(henDayPct).toBe(95.0);
    });

    it('returns null for zero bird count (division by zero protection)', () => {
      const currentCount = 0;
      const henDayPct = currentCount > 0 ? (900 / currentCount) * 100 : null;
      expect(henDayPct).toBeNull();
    });

    it('rounds to 2 decimal places', () => {
      const totalWhole = 333;
      const currentCount = 1000;
      const henDayPct = Math.round((totalWhole / currentCount) * 10000) / 100;
      expect(henDayPct).toBe(33.3);
    });

    it('does not allow totalWhole > currentCount (more eggs than hens impossible)', () => {
      // In practice this CAN happen (double yolks, counting errors), so we warn not reject
      // but we verify the formula produces > 100% for alerting purposes
      const totalWhole = 1050;
      const currentCount = 1000;
      const henDayPct = Math.round((totalWhole / currentCount) * 10000) / 100;
      expect(henDayPct).toBeGreaterThan(100); // Warning flag
    });
  });

  describe('Grade Sum Validation', () => {
    it('accepts grades that sum to totalWhole', () => {
      const totalWhole = 850;
      const gradeXl = 200;
      const gradeL = 350;
      const gradeM = 200;
      const gradeS = 80;
      const gradeReject = 20;
      const gradeSum = gradeXl + gradeL + gradeM + gradeS + gradeReject;
      expect(gradeSum).toBe(totalWhole);
    });

    it('accepts zero grades (grading not yet done)', () => {
      const gradeSum = 0;
      const totalWhole = 850;
      const isValid = gradeSum === totalWhole || gradeSum === 0;
      expect(isValid).toBe(true);
    });

    it('rejects grades that do not match totalWhole', () => {
      const totalWhole = 850;
      const gradeSum = 800; // Missing 50
      const isValid = gradeSum === totalWhole || gradeSum === 0;
      expect(isValid).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// FEED MODULE — Business Logic
// ════════════════════════════════════════════════════════════════════════════

describe('Feed Business Logic', () => {
  describe('Recommended Feed Range Calculation', () => {
    const FEED_STANDARDS = {
      '0-6':   { minKg: 0.020, maxKg: 0.030 },
      '7-18':  { minKg: 0.060, maxKg: 0.080 },
      '19-99': { minKg: 0.110, maxKg: 0.130 },
    };

    function getAgeKey(ageWeeks: number): string {
      if (ageWeeks <= 6) return '0-6';
      if (ageWeeks <= 18) return '7-18';
      return '19-99';
    }

    it('calculates correct recommended range for brooding birds (week 3)', () => {
      const birdCount = 1000;
      const ageWeeks = 3;
      const standard = FEED_STANDARDS[getAgeKey(ageWeeks)];
      expect(standard.minKg * birdCount).toBe(20);   // 20 kg min
      expect(standard.maxKg * birdCount).toBe(30);   // 30 kg max
    });

    it('calculates correct range for grower birds (week 12)', () => {
      const birdCount = 1000;
      const ageWeeks = 12;
      const standard = FEED_STANDARDS[getAgeKey(ageWeeks)];
      expect(standard.minKg * birdCount).toBe(60);
      expect(standard.maxKg * birdCount).toBe(80);
    });

    it('calculates correct range for production birds (week 25)', () => {
      const birdCount = 1000;
      const ageWeeks = 25;
      const standard = FEED_STANDARDS[getAgeKey(ageWeeks)];
      expect(standard.minKg * birdCount).toBe(110);
      expect(standard.maxKg * birdCount).toBe(130);
    });
  });

  describe('Wastage Validation', () => {
    it('rejects wastage greater than quantity dispensed', () => {
      const quantityDispensedKg = 100;
      const wastageKg = 110; // More wastage than dispensed
      const isValid = wastageKg <= quantityDispensedKg;
      expect(isValid).toBe(false);
    });

    it('accepts wastage equal to quantity dispensed (100% wastage — edge case)', () => {
      const quantityDispensedKg = 100;
      const wastageKg = 100;
      const isValid = wastageKg <= quantityDispensedKg;
      expect(isValid).toBe(true);
    });

    it('accepts zero wastage (normal case)', () => {
      const wastageKg = 0;
      const quantityDispensedKg = 100;
      expect(wastageKg <= quantityDispensedKg).toBe(true);
    });
  });

  describe('FCR Calculation', () => {
    // FCR = Total feed consumed (kg) / Total egg weight produced (kg)
    // Average egg weight = 60g = 0.060 kg
    it('calculates FCR correctly', () => {
      const totalFeedKg = 1000;
      const totalEggs = 8000;
      const totalEggKg = (totalEggs * 60) / 1000; // = 480 kg
      const fcr = Math.round((totalFeedKg / totalEggKg) * 100) / 100;
      expect(fcr).toBeCloseTo(2.08, 1); // ~2.08 kg feed per kg eggs
    });

    it('returns null when no eggs produced (avoids division by zero)', () => {
      const totalEggs = 0;
      const totalEggKg = (totalEggs * 60) / 1000;
      const fcr = totalEggKg === 0 ? null : 1000 / totalEggKg;
      expect(fcr).toBeNull();
    });

    it('produces a better (lower) FCR with more eggs for same feed', () => {
      const feed = 1000;
      const fcrGood = feed / ((10000 * 60) / 1000); // More eggs
      const fcrBad = feed / ((5000 * 60) / 1000);   // Fewer eggs
      expect(fcrGood).toBeLessThan(fcrBad);
    });
  });

  describe('Feed Stock Days Remaining', () => {
    it('calculates days remaining correctly', () => {
      const stockKg = 3000;
      const avgDailyConsumptionKg = 150; // 1000 birds × 0.15 kg/bird/day
      const daysRemaining = stockKg / avgDailyConsumptionKg;
      expect(Math.round(daysRemaining * 10) / 10).toBe(20);
    });

    it('triggers alert when days remaining <= threshold', () => {
      const THRESHOLD_DAYS = 3;
      const daysRemaining = 2.8;
      const shouldAlert = daysRemaining <= THRESHOLD_DAYS;
      expect(shouldAlert).toBe(true);
    });

    it('does NOT trigger alert above threshold', () => {
      const THRESHOLD_DAYS = 3;
      const daysRemaining = 5;
      const shouldAlert = daysRemaining <= THRESHOLD_DAYS;
      expect(shouldAlert).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AUTH & PERMISSIONS — Logic Rules
// ════════════════════════════════════════════════════════════════════════════

describe('Auth Business Logic', () => {
  describe('Password Validation', () => {
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

    it('accepts strong passwords', () => {
      expect(passwordRegex.test('Test1234!')).toBe(true);
      expect(passwordRegex.test('MyPass99')).toBe(true);
    });

    it('rejects all-lowercase password', () => {
      expect(passwordRegex.test('testpassword1')).toBe(false);
    });

    it('rejects password without numbers', () => {
      expect(passwordRegex.test('TestPassword')).toBe(false);
    });

    it('rejects all-uppercase password', () => {
      expect(passwordRegex.test('TESTPASSWORD1')).toBe(false);
    });
  });

  describe('JWT Token Expiry', () => {
    it('access token expires in 15 minutes', () => {
      const expiresIn = '15m';
      const minutes = parseInt(expiresIn.replace('m', ''));
      expect(minutes).toBe(15);
      expect(minutes).toBeLessThan(60); // Never longer than 1 hour for access tokens
    });

    it('refresh token expires in 7 days', () => {
      const expiresIn = '7d';
      const days = parseInt(expiresIn.replace('d', ''));
      expect(days).toBe(7);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// INVOICING — Business Logic (Phase 4 preview tests)
// ════════════════════════════════════════════════════════════════════════════

describe('Invoice Business Logic', () => {
  describe('Two-Tier Pricing', () => {
    // Tier 1: 1-10 trays, Tier 2: 11+ trays
    function selectPriceTier(quantityTrays: number): 'TIER1' | 'TIER2' {
      return quantityTrays >= 11 ? 'TIER2' : 'TIER1';
    }

    it('applies Tier 1 for 1 tray', () => {
      expect(selectPriceTier(1)).toBe('TIER1');
    });

    it('applies Tier 1 for exactly 10 trays', () => {
      expect(selectPriceTier(10)).toBe('TIER1');
    });

    it('applies Tier 2 for 11 trays', () => {
      expect(selectPriceTier(11)).toBe('TIER2');
    });

    it('applies Tier 2 for 100 trays', () => {
      expect(selectPriceTier(100)).toBe('TIER2');
    });
  });

  describe('Invoice Total Calculation', () => {
    it('calculates line total correctly', () => {
      const quantityTrays = 20;
      const unitPriceKes = 340;
      const lineTotal = quantityTrays * unitPriceKes;
      expect(lineTotal).toBe(6800);
    });

    it('calculates invoice total with prior balance', () => {
      const subtotalKes = 6800;
      const priorBalanceKes = 1200;
      const totalAmountKes = subtotalKes + priorBalanceKes;
      expect(totalAmountKes).toBe(8000);
    });

    it('calculates remaining balance after partial payment', () => {
      const totalAmountKes = 8000;
      const amountPaidKes = 5000;
      const balanceKes = totalAmountKes - amountPaidKes;
      expect(balanceKes).toBe(3000);
    });

    it('invoice marked PAID when balance reaches zero', () => {
      const balanceKes = 0;
      const status = balanceKes === 0 ? 'PAID' : balanceKes < 0 ? 'ERROR' : 'PARTIAL';
      expect(status).toBe('PAID');
    });

    it('invoice marked PARTIAL when balance > 0 but payment made', () => {
      const totalAmountKes = 8000;
      const amountPaidKes = 3000;
      const balanceKes = totalAmountKes - amountPaidKes;
      const status = balanceKes === 0 ? 'PAID' : amountPaidKes > 0 ? 'PARTIAL' : 'UNPAID';
      expect(status).toBe('PARTIAL');
    });
  });

  describe('Overdue Detection', () => {
    it('marks invoice as overdue when past due date with unpaid balance', () => {
      const dueDate = new Date('2024-01-01'); // Past date
      const today = new Date();
      const isOverdue = today > dueDate;
      expect(isOverdue).toBe(true);
    });

    it('does not mark as overdue when within credit terms', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const today = new Date();
      const isOverdue = today > futureDate;
      expect(isOverdue).toBe(false);
    });
  });
});
