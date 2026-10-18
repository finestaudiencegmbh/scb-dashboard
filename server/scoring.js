import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'scoring.json');

/**
 * Welche Tiers als "qualifiziert" zählen (Kachel + Quali-Rate). Steht als
 * "qualified": true an den Tiers in scoring.json. Ohne Angabe bleibt es beim
 * bisherigen Verhalten (A und B).
 */
export function qualifiedTiersOf(cfg) {
  const marked = (cfg?.tiers || []).filter((t) => t.qualified).map((t) => t.key);
  return marked.length ? marked : ['A', 'B'];
}

export function loadScoringConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Parst die Zahlen aus einer Einkommens-/Geldangabe und liefert einen Mittelwert in € (oder null). */
export function parseAmount(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/\s/g, '');
  // "über 10.000", "mehr als 10000" -> Obergrenze offen
  const openTop = /(über|mehralsals|mehrals|>)/.test(t);
  // alle Zahlen einsammeln (Tausenderpunkt entfernen, Dezimalkomma ignorieren)
  const nums = (t.match(/\d[\d.]*/g) || [])
    .map((n) => parseInt(n.replace(/\./g, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 0) return null;
  if (nums.length === 1) return openTop ? nums[0] * 1.25 : nums[0];
  // Spanne -> Mittelwert der beiden größten plausiblen Werte
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  return Math.round((min + max) / 2);
}

/** Mittelwert des Einkommens in €/Monat (für Stufen + Haushaltsregel). */
export function incomeMid(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  // "weniger als 1.000" -> als ~750 werten (untere Stufe)
  if (/weniger als|unter|bis zu/.test(t)) {
    const n = parseAmount(text);
    return n != null ? n * 0.75 : null;
  }
  // "mehr als 5.000 / über 5000" -> klar über der Top-Schwelle
  if (/mehr als|über|ab /.test(t)) {
    const n = parseAmount(text);
    return n != null ? n * 1.25 : null;
  }
  return parseAmount(text);
}

function scoreIncome(text, cfg) {
  const mid = incomeMid(text);
  if (mid == null) return null;
  // Stufenmodell (neue Config) bevorzugt, sonst Fallback auf fullScoreAt
  if (Array.isArray(cfg.income.tiers)) {
    const tier = cfg.income.tiers.find((t) => mid >= t.atLeast);
    return tier ? tier.score : 0.05;
  }
  return clamp01(mid / (cfg.income.fullScoreAt || 5000));
}

function scoreInvested(text, cfg) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  if (/(^|\b)(nein|keine?|noch nicht|gar nicht|0\b)/.test(t.trim())) return cfg.invested.none;
  const amount = parseAmount(text);
  if (/monat/.test(t)) {
    // monatlicher Sparbetrag: Basiswert, durch Höhe leicht angehoben
    const bump = amount ? clamp01(amount / 1000) * 0.3 : 0;
    return clamp01(cfg.invested.monthly + bump);
  }
  if (amount != null) return clamp01(amount / cfg.invested.fullScoreAt);
  if (/(ja|bereits|schon)/.test(t)) return cfg.invested.yesGeneric;
  return cfg.invested.yesGeneric;
}

/**
 * Generischer Regel-Scorer: prüft die 'rules' einer Dimension der Reihe nach als
 * Teilstring (case-insensitiv) und liefert den Score der ersten passenden Regel.
 * Damit lässt sich JEDE Fragebogen-Dimension in scoring.json bewerten, ohne
 * Code anzufassen – z. B. Dringlichkeit, Alter, Zielgruppen-Fit.
 */
function scoreByRules(text, dimCfg) {
  if (!text || !dimCfg || !Array.isArray(dimCfg.rules)) return null;
  const t = String(text).toLowerCase();
  for (const rule of dimCfg.rules) {
    if (t.includes(String(rule.match).toLowerCase())) return rule.score;
  }
  return dimCfg.default ?? null;
}

function scoreEmployment(text, cfg) {
  if (!text) return null;
  const t = String(text).toLowerCase().trim();
  for (const [key, val] of Object.entries(cfg.employment.scores)) {
    if (t.includes(key)) return val;
  }
  return cfg.employment.default;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * Prüft eine einzelne Bedingung gegen die Antworten. Zwei Formen:
 *   Text:  { dim, match: "…" } oder { dim, matchAny: ["…", "…"] }
 *   Zahl:  { dim, atLeast: 2000, below: 3000 } – der Betrag wird aus der
 *          Antwort geparst ("2.000 - 2.999 €" -> 2.500, "Über 5.000 €" -> 6.250).
 *          Robuster als Textvergleich, wenn sich die Beschriftung ändert.
 */
function matchCondition(answers, cond) {
  const val = String(answers?.[cond.dim] ?? '').trim();
  if (!val) return false;
  if (cond.atLeast != null || cond.below != null) {
    const n = incomeMid(val);
    if (n == null) return false;
    if (cond.atLeast != null && n < cond.atLeast) return false;
    if (cond.below != null && n >= cond.below) return false;
    return true;
  }
  const needles = cond.matchAny || (cond.match != null ? [cond.match] : []);
  const lower = val.toLowerCase();
  return needles.some((m) => lower.includes(String(m).toLowerCase()));
}

/**
 * Harte Regeln über dem rechnerischen Score – für Geschäftsregeln, die keine
 * Gewichtung kennen ("Rentner ist immer D", "über 3.000 € ist immer A").
 * Jede Regel in cfg.rules:
 *   { label, any: [...], all: [...], setScore | minScore | maxScore }
 * 'any' = mindestens eine Bedingung trifft, 'all' = alle. Die erste passende
 * Regel gewinnt. setScore erzwingt einen Wert, min/maxScore heben bzw. deckeln.
 * Regeln greifen auch, wenn sich (mangels Antworten) gar kein Score berechnen
 * ließ – ein Disqualifikations-Merkmal reicht für ein Urteil.
 */
function applyRules(answers, cfg, score) {
  for (const rule of cfg.rules || []) {
    const any = rule.any || [];
    const all = rule.all || [];
    if (any.length && !any.some((c) => matchCondition(answers, c))) continue;
    if (all.length && !all.every((c) => matchCondition(answers, c))) continue;
    if (!any.length && !all.length) continue;
    if (rule.setScore != null) return { score: rule.setScore, rule: rule.label || null };
    if (score == null) continue; // min/max brauchen einen Ausgangswert
    if (rule.maxScore != null && score > rule.maxScore) return { score: rule.maxScore, rule: rule.label || null };
    if (rule.minScore != null && score < rule.minScore) return { score: rule.minScore, rule: rule.label || null };
  }
  return null;
}

function tierFor(score, cfg) {
  if (score == null) return null;
  const tiers = [...cfg.tiers].sort((a, b) => b.min - a.min);
  for (const t of tiers) {
    if (score >= t.min) return t;
  }
  return tiers[tiers.length - 1];
}

/**
 * Berechnet die Lead-Qualität (0..100) aus den VIP-Ticket-Antworten.
 * Fehlende Dimensionen werden ausgeklammert, das Ergebnis auf die
 * vorhandenen Gewichte renormiert – fehlende Antworten ziehen den Score
 * also nicht unfair nach unten.
 */
export function computeQuality(answers, cfg) {
  if (!answers) return null;
  // Spezial-Scorer für Dimensionen mit eigener Logik (Beträge parsen etc.).
  // Alle anderen Dimensionen werden über ihre 'rules' in scoring.json bewertet.
  const special = {
    income: () => (cfg.income ? scoreIncome(answers.income, cfg) : null),
    invested: () => (cfg.invested ? scoreInvested(answers.invested, cfg) : null),
    employment: () => (cfg.employment?.scores ? scoreEmployment(answers.employment, cfg) : null),
  };
  const scoreDim = (dim) => (special[dim] ? special[dim]() : scoreByRules(answers[dim], cfg[dim]));

  let sumW = 0;
  let sum = 0;
  const breakdown = {};
  for (const dim of Object.keys(cfg.weights)) {
    const s = scoreDim(dim);
    const w = cfg.weights[dim];
    breakdown[dim] = s == null ? null : Math.round(s * 100);
    if (s != null) {
      sum += s * w;
      sumW += w;
    }
  }
  let score = sumW === 0 ? null : Math.round((sum / sumW) * 100);
  let capped = false;
  let appliedRule = null;

  // Harte Geschäftsregeln (config: rules) – schlagen die Gewichtung.
  const forced = applyRules(answers, cfg, score);
  if (forced) {
    score = forced.score;
    appliedRule = forced.rule;
    capped = true;
  }

  if (score == null) return null;

  const tier = tierFor(score, cfg);
  return { score, tier: tier?.key ?? null, tierLabel: tier?.label ?? null, breakdown, capped, rule: appliedRule };
}
