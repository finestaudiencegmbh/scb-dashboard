/**
 * Tests für die Meta-Normalisierung (Account-Format, Position-Label) und das
 * Zusammenspiel mit aggregateFb. Ausführen: node server/meta.test.mjs
 */
import assert from 'node:assert/strict';
import { _internal, accountTargets } from './meta.js';
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

// --- Mehrere Werbekonten mit eigenem Token (_2, _3 …) ---------------------
assert.deepEqual(
  accountTargets({ META_ACCESS_TOKEN: 'T1', META_AD_ACCOUNT_ID: 'act_1, 2', META_ACCESS_TOKEN_2: 'T2', META_AD_ACCOUNT_ID_2: '3' }),
  [{ account: 'act_1', token: 'T1' }, { account: 'act_2', token: 'T1' }, { account: 'act_3', token: 'T2' }],
  'Konto aus _2 läuft mit Token _2, die Hauptkonten mit dem Haupt-Token'
);
assert.deepEqual(
  accountTargets({ META_ACCESS_TOKEN: 'T1', META_AD_ACCOUNT_ID: 'act_1', META_AD_ACCOUNT_ID_3: 'act_9' }),
  [{ account: 'act_1', token: 'T1' }, { account: 'act_9', token: 'T1' }],
  'Paar ohne eigenes Token nutzt META_ACCESS_TOKEN'
);
assert.deepEqual(
  accountTargets({ META_ACCESS_TOKEN: 'T1', META_AD_ACCOUNT_ID: 'act_1', META_ACCESS_TOKEN_2: 'T2', META_AD_ACCOUNT_ID_2: 'act_1' }),
  [{ account: 'act_1', token: 'T1' }],
  'doppelt eingetragenes Konto nur einmal'
);
assert.deepEqual(accountTargets({ META_AD_ACCOUNT_ID: 'act_1' }), [], 'ohne Token kein Konto');
assert.deepEqual(
  accountTargets({ META_ACCESS_TOKEN_2: 'T2', META_AD_ACCOUNT_ID_2: 'act_5' }),
  [{ account: 'act_5', token: 'T2' }],
  'nur das _2-Paar gesetzt reicht'
);

console.log('✓ Alle Meta-Tests bestanden');
console.log('  Gesamt-Spend:', agg.totals.spend, '€ | Placements:', Object.keys(agg.byDim.placement).join(', '));
