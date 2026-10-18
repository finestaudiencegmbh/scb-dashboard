import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'config', 'campaigns.json');

export function loadCampaignConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { leadObjectives: [], nonLeadObjectives: [], overrides: {} };
  }
}

/**
 * Entscheidet, ob eine Kampagne als Lead-Kampagne zählt (also in CPL/€-Ticket
 * einfließt). Reihenfolge: manueller Override > Meta-Ziel > Default (true).
 */
export function isLeadCampaign(name, objective, cfg) {
  const overrides = cfg.overrides || {};
  const lc = String(name || '').toLowerCase();
  for (const [key, val] of Object.entries(overrides)) {
    if (lc.includes(String(key).toLowerCase())) return Boolean(val);
  }
  const obj = String(objective || '').toUpperCase();
  if (obj) {
    if ((cfg.nonLeadObjectives || []).includes(obj)) return false;
    if ((cfg.leadObjectives || []).includes(obj)) return true;
  }
  // Unbekanntes/fehlendes Ziel: im Zweifel als Lead-Kampagne werten,
  // damit nichts ungewollt aus der CPL verschwindet.
  return true;
}
