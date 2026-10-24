/**
 * Projekt-Bereich: Nur Kampagnen, deren Anzeigen auf die Webinar-LP verlinken,
 * zählen in Adspend, CPL und Graphen. VSL-Kampagnen derselben Konten fallen
 * heraus, bleiben aber als "ausgeschlossen" sichtbar.
 * Ausführen: node server/scope.test.mjs
 */
import assert from 'node:assert/strict';
import { applyScope } from './scope.js';
import { collectUrls } from './meta.js';
import { combineByAccount } from './accounts.js';

// --- URL-Erkennung in den verschiedenen Creative-Formen von Meta -------------
assert.deepEqual(collectUrls({ object_story_spec: { video_data: { image_url: 'https://scontent.fbcdn.net/x.jpg', call_to_action: { value: { link: 'https://secretbusiness.live/v4' } } } } }),
  ['https://secretbusiness.live/v4'], 'Video-Anzeige: Link im Call-to-Action, Bild-URL von Facebook ignoriert');
assert.deepEqual(collectUrls({ object_story_spec: { link_data: { link: 'https://secretcreators.de/videotraining/' } } }),
  ['https://secretcreators.de/videotraining/'], 'Link-Anzeige');
assert.deepEqual(collectUrls({ asset_feed_spec: { link_urls: [{ website_url: 'https://secretbusiness.live/v7?x=1' }] } }),
  ['https://secretbusiness.live/v7?x=1'], 'Dynamic Creative');
assert.deepEqual(collectUrls(null), []);

// --- Zwei Konten, je Webinar- und VSL-Kampagne -------------------------------
const WEB = 'JP | Live-Workshop 01.11. | ABO';
const VSL = '12_09_RM_WC_Lead_ABO_VSL';
const e = (account, campaign, adId, spend) => ({ account, campaign, campaignId: `${account}-${campaign}`, adset: 'AG', adsetId: 'as', adId, creative: `Ad ${adId}`, spend, impressions: 1000, clicks: 10, uniqueOutboundClicks: 5 });
const de = (account, campaign, date, spend) => ({ account, campaign, adset: 'AG', creative: 'x', date, spend, impressions: 100, clicks: 1, uoc: 1, platform: 'facebook' });
const A = {
  account: 'act_A', entities: [e('act_A', WEB, '1', 300), e('act_A', VSL, '2', 900)],
  dailyEntities: [de('act_A', WEB, '2026-10-22', 300), de('act_A', VSL, '2026-10-22', 900)],
  daily: [{ date: '2026-10-22', spend: 1200, impressions: 2000, clicks: 20 }],
  adList: [], records: [{ campaign: WEB, spend: 300 }, { campaign: VSL, spend: 900 }],
  adUrls: { 1: ['https://secretbusiness.live/v4'], 2: ['https://secretcreators.de/videotraining/'] },
  campaignStatus: {}, adsetStatus: {}, adStatus: {},
};
const B = {
  account: 'act_B', entities: [e('act_B', WEB, '3', 100)], dailyEntities: [de('act_B', WEB, '2026-10-22', 100)],
  daily: [{ date: '2026-10-22', spend: 100, impressions: 1000, clicks: 10 }], adList: [], records: [],
  adUrls: { 3: ['https://secretbusiness.live/v7'] }, campaignStatus: {}, adsetStatus: {}, adStatus: {},
};
const all = { byAccount: [A, B], daily: [{ date: '2026-10-22', spend: 1300 }], records: [...A.records] };
const scope = { landingPages: ['secretbusiness.live'], campaignNames: [] };

const { meta, excluded, active } = applyScope(all, scope);
assert.equal(active, true);
assert.deepEqual(meta.entities.map((x) => x.campaign), [WEB, WEB], 'nur Webinar-Kampagnen bleiben');
assert.equal(meta.daily[0].spend, 400, 'Tagesspend ohne VSL: 300 + 100 statt 1.300');
assert.equal(meta.byAccount[0].daily[0].spend, 300, 'Konto A ohne VSL');
assert.deepEqual(meta.records.map((r) => r.campaign), [WEB], 'Placement-Daten ebenfalls gefiltert');
assert.equal(excluded.length, 1);
assert.deepEqual(excluded[0], { account: 'act_A', campaign: VSL, reason: 'andere Landingpage', urls: ['https://secretcreators.de/videotraining/'], spend: 900 });

const fb = combineByAccount(meta, [], {});
assert.equal(fb.totals.spend, 400, 'Adspend im Dashboard = nur Webinar');
assert.equal(fb.daily.spend[0].spend, 400, 'Graph Ad-Spend pro Tag = nur Webinar');

// --- Konto ohne lesbare Landingpages: nichts still wegfiltern ---------------
const noUrls = applyScope({ ...all, byAccount: [{ ...A, adUrls: null }, B] }, scope);
assert.deepEqual(noUrls.meta.byAccount[0].entities.map((x) => x.campaign), [WEB, VSL], 'ohne LP-Daten bleibt alles drin');
assert.equal(noUrls.excluded.length, 0);

// --- Name als Zusatzregel (z. B. Lead-Formular ohne Landingpage) -------------
const byName = applyScope(all, { landingPages: ['secretbusiness.live'], campaignNames: ['vsl'] });
assert.equal(byName.excluded.length, 0, 'Name zieht die Kampagne in den Bereich');

// --- Ohne Regeln: alles zählt -------------------------------------------------
assert.equal(applyScope(all, { landingPages: [], campaignNames: [] }).active, false);
assert.equal(applyScope(all, undefined).meta, all);

console.log('✓ Alle Projekt-Bereich-Tests bestanden');
console.log('  VSL-Kampagne auf anderer LP: raus aus Adspend/CPL/Graphen, sichtbar als ausgeschlossen');
