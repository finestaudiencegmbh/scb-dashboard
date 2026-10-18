/**
 * Tests für die Supermetrics-Anbindung: Parsing der API-Antwort (Header-Zeile,
 * Spaltenzuordnung per Anzeigename, deutsche/englische Zahlenformate) und die
 * Verdichtung je Dimension. Ausführen: node server/supermetrics.test.mjs
 */
import assert from 'node:assert/strict';
import { parseSupermetricsData, aggregateFb } from './supermetrics.js';

const cfg = {
  query: { fields: [] },
  columnRoles: {
    campaign: ['campaign name', 'campaign'],
    adset: ['ad set name', 'adset'],
    creative: ['ad name', 'ad'],
    placement: ['placement', 'platform position'],
    platform: ['publisher platform', 'platform'],
    date: ['date'],
    spend: ['cost', 'spend'],
    impressions: ['impressions'],
    clicks: ['clicks'],
    reach: ['reach'],
  },
};

// Antwort wie von Supermetrics: erste Zeile = Anzeige-Header
const data = [
  ['Campaign name', 'Ad set name', 'Ad name', 'Publisher platform', 'Placement', 'Cost', 'Impressions', 'Clicks', 'Reach', 'Date'],
  ['J&P | MMV 15.06.-18.06. | ABO | 260526', 'J&P | LP 2 | Broad | DACH | W | 30-55', 'LP 2 - Static 19', 'facebook', 'feed', '1.234,56', '10000', '250', '8000', '2026-05-27'],
  ['J&P | MMV 15.06.-18.06. | ABO | 260526', 'J&P | LP 2 | Broad | DACH | W | 30-55', 'LP 2 - Static 19', 'instagram', 'reels', '765.44', '5000', '100', '4000', '2026-05-28'],
];

const records = parseSupermetricsData(data, cfg);
assert.equal(records.length, 2, 'zwei Datenzeilen geparst');
assert.equal(records[0].campaign, 'J&P | MMV 15.06.-18.06. | ABO | 260526');
assert.equal(records[0].creative, 'LP 2 - Static 19');
assert.equal(records[0].spend, 1234.56, 'deutsches Zahlenformat 1.234,56');
assert.equal(records[1].spend, 765.44, 'englisches Zahlenformat 765.44');
assert.equal(records[0].impressions, 10000);

const agg = aggregateFb(records);
assert.equal(Math.round(agg.totals.spend * 100) / 100, 2000, 'Gesamt-Spend summiert');
assert.equal(agg.totals.impressions, 15000);

// Creative-Ebene: beide Zeilen gehören zum selben Creative
const creativeKey = 'lp 2 - static 19';
assert.ok(agg.byDim.creative[creativeKey], 'Creative-Schlüssel normalisiert vorhanden');
assert.equal(Math.round(agg.byDim.creative[creativeKey].spend * 100) / 100, 2000, 'Spend je Creative summiert');

// Placement-Ebene: platform + position zusammengesetzt, getrennt je Zeile
assert.ok(agg.byDim.placement['facebook feed'], 'Placement facebook feed');
assert.ok(agg.byDim.placement['instagram reels'], 'Placement instagram reels');

// no_headers-Variante: Reihenfolge aus query.fields
const cfg2 = { ...cfg, query: { fields: ['Campaign_name', 'cost'], settings: { no_headers: true } }, columnRoles: { campaign: ['campaign'], spend: ['cost'] } };
const r2 = parseSupermetricsData([['Kampagne X', '100,00']], cfg2);
assert.equal(r2[0].campaign, 'Kampagne X');
assert.equal(r2[0].spend, 100);

console.log('✓ Alle Supermetrics-Tests bestanden');
console.log('  Datensätze:', records.length, '| Gesamt-Spend:', agg.totals.spend, '€');
