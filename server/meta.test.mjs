/**
 * Tests für die Meta-Normalisierung (Account-Format, Position-Label) und das
 * Zusammenspiel mit aggregateFb. Ausführen: node server/meta.test.mjs
 */
import assert from 'node:assert/strict';
import { _internal } from './meta.js';
import { aggregateFb } from './supermetrics.js';

const { normAccount, positionLabel } = _internal;

assert.equal(normAccount('367913946654819'), 'act_367913946654819', 'act_ wird ergänzt');
assert.equal(normAccount('act_367913946654819'), 'act_367913946654819', 'act_ bleibt erhalten');
assert.equal(positionLabel('instagram_stories'), 'instagram stories');
assert.equal(positionLabel(''), '');

// Simuliere zwei Meta-Insights-Zeilen (eine Ad, zwei Placements)
const records = [
  { campaign: 'J&P | MMV', adset: 'LP 2 | Broad', creative: 'Static 19', platform: 'facebook', placement: 'feed', spend: 100, impressions: 5000, clicks: 120, reach: 4000 },
  { campaign: 'J&P | MMV', adset: 'LP 2 | Broad', creative: 'Static 19', platform: 'instagram', placement: 'reels', spend: 50, impressions: 3000, clicks: 60, reach: 2500 },
];

const agg = aggregateFb(records);
assert.equal(agg.totals.spend, 150, 'Spend summiert');
assert.equal(agg.totals.impressions, 8000);
assert.equal(agg.byDim.creative['static 19'].spend, 150, 'Spend je Creative über beide Placements');
assert.ok(agg.byDim.placement['facebook feed'], 'Placement facebook feed');
assert.ok(agg.byDim.placement['instagram reels'], 'Placement instagram reels');

console.log('✓ Alle Meta-Tests bestanden');
console.log('  Gesamt-Spend:', agg.totals.spend, '€ | Placements:', Object.keys(agg.byDim.placement).join(', '));
