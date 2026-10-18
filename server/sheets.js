import fs from 'node:fs';
import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets.readonly'];

/**
 * Baut die Google-Auth. Zwei Wege:
 *  - GOOGLE_SERVICE_ACCOUNT_JSON  (kompletter Key als String, z. B. fürs Hosting)
 *  - GOOGLE_APPLICATION_CREDENTIALS  (Pfad zur Key-Datei, lokal üblich)
 */
function buildAuth() {
  const inlineJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (inlineJson) {
    const creds = JSON.parse(inlineJson);
    return new google.auth.GoogleAuth({ credentials: creds, scopes: SCOPES });
  }
  const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyFile && fs.existsSync(keyFile)) {
    return new google.auth.GoogleAuth({ keyFile, scopes: SCOPES });
  }
  return null;
}

export function isConfigured() {
  return Boolean(buildAuth()) && Boolean(process.env.SPREADSHEET_ID);
}

/**
 * Liest ALLE Tabs des Spreadsheets und liefert sie als
 * [{ title, values: string[][] }]. Der Parser klassifiziert anschließend
 * selbst, welcher Tab welche Daten enthält.
 */
export async function fetchAllSheets() {
  const auth = buildAuth();
  if (!auth) throw new Error('Kein Service-Account konfiguriert (siehe .env / README).');
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!spreadsheetId) throw new Error('SPREADSHEET_ID ist nicht gesetzt.');

  const sheetsApi = google.sheets({ version: 'v4', auth });

  // 1) Metadaten -> Tab-Titel
  const meta = await sheetsApi.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties(title,sheetId,gridProperties)',
  });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  if (titles.length === 0) return [];

  // 2) Werte aller Tabs in einem Rutsch holen (UNFORMATTED, damit Zahlen/UTMs roh kommen)
  const res = await sheetsApi.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: titles.map((t) => `'${t.replace(/'/g, "''")}'`),
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });

  const ranges = res.data.valueRanges || [];
  return titles.map((title, i) => ({ title, values: ranges[i]?.values || [] }));
}
