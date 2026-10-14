// src/modules/breed-standards/guides/hyline-brown-2024.guide.ts
//
// Hy-Line Brown Commercial Layers — Conventional Systems Performance Guide,
// January 2024 (Hy-Line International, "BRN CONV STD ENG 011525").
// Transcribed table-for-table from the PDF the Director supplied. This file
// is both the seed for the BreedGuide/BreedStandardPoint tables and the
// source of the synchronous HyLine helpers in feed-standard.util.ts.
//
// Ages are WEEKS of age from hatch unless ageUnit = 'DAY'.

import { NUTRIENT_BY_KEY, nutrientKeyFromLabel, parseGuideNutrient } from '../feed-nutrients.catalog';

export interface GuidePointInput {
  metric: string;
  variant?: string | null;
  ageUnit?: 'WEEK' | 'DAY';
  ageFrom: number;
  ageTo?: number;
  min?: number | null;
  target?: number | null;
  max?: number | null;
  unit?: string | null;
  label?: string | null;
  phase?: string | null;
  text?: string | null;
}

export interface GuideSeed {
  breed: { code: string; name: string; birdType: 'LAYER_COMMERCIAL' | 'KIENYEJI'; aliases: string[] };
  guide: {
    title: string;
    versionLabel: string;
    versionYear: number;
    publisher: string;
    housingSystem: string;
    variety: string | null;
    sourceFileName: string;
  };
  points: GuidePointInput[];
}

// ── Rearing period table (p.4) ────────────────────────────────────────────
// [week, cumMort%, bwMin g, bwMax g, waterMin, waterMax ml/bird/day,
//  feedMin, feedMax g/bird/day, cumFeedMin, cumFeedMax g/bird, uniformity%]
export const HYLINE_BROWN_REARING: number[][] = [
  [1,  0.40,   70,   80,  18,  28, 12, 14,   84,   98, 85],
  [2,  0.55,  115,  145,  25,  42, 17, 21,  201,  244, 85],
  [3,  0.65,  190,  220,  30,  50, 20, 25,  343,  418, 85],
  [4,  0.75,  270,  320,  37,  60, 25, 30,  515,  627, 80],
  [5,  0.85,  360,  420,  43,  73, 29, 36,  717,  883, 80],
  [6,  0.95,  470,  520,  52,  89, 35, 44,  960, 1193, 80],
  [7,  1.05,  570,  640,  62,  98, 41, 49, 1249, 1537, 85],
  [8,  1.15,  680,  760,  71, 112, 47, 56, 1580, 1929, 85],
  [9,  1.25,  780,  880,  78, 122, 52, 61, 1943, 2355, 85],
  [10, 1.35,  885,  995,  84, 129, 56, 64, 2334, 2806, 85],
  [11, 1.45,  995, 1105,  90, 137, 60, 69, 2754, 3287, 85],
  [12, 1.55, 1095, 1205,  93, 144, 62, 72, 3189, 3791, 85],
  [13, 1.63, 1175, 1295,  96, 148, 64, 74, 3637, 4308, 85],
  [14, 1.70, 1265, 1365,  99, 154, 66, 77, 4099, 4845, 85],
  [15, 1.78, 1345, 1445, 102, 158, 68, 79, 4575, 5399, 85],
  [16, 1.85, 1410, 1510, 105, 164, 70, 82, 5066, 5973, 85],
  [17, 2.00, 1485, 1590, 108, 170, 72, 85, 5570, 6568, 90],
];

// ── Production period table (pp.5-6) ──────────────────────────────────────
// [week, hd%Min, hd%Max, hdEggsMin, hdEggsMax, hhEggsMin, hhEggsMax,
//  cumMort%, bwMin kg, bwMax kg, waterMin, waterMax, feedMin, feedMax,
//  hhEggMass kg (null = "–"), avgEggWt g]
export const HYLINE_BROWN_PRODUCTION: (number | null)[][] = [
  [18,  1.1,  7.7,   0.1,   0.5,   0.1,   0.5, 0.05, 1.55, 1.67, 110, 176,  73,  88, null, 46.5],
  [19,  8.2, 27.1,   0.7,   2.4,   0.7,   2.4, 0.08, 1.62, 1.74, 127, 188,  85,  94,  0.1, 49.3],
  [20, 30.8, 57.3,   2.8,   6.4,   2.8,   6.4, 0.13, 1.68, 1.80, 135, 197,  90,  99,  0.2, 51.6],
  [21, 61.4, 80.5,   7.1,  12.1,   7.1,  12.1, 0.20, 1.73, 1.85, 142, 205,  95, 103,  0.5, 53.5],
  [22, 82.4, 90.6,  12.9,  18.4,  12.8,  18.4, 0.27, 1.77, 1.89, 148, 215,  99, 107,  0.8, 55.0],
  [23, 90.6, 94.1,  19.2,  25.0,  19.2,  25.0, 0.34, 1.80, 1.92, 154, 222, 102, 111,  1.2, 56.4],
  [24, 93.2, 95.5,  25.7,  31.7,  25.7,  31.6, 0.40, 1.82, 1.95, 159, 228, 106, 114,  1.6, 57.5],
  [25, 94.2, 96.2,  32.3,  38.4,  32.2,  38.3, 0.46, 1.84, 1.98, 162, 230, 108, 115,  2.0, 58.4],
  [26, 94.6, 96.4,  39.0,  45.2,  38.8,  45.0, 0.50, 1.86, 2.00, 163, 231, 109, 116,  2.4, 59.2],
  [27, 94.8, 96.6,  45.6,  51.9,  45.4,  51.8, 0.55, 1.88, 2.01, 164, 232, 109, 116,  2.8, 59.9],
  [28, 94.8, 96.6,  52.2,  58.7,  52.0,  58.5, 0.61, 1.89, 2.03, 164, 232, 109, 116,  3.2, 60.4],
  [29, 94.8, 96.6,  58.9,  65.5,  58.6,  65.2, 0.66, 1.90, 2.04, 164, 233, 109, 117,  3.6, 60.9],
  [30, 94.8, 96.5,  65.5,  72.2,  65.2,  71.9, 0.71, 1.91, 2.05, 164, 233, 109, 117,  4.0, 61.3],
  [31, 94.7, 96.5,  72.1,  79.0,  71.8,  78.6, 0.76, 1.92, 2.06, 164, 233, 109, 117,  4.4, 61.7],
  [32, 94.7, 96.5,  78.8,  85.7,  78.4,  85.3, 0.80, 1.93, 2.07, 164, 234, 109, 117,  4.8, 62.0],
  [33, 94.6, 96.3,  85.4,  92.5,  84.9,  92.0, 0.86, 1.93, 2.07, 164, 233, 109, 117,  5.2, 62.3],
  [34, 94.4, 96.1,  92.0,  99.2,  91.5,  98.7, 0.92, 1.94, 2.08, 164, 233, 109, 117,  5.6, 62.5],
  [35, 94.2, 96.0,  98.6, 105.9,  98.0, 105.3, 0.97, 1.94, 2.08, 163, 233, 109, 117,  6.0, 62.7],
  [36, 94.0, 95.8, 105.2, 112.6, 104.5, 111.9, 1.02, 1.95, 2.08, 163, 233, 109, 116,  6.4, 62.9],
  [37, 93.7, 95.7, 111.7, 119.3, 111.0, 118.6, 1.08, 1.95, 2.09, 163, 233, 109, 116,  6.9, 63.1],
  [38, 93.5, 95.5, 118.3, 126.0, 117.5, 125.2, 1.12, 1.95, 2.09, 163, 232, 109, 116,  7.3, 63.2],
  [39, 93.3, 95.3, 124.8, 132.7, 123.9, 131.8, 1.18, 1.95, 2.09, 163, 232, 109, 116,  7.7, 63.3],
  [40, 93.1, 95.0, 131.3, 139.3, 130.4, 138.3, 1.24, 1.95, 2.09, 163, 232, 108, 116,  8.1, 63.4],
  [41, 92.8, 94.9, 137.8, 146.0, 136.8, 144.9, 1.30, 1.96, 2.09, 163, 232, 108, 116,  8.5, 63.5],
  [42, 92.5, 94.6, 144.3, 152.6, 143.2, 151.4, 1.35, 1.96, 2.10, 163, 232, 108, 116,  8.9, 63.6],
  [43, 92.1, 94.4, 150.8, 159.2, 149.5, 157.9, 1.41, 1.96, 2.10, 163, 232, 108, 116,  9.3, 63.7],
  [44, 91.8, 94.1, 157.2, 165.8, 155.9, 164.4, 1.47, 1.96, 2.10, 163, 232, 108, 116,  9.7, 63.8],
  [45, 91.5, 93.8, 163.6, 172.3, 162.2, 170.9, 1.52, 1.96, 2.10, 163, 232, 108, 116, 10.1, 63.9],
  [46, 91.2, 93.5, 170.0, 178.9, 168.4, 177.3, 1.59, 1.96, 2.10, 163, 232, 108, 116, 10.5, 63.9],
  [47, 90.9, 93.3, 176.3, 185.4, 174.7, 183.8, 1.64, 1.96, 2.10, 163, 232, 108, 116, 10.9, 64.0],
  [48, 90.7, 93.1, 182.7, 191.9, 181.0, 190.2, 1.70, 1.96, 2.10, 163, 232, 108, 116, 11.4, 64.0],
  [49, 90.4, 92.8, 189.0, 198.4, 187.2, 196.5, 1.76, 1.96, 2.10, 163, 232, 108, 116, 11.8, 64.1],
  [50, 90.0, 92.7, 195.3, 204.9, 193.4, 202.9, 1.83, 1.96, 2.10, 163, 232, 108, 116, 12.2, 64.1],
  [51, 89.8, 92.4, 201.6, 211.4, 199.5, 209.3, 1.89, 1.96, 2.10, 163, 232, 108, 116, 12.6, 64.2],
  [52, 89.6, 92.2, 207.9, 217.8, 205.7, 215.6, 1.95, 1.96, 2.10, 163, 232, 108, 116, 13.0, 64.2],
  [53, 89.4, 91.9, 214.1, 224.3, 211.8, 221.9, 2.01, 1.96, 2.10, 163, 232, 108, 116, 13.4, 64.3],
  [54, 89.3, 91.7, 220.4, 230.7, 217.9, 228.2, 2.09, 1.96, 2.10, 163, 232, 108, 116, 13.8, 64.3],
  [55, 88.9, 91.5, 226.6, 237.1, 224.0, 234.4, 2.16, 1.96, 2.10, 163, 232, 108, 116, 14.2, 64.3],
  [56, 88.7, 91.4, 232.8, 243.5, 230.1, 240.7, 2.24, 1.96, 2.10, 163, 232, 108, 116, 14.5, 64.4],
  [57, 88.4, 91.2, 239.0, 249.9, 236.1, 246.9, 2.33, 1.96, 2.10, 163, 232, 108, 116, 14.9, 64.4],
  [58, 88.2, 91.0, 245.2, 256.3, 242.2, 253.2, 2.40, 1.96, 2.10, 163, 232, 108, 116, 15.3, 64.4],
  [59, 87.9, 90.8, 251.3, 262.6, 248.2, 259.4, 2.49, 1.96, 2.10, 163, 232, 108, 116, 15.7, 64.5],
  [60, 87.6, 90.5, 257.5, 269.0, 254.1, 265.5, 2.57, 1.96, 2.10, 163, 232, 108, 116, 16.1, 64.5],
  [61, 87.3, 90.2, 263.6, 275.3, 260.1, 271.7, 2.65, 1.96, 2.10, 163, 232, 108, 116, 16.5, 64.6],
  [62, 87.0, 90.0, 269.7, 281.6, 266.0, 277.8, 2.77, 1.96, 2.10, 163, 232, 108, 116, 16.9, 64.6],
  [63, 86.7, 89.8, 275.7, 287.9, 271.9, 283.9, 2.85, 1.96, 2.10, 163, 232, 108, 116, 17.3, 64.6],
  [64, 86.4, 89.6, 281.8, 294.1, 277.8, 290.0, 2.92, 1.96, 2.10, 163, 232, 108, 116, 17.7, 64.6],
  [65, 86.1, 89.3, 287.8, 300.4, 283.6, 296.1, 2.97, 1.96, 2.10, 163, 232, 108, 116, 18.1, 64.7],
  [66, 85.6, 89.0, 293.8, 306.6, 289.4, 302.1, 3.08, 1.96, 2.10, 163, 232, 108, 116, 18.4, 64.7],
  [67, 85.1, 88.6, 299.7, 312.8, 295.2, 308.1, 3.14, 1.96, 2.10, 163, 232, 108, 116, 18.8, 64.7],
  [68, 84.5, 88.3, 305.7, 319.0, 300.9, 314.1, 3.20, 1.96, 2.10, 163, 232, 108, 116, 19.2, 64.7],
  [69, 83.8, 88.0, 311.5, 325.2, 306.6, 320.1, 3.30, 1.96, 2.10, 163, 232, 108, 116, 19.6, 64.8],
  [70, 83.2, 87.6, 317.4, 331.3, 312.2, 326.0, 3.43, 1.96, 2.10, 163, 232, 108, 116, 20.0, 64.8],
  [71, 82.7, 87.0, 323.1, 337.4, 317.8, 331.9, 3.58, 1.96, 2.10, 163, 232, 108, 116, 20.3, 64.8],
  [72, 82.0, 86.4, 328.9, 343.4, 323.3, 337.7, 3.73, 1.96, 2.10, 163, 232, 108, 116, 20.7, 64.9],
  [73, 81.4, 85.8, 334.6, 349.4, 328.8, 343.5, 3.88, 1.96, 2.10, 163, 232, 108, 116, 21.1, 64.9],
  [74, 80.7, 85.2, 340.2, 355.4, 334.2, 349.2, 4.03, 1.96, 2.10, 163, 232, 108, 116, 21.4, 64.9],
  [75, 80.1, 84.6, 345.8, 361.3, 339.6, 354.9, 4.18, 1.96, 2.10, 163, 232, 108, 116, 21.8, 64.9],
  [76, 79.5, 84.0, 351.4, 367.2, 344.9, 360.5, 4.33, 1.96, 2.10, 163, 232, 108, 116, 22.1, 64.9],
  [77, 78.9, 83.4, 356.9, 373.1, 350.2, 366.1, 4.48, 1.96, 2.10, 163, 232, 108, 116, 22.5, 65.0],
  [78, 78.3, 82.8, 362.4, 378.8, 355.4, 371.6, 4.63, 1.96, 2.10, 163, 232, 108, 116, 22.8, 65.0],
  [79, 77.7, 82.2, 367.8, 384.6, 360.6, 377.1, 4.78, 1.96, 2.10, 163, 232, 108, 116, 23.2, 65.0],
  [80, 77.1, 81.6, 373.2, 390.3, 365.7, 382.5, 4.93, 1.96, 2.10, 163, 232, 108, 116, 23.5, 65.0],
  [81, 76.6, 81.0, 378.6, 396.0, 370.8, 387.9, 5.08, 1.96, 2.10, 163, 232, 108, 116, 23.9, 65.0],
  [82, 76.1, 80.4, 383.9, 401.6, 375.8, 393.2, 5.23, 1.96, 2.10, 163, 232, 108, 116, 24.2, 65.1],
  [83, 75.6, 79.8, 389.2, 407.2, 380.9, 398.5, 5.38, 1.96, 2.10, 163, 232, 108, 116, 24.5, 65.1],
  [84, 75.2, 79.2, 394.5, 412.7, 385.8, 403.7, 5.53, 1.96, 2.10, 163, 232, 108, 116, 24.9, 65.1],
  [85, 74.8, 78.6, 399.7, 418.2, 390.8, 408.9, 5.68, 1.96, 2.10, 163, 232, 108, 116, 25.2, 65.1],
  [86, 74.4, 78.0, 404.9, 423.7, 395.7, 414.1, 5.83, 1.96, 2.10, 163, 232, 108, 116, 25.5, 65.2],
  [87, 74.0, 77.4, 410.1, 429.1, 400.5, 419.2, 5.98, 1.96, 2.10, 163, 232, 108, 116, 25.9, 65.2],
  [88, 73.6, 76.8, 415.2, 434.5, 405.4, 424.2, 6.13, 1.96, 2.10, 163, 232, 108, 116, 26.2, 65.2],
  [89, 73.3, 76.3, 420.4, 439.8, 410.2, 429.2, 6.28, 1.96, 2.10, 163, 232, 108, 116, 26.5, 65.2],
  [90, 73.0, 75.8, 425.5, 445.2, 415.0, 434.2, 6.45, 1.96, 2.10, 163, 232, 108, 116, 26.8, 65.3],
  [91, 72.7, 75.3, 430.6, 450.4, 419.7, 439.1, 6.65, 1.96, 2.10, 163, 232, 108, 116, 27.1, 65.3],
  [92, 72.4, 74.9, 435.6, 455.7, 424.4, 444.0, 6.85, 1.96, 2.10, 163, 232, 108, 116, 27.4, 65.3],
  [93, 72.1, 74.5, 440.7, 460.9, 429.1, 448.8, 7.10, 1.96, 2.10, 163, 232, 108, 116, 27.8, 65.3],
  [94, 71.8, 74.1, 445.7, 466.1, 433.8, 453.6, 7.30, 1.96, 2.10, 163, 232, 108, 116, 28.1, 65.3],
  [95, 71.5, 73.7, 450.7, 471.2, 438.4, 458.4, 7.50, 1.96, 2.10, 163, 232, 108, 116, 28.4, 65.4],
  [96, 71.2, 73.3, 455.7, 476.4, 443.0, 463.2, 7.60, 1.96, 2.10, 163, 232, 108, 116, 28.7, 65.4],
  [97, 70.9, 72.9, 460.7, 481.5, 447.6, 467.9, 7.80, 1.96, 2.10, 163, 232, 108, 116, 29.0, 65.4],
  [98, 70.6, 72.5, 465.6, 486.5, 452.1, 472.5, 8.00, 1.96, 2.10, 163, 232, 108, 116, 29.3, 65.4],
  [99, 70.3, 72.1, 470.5, 491.6, 456.7, 477.2, 8.20, 1.96, 2.10, 163, 232, 108, 116, 29.6, 65.4],
  [100, 70.0, 71.7, 475.4, 496.6, 461.2, 481.8, 8.40, 1.96, 2.10, 163, 232, 108, 116, 29.9, 65.5],
];

// ── Egg quality (p.8): [week, Haugh units, breaking strength g, shell colour]
const EGG_QUALITY: number[][] = [
  [20, 97.8, 4605, 89], [22, 97.0, 4590, 89], [24, 96.0, 4580, 89], [26, 95.1, 4570, 88],
  [28, 94.2, 4560, 88], [30, 93.3, 4540, 88], [32, 92.2, 4515, 88], [34, 91.5, 4490, 88],
  [36, 90.6, 4450, 87], [38, 90.0, 4425, 87], [40, 89.3, 4405, 87], [42, 88.5, 4375, 87],
  [44, 87.8, 4355, 87], [46, 87.1, 4320, 87], [48, 86.4, 4305, 87], [50, 85.6, 4280, 86],
  [52, 85.0, 4250, 86], [54, 84.6, 4225, 86], [56, 84.0, 4190, 85], [58, 83.1, 4170, 85],
  [60, 82.6, 4150, 85], [62, 82.2, 4130, 84], [64, 81.9, 4110, 83], [66, 81.6, 4095, 83],
  [68, 81.5, 4085, 82], [70, 81.1, 4075, 81], [72, 81.0, 4065, 81], [74, 80.8, 4055, 80],
  [76, 80.5, 4040, 80], [78, 80.2, 4020, 80], [80, 80.1, 3995, 80], [82, 80.0, 3985, 79],
  [84, 79.9, 3975, 79], [86, 79.8, 3965, 79], [88, 79.7, 3960, 79], [90, 79.7, 3955, 79],
];

// ── Egg size distribution, E.U. weekly (p.8): [week, %S 43-53g, %M 53-63g, %L 63-73g, %XL >73g]
const EGG_SIZES: number[][] = [
  [18, 96.6, 3.4, 0.0, 0.0], [20, 63.5, 35.0, 1.5, 0.0], [22, 31.7, 64.4, 3.9, 0.0],
  [24, 12.0, 78.4, 8.8, 0.8], [26, 4.6, 78.1, 16.5, 0.8], [28, 2.0, 71.7, 25.4, 0.9],
  [30, 1.0, 64.4, 33.7, 0.9], [32, 0.6, 58.1, 40.3, 1.0], [34, 0.4, 53.3, 45.3, 1.0],
  [36, 0.3, 50.2, 48.5, 1.0], [38, 0.2, 47.8, 50.9, 1.1], [40, 0.2, 45.1, 53.6, 1.1],
  [42, 0.1, 43.0, 55.6, 1.2], [44, 0.1, 41.4, 57.3, 1.2], [46, 0.1, 40.1, 58.5, 1.3],
  [48, 0.1, 39.0, 59.6, 1.4], [50, 0.1, 38.1, 60.4, 1.4], [52, 0.1, 37.3, 61.1, 1.5],
  [54, 0.1, 36.7, 61.7, 1.5], [56, 0.1, 36.1, 62.3, 1.6], [58, 0.1, 35.5, 62.8, 1.6],
  [60, 0.1, 35.0, 63.2, 1.7], [62, 0.1, 34.6, 63.7, 1.7], [64, 0.1, 34.1, 64.1, 1.8],
  [66, 0.1, 33.6, 64.5, 1.8], [68, 0.1, 33.2, 64.9, 1.8], [70, 0.1, 32.7, 65.3, 1.9],
  [72, 0.1, 32.3, 65.7, 1.9], [74, 0.1, 31.9, 66.1, 2.0], [76, 0.1, 31.4, 66.5, 2.0],
  [78, 0.1, 31.0, 66.9, 2.0], [80, 0.1, 30.6, 67.3, 2.1], [82, 0.1, 30.2, 67.7, 2.1],
  [84, 0.1, 29.7, 68.1, 2.1], [86, 0.1, 29.3, 68.5, 2.1], [88, 0.1, 28.9, 68.9, 2.2],
  [90, 0.0, 28.5, 69.3, 2.2], [92, 0.0, 28.1, 69.6, 2.2], [94, 0.0, 27.7, 70.0, 2.2],
  [96, 0.0, 27.3, 70.4, 2.3], [98, 0.0, 26.9, 70.7, 2.3], [100, 0.0, 26.6, 71.1, 2.3],
];

// ── Brooding temperature & lighting (p.9), by DAY of age:
// [fromDay, toDay, cageMin, cageMax, floorMin, floorMax, luxMin, luxMax, lightText]
const BROODING: (number | string)[][] = [
  [0, 3, 33, 36, 35, 36, 30, 50, 'Intermittent program or 20 hours'],
  [4, 7, 30, 32, 33, 35, 30, 50, 'Intermittent program or 20 hours'],
  [8, 14, 28, 30, 31, 33, 25, 25, 'Intermittent program or 20 hours'],
  [15, 21, 26, 28, 29, 31, 25, 25, '18 hours'],
  [22, 28, 23, 26, 26, 27, 25, 25, '16.5 hours'],
  [29, 35, 21, 23, 23, 25, 10, 15, '15 hours'],
  [36, 42, 21, 21, 21, 21, 10, 15, '13.5 hours'],
];

// ── Light programmes (p.12): hours of light by week, weeks 1..24 (24+ = 16 h)
const LIGHT_CONTROLLED = [20, 18, 16, 14, 12, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 12, 12.5, 13, 13.5, 14, 14.5, 15, 15.5, 16];
const OPEN_SIDED       = [22, 20, 18, 16, 14, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 13, 13.5, 14, 14.5, 15, 15.5, 16];

// ── Rearing diet phases (p.13): change diet at the body weight shown.
// Feed-type mapping is the farm's feed names (LAYER_FEED_TYPES).
const REARING_PHASES: { phase: string; from: number; to: number; changeAtG: number; feeds: string }[] = [
  { phase: 'Starter 1', from: 1,  to: 3,  changeAtG: 205,  feeds: 'CHICK_CRUMBS,CHICK_MASH' },
  { phase: 'Starter 2', from: 4,  to: 6,  changeAtG: 495,  feeds: 'CHICK_MASH,CHICK_CRUMBS' },
  { phase: 'Grower',    from: 7,  to: 12, changeAtG: 1150, feeds: 'GROWER_MASH' },
  { phase: 'Developer', from: 13, to: 15, changeAtG: 1395, feeds: 'DEVELOPER_MASH' },
  { phase: 'Pre-Lay',   from: 16, to: 17, changeAtG: 1538, feeds: 'PRELAYER_MASH' },
];

// Rearing nutrient concentrations (p.13) — [label, unit, Starter1, Starter2, Grower, Developer, Pre-Lay]
const REARING_NUTRIENTS: [string, string, ...string[]][] = [
  ['Metabolizable energy', 'kcal/kg', '2900–3100', '2850–3050', '2800–3000', '2700–3000', '2750–3000'],
  ['Lysine (SID / total)', '%', '1.07 / 1.17', '0.92 / 1.00', '0.82 / 0.89', '0.60 / 0.66', '0.72 / 0.78'],
  ['Methionine (SID / total)', '%', '0.48 / 0.52', '0.42 / 0.45', '0.39 / 0.43', '0.28 / 0.30', '0.35 / 0.38'],
  ['Methionine+Cystine (SID / total)', '%', '0.82 / 0.91', '0.72 / 0.81', '0.66 / 0.74', '0.50 / 0.57', '0.62 / 0.70'],
  ['Threonine (SID / total)', '%', '0.69 / 0.82', '0.60 / 0.70', '0.55 / 0.64', '0.41 / 0.49', '0.50 / 0.58'],
  ['Tryptophan (SID / total)', '%', '0.19 / 0.22', '0.17 / 0.20', '0.17 / 0.20', '0.13 / 0.16', '0.16 / 0.20'],
  ['Arginine (SID / total)', '%', '1.11 / 1.20', '0.96 / 1.03', '0.85 / 0.91', '0.63 / 0.68', '0.75 / 0.81'],
  ['Isoleucine (SID / total)', '%', '0.75 / 0.80', '0.66 / 0.71', '0.61 / 0.66', '0.45 / 0.48', '0.56 / 0.61'],
  ['Valine (SID / total)', '%', '0.77 / 0.84', '0.68 / 0.75', '0.64 / 0.70', '0.48 / 0.53', '0.61 / 0.67'],
  ['Crude protein', '%', '20.00', '18.00', '17.00', '15.50', '16.50'],
  ['Calcium', '%', '1.05', '1.00', '0.95', '0.90', '2.50'],
  ['Phosphorus (available)', '%', '0.45', '0.44', '0.43', '0.38', '0.42'],
  ['Phosphorus (digestible)', '%', '0.41', '0.40', '0.39', '0.34', '0.38'],
  ['Sodium', '%', '0.18', '0.18', '0.18', '0.18', '0.18'],
  ['Chloride', '%', '0.18', '0.18', '0.18', '0.18', '0.18'],
  ['Linoleic acid (C18:2 n-6)', '%', '1.20', '1.20', '1.20', '1.20', '1.20'],
  ['Choline', 'mg/kg', '2000', '1800', '1800', '1500', '1800'],
];

// Laying daily nutrient intake (pp.14 & 16) — [label, unit, Peaking, Layer 2, Layer 3, Layer 4, Layer 5]
const LAYING_DAILY: Record<'ECONOMICAL' | 'OPTIMAL', [string, string, ...string[]][]> = {
  ECONOMICAL: [
    ['Metabolizable energy', 'kcal/bird/day', '315–330', '310–325', '305–320', '300–315', '300–315'],
    ['Lysine (SID / total)', 'mg/day', '830 / 909', '810 / 887', '780 / 854', '745 / 816', '700 / 766'],
    ['Methionine (SID / total)', 'mg/day', '415 / 446', '405 / 435', '390 / 419', '373 / 401', '350 / 376'],
    ['Methionine+Cystine (SID / total)', 'mg/day', '747 / 842', '729 / 822', '702 / 792', '671 / 756', '630 / 711'],
    ['Threonine (SID / total)', 'mg/day', '581 / 684', '567 / 667', '546 / 642', '522 / 614', '490 / 576'],
    ['Tryptophan (SID / total)', 'mg/day', '178 / 213', '174 / 208', '168 / 200', '160 / 191', '151 / 180'],
    ['Arginine (SID / total)', 'mg/day', '863 / 928', '842 / 906', '811 / 872', '775 / 833', '728 / 783'],
    ['Isoleucine (SID / total)', 'mg/day', '664 / 714', '648 / 697', '624 / 671', '596 / 641', '560 / 602'],
    ['Valine (SID / total)', 'mg/day', '730 / 806', '713 / 786', '686 / 757', '656 / 723', '616 / 679'],
    ['Crude protein', 'g/day', '17.80', '17.60', '16.70', '16.30', '15.50'],
    ['Sodium', 'mg/day', '180', '170', '170', '170', '170'],
    ['Chloride', 'mg/day', '180', '170', '170', '170', '170'],
    ['Linoleic acid (C18:2 n-6)', 'g/day', '1.60', '1.50', '1.40', '1.40', '1.40'],
    ['Choline', 'mg/day', '180', '180', '180', '180', '180'],
  ],
  OPTIMAL: [
    ['Metabolizable energy', 'kcal/bird/day', '315–330', '310–325', '305–320', '300–315', '300–315'],
    ['Lysine (SID / total)', 'mg/day', '870 / 953', '845 / 925', '820 / 898', '795 / 870', '770 / 843'],
    ['Methionine (SID / total)', 'mg/day', '435 / 468', '423 / 454', '410 / 441', '398 / 427', '385 / 414'],
    ['Methionine+Cystine (SID / total)', 'mg/day', '800 / 903', '769 / 867', '738 / 832', '716 / 807', '693 / 782'],
    ['Threonine (SID / total)', 'mg/day', '609 / 716', '592 / 696', '574 / 675', '557 / 655', '539 / 634'],
    ['Tryptophan (SID / total)', 'mg/day', '191 / 229', '186 / 222', '180 / 216', '175 / 209', '169 / 202'],
    ['Arginine (SID / total)', 'mg/day', '905 / 973', '879 / 945', '853 / 917', '827 / 889', '801 / 861'],
    ['Isoleucine (SID / total)', 'mg/day', '713 / 767', '684 / 736', '656 / 705', '636 / 684', '616 / 662'],
    ['Valine (SID / total)', 'mg/day', '783 / 864', '752 / 829', '722 / 796', '700 / 772', '678 / 747'],
    ['Crude protein', 'g/day', '18.25', '17.85', '17.42', '16.30', '15.50'],
    ['Sodium', 'mg/day', '180', '170', '170', '170', '170'],
    ['Chloride', 'mg/day', '180', '170', '170', '170', '170'],
    ['Linoleic acid (C18:2 n-6)', 'g/day', '2.00', '2.00', '1.60', '1.50', '1.40'],
    ['Choline', 'mg/day', '160', '180', '180', '180', '180'],
  ],
};
const LAYING_PHASES = ['Peaking', 'Layer 2', 'Layer 3', 'Layer 4', 'Layer 5'];

// Laying phases by hen-day % (pp.14 & 16): [phase, minHd, maxHd, text]
const NUTRITION_PHASES: Record<'ECONOMICAL' | 'OPTIMAL', [string, number | null, number | null, string][]> = {
  ECONOMICAL: [
    ['Peaking', null, null, 'First egg until production drops 2% below peak'],
    ['Layer 2', 92, null, '2% below peak to 92% HD'],
    ['Layer 3', 88, 91, '91–88% HD'],
    ['Layer 4', 83, 87, '87–83% HD'],
    ['Layer 5', null, 83, 'Less than 83% HD'],
  ],
  OPTIMAL: [
    ['Peaking', null, null, 'First egg until production drops 2% below peak'],
    ['Layer 2', 91, null, '2% below peak to 91% HD'],
    ['Layer 3', 87, 90, '90–87% HD'],
    ['Layer 4', 82, 86, '86–82% HD'],
    ['Layer 5', null, 82, 'Less than 82% HD'],
  ],
};

// Calcium & phosphorus daily intake (pp.14 & 16 — same in both programmes):
// [fromWeek, toWeek, Ca g/day, avP mg/day, digP mg/day, particle fine:coarse]
const CA_P: (number | string)[][] = [
  [18, 33, 4.00, 432, 389, '40% : 60%'],
  [34, 48, 4.20, 405, 366, '35% : 65%'],
  [49, 62, 4.40, 373, 337, '30% : 70%'],
  [63, 76, 4.60, 347, 314, '25% : 75%'],
  [77, 100, 4.70, 324, 291, '25% : 75%'],
];

// Vitamins & trace minerals per 1000 kg complete diet (p.18): [item, rearing, production]
const VITAMINS: [string, string, string][] = [
  ['Vitamin A, IU', '10,000,000', '8,000,000'], ['Vitamin D3, IU', '3,300,000', '3,300,000'],
  ['Vitamin E, g', '30.00', '25.00'], ['Vitamin K (menadione), g', '3.50', '3.00'],
  ['Thiamin (B1), g', '2.20', '2.50'], ['Riboflavin (B2), g', '6.60', '5.50'],
  ['Niacin (B3), g', '40.00', '30.00'], ['Pantothenic acid (B5), g', '10.00', '10.00'],
  ['Pyridoxine (B6), g', '4.50', '5.00'], ['Biotin (B7), mg', '100.00', '75.00'],
  ['Folic acid (B9), g', '1.00', '0.90'], ['Cobalamine (B12), mg', '23.00', '23.00'],
  ['Manganese, g', '100.00', '100.00'], ['Zinc, g', '85.00', '80.00'], ['Iron, g', '30.00', '40.00'],
  ['Copper, g', '15.00', '8.00'], ['Magnesium, g', '600.00', '500.00'], ['Iodine, g', '1.50', '1.20'],
  ['Selenium, g', '0.25', '0.25'],
];

// Drinking water quality maxima (p.19): [item, max, unit, note]
const WATER_QUALITY: [string, number | null, string, string][] = [
  ['Nitrate NO3-', 25, 'mg/L', 'Older birds tolerate up to 20 ppm; stressed/diseased birds more sensitive.'],
  ['Nitrate nitrogen (NO3-N)', 6, 'mg/L', ''],
  ['Nitrite NO2-', 4, 'mg/L', 'Far more toxic than nitrate, especially for young birds (1 ppm may be toxic).'],
  ['Nitrite nitrogen (NO2-N)', 1, 'mg/L', ''],
  ['Total dissolved solids', 1000, 'mg/L', 'Up to 3000 ppm may not affect performance but increases manure moisture.'],
  ['Chloride (Cl-)', 250, 'mg/L', 'As low as 14 mg may be a problem if sodium > 50 ppm.'],
  ['Sulphate (SO4-)', 250, 'mg/L', 'Higher levels may be laxative.'],
  ['Iron (Fe)', 0.3, 'mg/L', 'Higher levels: bad odour and taste.'],
  ['Magnesium (Mg)', 125, 'mg/L', 'Laxative; >50 ppm a problem if sulphate is high.'],
  ['Potassium (K)', 20, 'mg/L', 'Higher may be fine depending on sodium, alkalinity, pH.'],
  ['Sodium (Na)', 50, 'mg/L', 'Avoid >50 ppm if chloride, sulphate or potassium are high.'],
  ['Manganese (Mn)', 0.05, 'mg/L', 'Higher levels may be laxative.'],
  ['Arsenic (As)', 0.5, 'mg/L', ''], ['Fluoride (F-)', 2, 'mg/L', ''], ['Aluminium (Al)', 5, 'mg/L', ''],
  ['Boron (B)', 5, 'mg/L', ''], ['Cadmium (Cd)', 0.02, 'mg/L', ''], ['Cobalt (Co)', 1, 'mg/L', ''],
  ['Copper (Cu)', 0.6, 'mg/L', 'Higher levels: bitter taste.'], ['Lead (Pb)', 0.02, 'mg/L', 'Toxic above.'],
  ['Mercury (Hg)', 0.003, 'mg/L', 'Toxic above.'], ['Zinc (Zn)', 1.5, 'mg/L', 'Toxic above.'],
  ['Total bacteria count', 1000, 'CFU/ml', 'Likely dirty water.'], ['Total coliform bacteria', 50, 'CFU/ml', ''],
  ['Faecal coliform bacteria', 0, 'CFU/ml', ''],
];

function build(): GuidePointInput[] {
  const p: GuidePointInput[] = [];
  const add = (x: GuidePointInput) => p.push({ ageUnit: 'WEEK', ...x, ageTo: x.ageTo ?? x.ageFrom });

  for (const [w, mort, bwMin, bwMax, waMin, waMax, fMin, fMax, cfMin, cfMax, uni] of HYLINE_BROWN_REARING) {
    add({ metric: 'MORTALITY_CUM_REARING', ageFrom: w, max: mort, unit: '%' });
    add({ metric: 'BODY_WEIGHT', ageFrom: w, min: bwMin, max: bwMax, unit: 'g' });
    add({ metric: 'WATER_INTAKE', ageFrom: w, min: waMin, max: waMax, unit: 'ml/bird/day' });
    add({ metric: 'FEED_INTAKE', ageFrom: w, min: fMin, max: fMax, unit: 'g/bird/day' });
    add({ metric: 'FEED_CUM_REARING', ageFrom: w, min: cfMin, max: cfMax, unit: 'g/bird' });
    add({ metric: 'UNIFORMITY', ageFrom: w, min: uni, unit: '%' });
  }

  for (const r of HYLINE_BROWN_PRODUCTION) {
    const [w, hdMin, hdMax, hdeMin, hdeMax, hheMin, hheMax, mort, bwMin, bwMax, waMin, waMax, fMin, fMax, mass, eggWt] = r as number[];
    add({ metric: 'HEN_DAY_PCT', ageFrom: w, min: hdMin, max: hdMax, unit: '%' });
    add({ metric: 'HD_EGGS_CUM', ageFrom: w, min: hdeMin, max: hdeMax, unit: 'eggs/hen' });
    add({ metric: 'HH_EGGS_CUM', ageFrom: w, min: hheMin, max: hheMax, unit: 'eggs/hen housed' });
    add({ metric: 'MORTALITY_CUM_LAY', ageFrom: w, max: mort, unit: '%' });
    add({ metric: 'BODY_WEIGHT', ageFrom: w, min: Math.round(bwMin * 1000), max: Math.round(bwMax * 1000), unit: 'g' });
    add({ metric: 'WATER_INTAKE', ageFrom: w, min: waMin, max: waMax, unit: 'ml/bird/day' });
    add({ metric: 'FEED_INTAKE', ageFrom: w, min: fMin, max: fMax, unit: 'g/bird/day' });
    if (mass != null) add({ metric: 'EGG_MASS_CUM', ageFrom: w, target: mass, unit: 'kg' });
    add({ metric: 'EGG_WEIGHT', ageFrom: w, target: eggWt, unit: 'g/egg' });
  }

  for (const [w, hu, bs, sc] of EGG_QUALITY) {
    add({ metric: 'HAUGH_UNITS', ageFrom: w, ageTo: w + 1, target: hu, unit: 'HU' });
    add({ metric: 'BREAKING_STRENGTH', ageFrom: w, ageTo: w + 1, target: bs, unit: 'g force' });
    add({ metric: 'SHELL_COLOR', ageFrom: w, ageTo: w + 1, target: sc, unit: 'score' });
  }
  const sizeVariants = ['SMALL', 'MEDIUM', 'LARGE', 'EXTRA_LARGE'];
  const sizeLabels = ['Small 43–53 g', 'Medium 53–63 g', 'Large 63–73 g', 'Extra large >73 g'];
  for (const [w, ...pcts] of EGG_SIZES) {
    pcts.forEach((v, i) => add({
      metric: 'EGG_SIZE_DISTRIBUTION', variant: sizeVariants[i], label: sizeLabels[i],
      ageFrom: w, ageTo: w + 1, target: v, unit: '%',
    }));
  }

  for (const [from, to, cMin, cMax, fMin, fMax, lMin, lMax, light] of BROODING) {
    const d = { ageUnit: 'DAY' as const, ageFrom: from as number, ageTo: to as number };
    p.push({ ...d, metric: 'BROODING_TEMP', variant: 'CAGE', min: cMin as number, max: cMax as number, unit: '°C' });
    p.push({ ...d, metric: 'BROODING_TEMP', variant: 'FLOOR', min: fMin as number, max: fMax as number, unit: '°C' });
    p.push({ ...d, metric: 'LIGHT_INTENSITY', min: lMin as number, max: lMax as number, unit: 'lux' });
    p.push({ ...d, metric: 'LIGHT_HOURS', variant: 'BROODING', text: light as string, unit: 'h' });
  }
  LIGHT_CONTROLLED.forEach((h, i) => add({ metric: 'LIGHT_HOURS', variant: 'LIGHT_CONTROLLED', ageFrom: i + 1, target: h, unit: 'h' }));
  OPEN_SIDED.forEach((h, i) => add({ metric: 'LIGHT_HOURS', variant: 'OPEN_SIDED', ageFrom: i + 1, target: h, unit: 'h' }));
  add({ metric: 'GUIDE_NOTE', ageFrom: 1, ageTo: 2, label: 'Intermittent lighting for chicks', text: 'Preferred for days 0–7 (up to 14): 4 h light / 2 h dark repeated. Synchronises feeding, may improve 7-day livability and body weight.' });
  add({ metric: 'GUIDE_NOTE', ageFrom: 16, ageTo: 24, label: 'Light stimulation', text: 'Increase light in 30-minute steps until 16 hours; start stimulation only at 1.35 kg body weight and 85% uniformity.' });

  // Ideal body condition score (p.10 body score chart, 0–6 scale)
  add({ metric: 'BODY_CONDITION_SCORE', ageFrom: 1, ageTo: 11, min: 1, max: 2, unit: 'score', text: 'Breast flesh concave to pyramid' });
  add({ metric: 'BODY_CONDITION_SCORE', ageFrom: 12, ageTo: 17, min: 3, max: 4, unit: 'score', text: 'Well fleshed, convex breast; abdominal fat starting' });
  add({ metric: 'BODY_CONDITION_SCORE', ageFrom: 18, ageTo: 100, min: 4, max: 5, unit: 'score', text: 'Convex breast; abdominal fat pad up to/over 0.7 cm' });

  // Rules
  add({ metric: 'TRANSFER_AGE', ageFrom: 15, ageTo: 16, min: 15, target: 15, max: 16, unit: 'weeks', text: 'Transfer to the laying house at 15 weeks; light stimulation from 16 weeks. Expect 10–12% body-weight loss at transfer.' });
  add({ metric: 'LIGHT_STIM_BODY_WEIGHT', ageFrom: 16, ageTo: 24, min: 1350, unit: 'g' });
  add({ metric: 'LIGHT_STIM_UNIFORMITY', ageFrom: 16, ageTo: 24, min: 85, unit: '%' });
  add({ metric: 'PRELAY_EARLIEST_WEEK', ageFrom: 15, ageTo: 17, min: 15, unit: 'week', text: 'Do not feed Pre-Lay earlier than 15 weeks or later than first egg (too little calcium for shell).' });
  add({ metric: 'DAYS_TO_50_PCT', ageFrom: 18, ageTo: 30, target: 144, max: 144, unit: 'days' });
  add({ metric: 'PEAK_HDP', ageFrom: 35, ageTo: 35, min: 94.8, max: 96.6, unit: '%' });
  add({ metric: 'FCR_CUM', ageFrom: 60, ageTo: 60, min: 1.90, max: 2.06, unit: 'kg/kg', text: '20–60 weeks' });
  add({ metric: 'FCR_CUM', ageFrom: 72, ageTo: 72, min: 1.91, max: 2.08, unit: 'kg/kg', text: '20–72 weeks' });
  add({ metric: 'FCR_CUM', ageFrom: 90, ageTo: 90, min: 1.98, max: 2.15, unit: 'kg/kg', text: '20–90 weeks' });

  // Feed phases (rearing by body weight; laying by %HD)
  for (const ph of REARING_PHASES) {
    add({ metric: 'FEED_PHASE', ageFrom: ph.from, ageTo: ph.to, phase: ph.phase, label: ph.phase, target: ph.changeAtG, unit: 'g', text: ph.feeds });
  }
  add({ metric: 'FEED_PHASE', ageFrom: 18, ageTo: 100, phase: 'Laying', label: 'Peaking → Layer 5 (by %HD)', text: 'LAYER_MASH' });

  // Nutrition (reference)
  REARING_PHASES.forEach((ph, i) => {
    for (const [label, unit, ...vals] of REARING_NUTRIENTS) {
      add({ metric: 'NUTRIENT_REARING', ageFrom: ph.from, ageTo: ph.to, phase: ph.phase, label, unit, text: vals[i] });
    }
  });
  for (const program of ['ECONOMICAL', 'OPTIMAL'] as const) {
    LAYING_PHASES.forEach((phase, i) => {
      for (const [label, unit, ...vals] of LAYING_DAILY[program]) {
        add({ metric: 'NUTRIENT_DAILY', variant: program, ageFrom: 18, ageTo: 100, phase, label, unit, text: vals[i] });
      }
    });
    for (const [phase, minHd, maxHd, text] of NUTRITION_PHASES[program]) {
      add({ metric: 'NUTRITION_PHASE', variant: program, ageFrom: 18, ageTo: 100, phase, label: phase, min: minHd, max: maxHd, unit: '%', text });
    }
  }
  for (const [from, to, ca, avP, digP, particle] of CA_P) {
    const range = { ageFrom: from as number, ageTo: to as number };
    add({ ...range, metric: 'CALCIUM_PHOSPHORUS', label: 'Calcium', target: ca as number, unit: 'g/day' });
    add({ ...range, metric: 'CALCIUM_PHOSPHORUS', label: 'Phosphorus (available)', target: avP as number, unit: 'mg/day' });
    add({ ...range, metric: 'CALCIUM_PHOSPHORUS', label: 'Phosphorus (digestible)', target: digP as number, unit: 'mg/day' });
    add({ ...range, metric: 'CALCIUM_PHOSPHORUS', label: 'Calcium particle size (fine : coarse)', text: particle as string });
  }
  // Numeric nutrient targets for comparison with Store's feed lab tests —
  // derived from the same tables above. Amino acids use the guide's TOTAL
  // figure (labs report total amino acids).
  REARING_PHASES.forEach((ph, i) => {
    for (const [label, , ...vals] of REARING_NUTRIENTS) {
      const key = nutrientKeyFromLabel(label);
      const v = parseGuideNutrient(vals[i]);
      if (!key || !v) continue;
      add({ metric: `DIET_${key}`, ageFrom: ph.from, ageTo: ph.to, phase: ph.phase, ...v, unit: NUTRIENT_BY_KEY.get(key)!.concUnit });
    }
  });
  for (const program of ['ECONOMICAL', 'OPTIMAL'] as const) {
    LAYING_PHASES.forEach((phase, i) => {
      for (const [label, , ...vals] of LAYING_DAILY[program]) {
        const key = nutrientKeyFromLabel(label);
        const v = parseGuideNutrient(vals[i]);
        if (!key || !v) continue;
        add({ metric: `INTAKE_${key}`, variant: program, ageFrom: 18, ageTo: 100, phase, ...v, unit: NUTRIENT_BY_KEY.get(key)!.intakeUnit });
      }
    });
  }
  // Calcium & available phosphorus intake go by age (same in both programmes).
  for (const [from, to, ca, avP] of CA_P) {
    add({ metric: 'INTAKE_CALCIUM', ageFrom: from as number, ageTo: to as number, target: ca as number, unit: 'g/day' });
    add({ metric: 'INTAKE_AV_PHOSPHORUS', ageFrom: from as number, ageTo: to as number, target: avP as number, unit: 'mg/day' });
  }
  add({ metric: 'GUIDE_NOTE', ageFrom: 18, ageTo: 100, label: 'Energy vs temperature', text: 'For each 0.5 °C above or below 22 °C, subtract or add about 2 kcal/bird/day of energy.' });
  for (const [item, rearing, production] of VITAMINS) {
    add({ metric: 'VITAMINS_MINERALS', variant: 'REARING', ageFrom: 1, ageTo: 17, label: item, text: rearing, unit: 'per 1000 kg' });
    add({ metric: 'VITAMINS_MINERALS', variant: 'PRODUCTION', ageFrom: 18, ageTo: 100, label: item, text: production, unit: 'per 1000 kg' });
  }
  for (const [item, max, unit, note] of WATER_QUALITY) {
    add({ metric: 'WATER_QUALITY', ageFrom: 1, ageTo: 100, label: item, max, unit, text: note || null });
  }
  add({ metric: 'WATER_QUALITY', ageFrom: 1, ageTo: 100, label: 'pH', min: 5, max: 7, unit: 'pH', text: 'Below 5 may reduce intake and corrode fittings; above 8 reduces intake and sanitation.' });
  add({ metric: 'WATER_QUALITY', ageFrom: 1, ageTo: 100, label: 'Oxygen reduction potential', min: 650, max: 750, unit: 'mV', text: 'Range at which 2–4 ppm free chlorine sanitises effectively (pH 5–7).' });

  // Space (conventional & colony cages)
  add({ metric: 'SPACE', variant: 'FLOOR', ageFrom: 1, ageTo: 3, min: 100, max: 200, unit: 'cm²/bird', label: 'Floor space (50–100 birds/m²)' });
  add({ metric: 'SPACE', variant: 'FLOOR', ageFrom: 4, ageTo: 17, target: 310, unit: 'cm²/bird', label: 'Floor space (32 birds/m²)' });
  add({ metric: 'SPACE', variant: 'FLOOR', ageFrom: 18, ageTo: 100, min: 490, max: 750, unit: 'cm²/bird', label: 'Floor space (20–13 birds/m²)' });
  add({ metric: 'SPACE', variant: 'DRINKER', ageFrom: 1, ageTo: 3, target: 12, unit: 'birds/nipple', label: '1 nipple/cup per 12 birds' });
  add({ metric: 'SPACE', variant: 'DRINKER', ageFrom: 4, ageTo: 17, target: 8, unit: 'birds/nipple', label: '1 nipple/cup per 8 birds' });
  add({ metric: 'SPACE', variant: 'DRINKER', ageFrom: 18, ageTo: 100, target: 12, unit: 'birds/nipple', label: '1 per 12 birds or access to 2 drinkers' });
  add({ metric: 'SPACE', variant: 'FEEDER', ageFrom: 1, ageTo: 3, target: 5, unit: 'cm/bird', label: 'Feeder 5 cm/bird' });
  add({ metric: 'SPACE', variant: 'FEEDER', ageFrom: 4, ageTo: 17, target: 8, unit: 'cm/bird', label: 'Feeder 8 cm/bird' });
  add({ metric: 'SPACE', variant: 'FEEDER', ageFrom: 18, ageTo: 100, min: 7, max: 12, unit: 'cm/bird', label: 'Feeder 7–12 cm/bird' });

  return p;
}

export const HYLINE_BROWN_2024: GuideSeed = {
  breed: {
    code: 'HYLINE_BROWN',
    name: 'Hy-Line Brown',
    birdType: 'LAYER_COMMERCIAL',
    // Normalised (lower-case, letters/digits only) and matched as a
    // substring of the batch's breed/strain text — "Hy-Line", "hyline brown",
    // "Hyline Brown Max" all resolve here. All Hy-Line varieties share this
    // guide until a variety-specific guide is uploaded.
    aliases: ['hyline', 'hiline', 'hylinebrown', 'hylinebrownmax'],
  },
  guide: {
    title: 'Hy-Line Brown Commercial Layers — Conventional Systems Performance Guide',
    versionLabel: 'January 2024',
    versionYear: 2024,
    publisher: 'Hy-Line International',
    housingSystem: 'Conventional / colony cages',
    variety: null,
    sourceFileName: 'Hyline_notes.pdf (BRN CONV STD ENG 011525)',
  },
  points: build(),
};
