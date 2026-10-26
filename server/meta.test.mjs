/**
 * Tests für die Meta-Normalisierung (Account-Format, Position-Label) und das
 * Zusammenspiel mit aggregateFb. Ausführen: node server/meta.test.mjs
 */
import assert from 'node:assert/strict';
import { _internal, accountTargets } from './meta.js';
import { aggregateFb } from './supermetrics.js';

const { normAccount, positionLabel, mergeStatus, fetchAdUrls, urlCache } = _internal;

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

// Gleichnamiger Status aus zwei Konten: aktiv gewinnt, egal in welcher Reihenfolge
assert.equal(mergeStatus(mergeStatus({}, { K: { active: true } }), { K: { active: false } }).K.active, true, 'aktiv bleibt');
assert.equal(mergeStatus(mergeStatus({}, { K: { active: false } }), { K: { active: true } }).K.active, true, 'aktiv überschreibt pausiert');

// --- Landingpages: Ad-Filter mit Paket-Halbierung, sonst einzeln -----------
{
  const realFetch = globalThis.fetch;
  const creative = (id) => ({ object_story_spec: { video_data: { call_to_action: { value: { link: `https://secretbusiness.live/v4?ad=${id}` } } } } });
  const c = { version: 'v26.0', token: 'T', account: 'act_1' };
  const ids = Array.from({ length: 60 }, (_, i) => String(1000 + i));
  const ok = (body) => ({ status: 200, json: async () => body });
  try {
    // Fall 1: Filter wird akzeptiert, große Pakete sind Meta "zu viel" (Code 1)
    const sizes = [];
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      assert.ok(!u.searchParams.has('ids'), 'kein ?ids= (ab v26 abgeschaltet)');
      const chunk = JSON.parse(u.searchParams.get('filtering'))[0].value;
      sizes.push(chunk.length);
      if (chunk.length > 20) return ok({ error: { message: "Please reduce the amount of data you're asking for", code: 1 } });
      return ok({ data: chunk.map((id) => ({ id, creative: creative(id) })) });
    };
    urlCache.clear();
    const urls = await fetchAdUrls(c, ids);
    assert.equal(urls.size, 60, 'alle 60 Anzeigen aufgelöst');
    assert.deepEqual(urls.get('1000'), ['https://secretbusiness.live/v4?ad=1000']);
    assert.equal(sizes[0], 50, 'erst 50er-Paket');
    assert.ok(sizes.slice(1).every((n) => n <= 25), 'nach Code 1 kleinere Pakete');
    const before = sizes.length;
    await fetchAdUrls(c, ids);
    assert.equal(sizes.length, before, 'zweiter Abruf kommt komplett aus dem Zwischenspeicher');

    // Fall 2: Meta lehnt den Filter ab (Code 100) -> jede Anzeige einzeln
    const single = [];
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.searchParams.has('filtering')) return ok({ error: { message: 'Filtering field id is invalid', code: 100 } });
      const id = u.pathname.split('/').pop();
      single.push(id);
      return ok({ id, creative: creative(id) });
    };
    urlCache.clear();
    const urls2 = await fetchAdUrls(c, ids.slice(0, 8));
    assert.equal(single.length, 8, 'Fallback: 8 Einzelabrufe');
    assert.deepEqual(urls2.get('1007'), ['https://secretbusiness.live/v4?ad=1007']);
  } finally {
    globalThis.fetch = realFetch;
    urlCache.clear();
  }
}

console.log('✓ Alle Meta-Tests bestanden');
console.log('  Gesamt-Spend:', agg.totals.spend, '€ | Placements:', Object.keys(agg.byDim.placement).join(', '));
