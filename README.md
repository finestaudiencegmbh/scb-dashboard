# Lead- & Kampagnen-Dashboard

Eine Web-App, die ein Google-Tracking-Sheet **live ausliest** und mit den
Facebook-Kennzahlen aus der Meta Marketing API zusammenführt: wie viele Leads
jede **Kampagne**, **Anzeigengruppe**, jedes **Creative** und **Placement**
gebracht hat – optional inklusive zweiter Conversion-Stufe (Ticket) und
**Lead-Qualität** aus einem Fragebogen. Sortier- und filterbar, mit CSV-Export.

> **Neues Projekt aufsetzen?** → [TEMPLATE.md](TEMPLATE.md). Alles
> Projektspezifische – Name, Branding, Feature-Flags, Sheet-Spalten – steht in
> [`config/project.config.json`](config/project.config.json), nicht im Code.
> Welche Begriffe dieses README für die zweite Stufe benutzt („VIP-Ticket"),
> legt die Config fest; ohne sie fallen die Ticket-Kennzahlen komplett weg.

> Die App kann **gehostet** (teilbare URL mit Passwort) oder **lokal** laufen.
> Weil personenbezogene Daten (Namen, E-Mails, Telefonnummern) enthalten sind,
> ist die gehostete Variante **immer durch ein Login geschützt** – niemals offen
> im Netz.

---

## Was die App kann

- **KPIs auf einen Blick:** zugeordneter Adspend, Leads, CPL, VIP-Tickets,
  Ticket-Rate, Kosten/Ticket, Ø Lead-Qualität, qualifizierte Tickets,
  Qualitäts-Verteilung.
- **Breakdown nach Kampagne / Anzeigengruppe / Creative / Placement** – jeweils
  als sortierbare Tabelle. Zeile anklicken = sofort danach filtern.
- **Lead-Qualität (0–100):** berechnet aus Einkommen, investiertem Kapital,
  Immobilienbesitz und Beschäftigung (alles anpassbar, siehe unten). Einteilung
  in Tiers A–D.
- **Filter:** Quelle (bezahlt/organisch), Kampagne, Anzeigengruppe, Creative,
  Placement, Einkommen, Immobilien, Beschäftigung, Zeitraum, Qualitäts-Tier,
  Volltextsuche.
- **Lead-Detailtabelle** mit allen VIP-Antworten (aufklappbar) und **CSV-Export**.
- **Demo-Modus:** ohne jede Einrichtung sofort mit Beispieldaten ansehbar.

---

## Gehostet teilen — empfohlen (kein lokales Setup)

Damit du eine **teilbare URL mit Passwort** bekommst, ohne lokal etwas zu
installieren. Wir nutzen **Render** (kostenloser Tarif).

1. Account auf <https://render.com> anlegen und **GitHub verbinden**.
2. **New + → Blueprint** → dieses Repository auswählen.
   Render liest die mitgelieferte `render.yaml` automatisch.
3. Beim Anlegen die abgefragten Werte (Secrets) ausfüllen:
   - `DASHBOARD_USER` und `DASHBOARD_PASSWORD` → frei wählbar. Das ist das Login,
     das du beim Teilen weitergibst.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` → den kompletten Inhalt der Service-Account-
     JSON-Datei (siehe unten) als **eine Zeile** einfügen. *(Leer lassen = es
     startet erstmal im Demo-Modus.)*
4. **Apply / Create** → Render baut und startet. Nach 1–2 Minuten bekommst du
   eine URL wie `https://<service-name>.onrender.com` (Name aus `render.yaml`).
5. URL + Login an dein Team weitergeben. Fertig.

> Hinweis: Im kostenlosen Render-Tarif „schläft" der Dienst nach ~15 Minuten
> ohne Zugriff ein und braucht beim nächsten Aufruf ~30 Sek. zum Aufwachen.
> Für „immer sofort da" gibt es einen günstigen Always-on-Tarif (ab ~7 $/Monat).

Andere Hoster (Railway, Fly.io, eigener Server) funktionieren genauso – die App
ist ein normaler Node-Server (`npm install && npm run build && npm start`).

---

## Lokal starten (Alternative, Demo-Modus)

```bash
npm install
npm run serve
```

Dann **http://localhost:3000** öffnen. Es werden synthetische Beispieldaten
angezeigt (oben rechts „DEMO-Daten"). So siehst du das Dashboard sofort, bevor
du die Google-Anbindung einrichtest.

---

## Echte Daten anbinden (Google Sheets)

Damit die App live aus dem Sheet liest, brauchst du einen **Service-Account**
(einmalige Einrichtung, ~10 Minuten):

### 1. Google-Cloud-Projekt & Service-Account anlegen
1. Auf <https://console.cloud.google.com> ein Projekt anlegen (oder vorhandenes nutzen).
2. Unter **APIs & Dienste → Bibliothek** die **Google Sheets API** aktivieren.
3. Unter **APIs & Dienste → Anmeldedaten → Anmeldedaten erstellen →
   Dienstkonto** ein Service-Account anlegen.
4. Beim Service-Account → **Schlüssel → Schlüssel hinzufügen → JSON** einen
   Schlüssel erzeugen und herunterladen.
5. Die heruntergeladene Datei ins Projekt legen, z. B. als
   `service-account.json` (diese Datei ist bereits in `.gitignore` und wird
   **nie** committet).

### 2. Sheet für den Service-Account freigeben
In der JSON-Datei steht eine `client_email` (Form `...@...gserviceaccount.com`).
Diese E-Mail im Google Sheet über **Teilen** als **Betrachter** hinzufügen.

### 3. `.env` anlegen
```bash
cp .env.example .env
```
und ausfüllen:
```env
SPREADSHEET_ID=<ID aus der Sheet-URL zwischen /d/ und /edit>
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

### 4. Starten
```bash
npm run serve
```
Oben rechts sollte jetzt **„Stand: …"** mit dem echten Ladezeitpunkt stehen
(kein „DEMO"-Badge mehr). Über **↻ Aktualisieren** holst du frische Daten.

---

## Wie das Sheet gelesen wird

Die App erkennt die Tabellen **automatisch an ihren Kopfzeilen** – Tab-Namen
oder Reihenfolge dürfen sich ändern. Welche Kopfzeilen und Spalten gemeint sind,
steht in `config/project.config.json` unter `sheet` (Standard-Mapping unten):

| Tabelle | erkannt an | liefert |
| --- | --- | --- |
| Anzeigengruppen-Übersicht | `Anzeigengruppe` + `Adspend` | Adspend, Klicks, CPC … je Anzeigengruppe |
| Leads | `Gewonnen am` + `utm_source` | Lead + Attribution (UTM) |
| VIP-Tickets | `Monatliches Einkommen` / `Teilgenommen am` | Qualifizierungs-Antworten |

**Attribution über UTM:**
`utm_campaign` = Kampagne · `utm_source` = Anzeigengruppe ·
`utm_medium` = Creative · `utm_term` = Placement.

Leads und VIP-Tickets werden über die **E-Mail** zusammengeführt (Funnelcockpit-
und Typeform-Mail werden beide berücksichtigt, falls sich Tippfehler
unterscheiden). Adspend wird je **Anzeigengruppe** zugeordnet; auf Creative-/
Placement-Ebene liefert ihn die Facebook-Anbindung (Phase 2).

---

## Lead-Qualität anpassen

Das Bewertungsmodell steht in [`config/scoring.json`](config/scoring.json), die
Zuordnung der Fragebogen-Spalten in `config/project.config.json` unter
`sheet.answers` – **kein Code nötig**. Du kannst Gewichte, Einkommens-Stufen, harte
Geschäftsregeln und die Tier-Grenzen (A–D) frei ändern. Nach dem Speichern im Dashboard **↻ Aktualisieren**.

Standardgewichtung: Einkommen 40 %, investiertes Kapital 25 %,
Immobilienbesitz 20 %, Beschäftigung 15 %. Fehlende Antworten werden fair
herausgerechnet (das Ergebnis wird auf die vorhandenen Dimensionen normiert).

---

## Entwicklung

```bash
npm run dev    # Vite (Port 5173) + API (Port 3000) mit Hot-Reload
npm test       # Parser-/Dataset-Tests gegen die echte Sheet-Struktur
```
Im Dev-Modus **http://localhost:5173** öffnen (Anfragen an `/api` werden
automatisch an den Server weitergeleitet).

### Optionaler Passwortschutz
Für `DASHBOARD_USER` / `DASHBOARD_PASSWORD` in der `.env` setzen → Basic-Auth.

---

## Facebook-Ads-Daten via Supermetrics

Implementiert in [`server/supermetrics.js`](server/supermetrics.js). Wenn
konfiguriert, holt das Dashboard **Spend, Impressionen, Klicks und Placement**
live aus der Supermetrics-API und führt sie über die Namen
(Kampagne/Anzeigengruppe/Creative/Placement) mit den Leads zusammen. Damit gibt
es CPM, CTR, CPL und Kosten/Ticket **bis auf Creative- und Placement-Ebene** –
ohne manuelles Pflegen des Adspends im Sheet. Kein Meta-Token nötig,
Supermetrics übernimmt die Facebook-Authentifizierung.

**Einrichtung:**
1. In Render (oder `.env`) setzen:
   - `SUPERMETRICS_API_KEY` – dein Supermetrics-API-Key
   - `SUPERMETRICS_DS_ACCOUNTS` – Ad-Account(s), z. B. `act_1234567890`
   - `SUPERMETRICS_DS_USER` – der verbundene Supermetrics-User
2. **Zuverlässigste Variante:** im Supermetrics-Query-Builder eine Facebook-Ads-
   Abfrage bauen (Felder: Campaign name, Ad set name, Ad name, Publisher
   platform, Placement, Cost, Impressions, Clicks, Date), als JSON exportieren
   und in `SUPERMETRICS_QUERY_JSON` einfügen. Das hat Vorrang vor den Defaults.
3. Alternativ die Default-Felder in [`config/supermetrics.json`](config/supermetrics.json)
   anpassen. Die Spaltenzuordnung (`columnRoles`) matcht die zurückgegebenen
   **Anzeigenamen** – robust gegenüber abweichenden Feld-IDs.

Solange nichts gesetzt ist, läuft alles wie gehabt (Adspend je Anzeigengruppe
aus dem Sheet). Schlägt die Supermetrics-Abfrage fehl, bleibt das Dashboard
voll funktionsfähig und zeigt oben einen Hinweis.

> Hinweis (v1): Der FB-Spend wird über das eingestellte Zeitfenster
> (`lookbackDays`) je Dimension summiert und folgt noch nicht dem Datumsfilter
> im Dashboard. Die Namens-Zuordnung von Placement (Plattform + Position) ist
> „best effort"; passt sie bei euch nicht exakt, lässt sie sich in
> `config/supermetrics.json` justieren.

---

## Projektstruktur

```
config/scoring.json     Bewertungsmodell für die Lead-Qualität (anpassbar)
config/supermetrics.json  Facebook-Ads-Abfrage (Felder, Spaltenzuordnung)
server/                 Node-Backend
  sheets.js             Google-Sheets-Anbindung (Service-Account)
  parser.js             erkennt & parst die Tabellen
  build.js              Join Leads ↔ Tickets ↔ Adspend, Quelle, Qualität
  scoring.js            Berechnung der Lead-Qualität
  supermetrics.js       Facebook-Ads-Daten via Supermetrics-API
  sample-data.js        synthetische Demo-Daten
  index.js              Express-Server (API + Auslieferung)
  parser.test.mjs       Tests
web/                    React-Frontend (Vite)
```
