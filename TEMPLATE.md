# Neues Dashboard aufsetzen

Diese Codebasis ist eine Vorlage. Der funktionierende Kern – Meta-Marketing-API,
UTM-Attribution, Charts, Chatbot – bleibt unangetastet. Pro Projekt änderst du
**eine Datei und ein paar Env-Vars**.

Gesamtdauer beim ersten Mal: ca. 60–90 Minuten, danach 20.

---

## 1. Repo kopieren

```bash
git clone <dieses-repo> mein-neues-dashboard
cd mein-neues-dashboard
rm -rf .git && git init
npm install
```

## 2. `config/project.config.json` ausfüllen

Das ist die einzige Datei, die jedes Projekt anfassen muss.

| Feld | Bedeutung |
|---|---|
| `name` | Voller Projektname. Steht in der Topbar, im Browser-Titel, im Basic-Auth-Dialog und im System-Prompt des Chatbots. |
| `shortName` | Kurzform für die Sidebar. |
| `subtitle` | Zeile unter dem Namen, z. B. `"Workshop · 15.–18.06."`. |
| `slug` | Kleinschreibung, ohne Leerzeichen. Wird für den CSV-Dateinamen benutzt. |
| `branding.accent` | Akzentfarbe als Hex. Hover-, Glow- und Linien-Töne leitet das Frontend automatisch ab. |
| `branding.logo` | Pfad zu einer Datei in `web/public/`, z. B. `/logo.svg`. |
| `features.hasTickets` | Gibt es eine zweite Conversion-Stufe nach dem Lead (Ticket, Upgrade, Bewerbung)? |
| `features.hasQuality` | Gibt es einen Fragebogen mit Lead-Scoring? Setzt `hasTickets` voraus – die Antworten stecken im Ticket-Tab. |
| `labels.ticket` | Wie die zweite Stufe heißt: `one` (Einzahl), `many` (Mehrzahl), `short` (Badge/Spalte). |
| `sheet.utmRoles` | Welcher UTM-Parameter welche Dimension trägt (siehe unten). |
| `sheet.detect` | Wie die Tabellen im Sheet erkannt werden (siehe unten). |
| `sheet.columns` | Spaltenüberschriften je Tabelle. |
| `sheet.answers` | Die Fragebogen-Spalten inkl. Anzeigename. |

### Was bei `hasTickets: false` verschwindet

Tickets-Spalte, €/Ticket, CVR Ticket, Kosten/Ticket, Ticket-KPI-Karten, die
Ticket-Linie im Verlaufsgraphen, der Ticket-KPI im Grafik-Panel, Ticket-Spalte
in der Leadliste und im CSV, Ticket-Felder im Chatbot-Kontext. Übrig bleibt ein
sauberes Lead-Dashboard mit Spend, CPL, CTR, CPM und Quellen-Aufschlüsselung.

### Was bei `hasQuality: false` verschwindet

Quali-Rate, Ø Quali, Tier A–D, Verteilungsbalken, Qualitäts-Verlauf, die
Fragebogen-Filter, das Antworten-Detail beim Aufklappen eines Leads, die
Antwort-Spalten im CSV und alle Quali-Felder im Chatbot-Kontext.

### UTM-Rollen — der wichtigste Punkt

Jedes Werbekonto baut seine URL-Parameter anders. Deshalb steht in
`sheet.utmRoles`, **welcher UTM-Parameter welche Dimension trägt**:

```jsonc
"utmRoles": {
  "campaign":  "campaign",   // utm_campaign
  "adset":     "term",       // utm_term
  "creative":  "content",    // utm_content
  "placement": null          // wird nicht getrackt
}
```

Erlaubte Werte: `source`, `medium`, `campaign`, `term`, `content` oder `null`.
Steht eine Dimension auf `null` oder ist der Parameter leer, bleibt die
entsprechende Ebene im Dashboard leer – dort gibt es dann nichts zu optimieren.

**Empfohlener URL-Parameter-String in Meta** (Werbeanzeigenebene → „URL-Parameter"):

```
utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_term={{adset.name}}&utm_content={{ad.name}}
```

Damit greift die Zuordnung Kampagne → Anzeigengruppe → Creative durchgehend.
Fehlt `utm_content`, gibt es keine Creative-Auswertung – und genau die ist der
Hauptgrund für dieses Dashboard.

### Bezahlt oder organisch?

`config/campaigns.json` entscheidet in dieser Reihenfolge:

1. `organicPatterns` – kommt einer dieser Begriffe irgendwo in den UTMs vor,
   ist der Lead organisch. Teilstring-Treffer, also **keine kurzen, generischen
   Begriffe** eintragen: `"bio"` würde auch in einem Kampagnennamen wie
   „Biohacking" zuschlagen.
2. `paidMediums` – exakter Wert von `utm_medium` (`paid`, `cpc`, `paid_social`
   …). Das zuverlässigste Signal, wenn das URL-Schema es setzt.
3. Anzeigengruppe steht in der Adspend-Übersicht des Sheets.
4. Namensschema mit `|` in Kampagne/Anzeigengruppe.

### Sheet-Mapping

Der Parser sucht **keine Tab-Namen**, sondern erkennt jede Tabelle an ihrer
Kopfzeile. Ein Tab darf mehrere Tabellen untereinander enthalten.

```jsonc
"detect": {
  "overview": [{ "all": ["anzeigengruppe", "adspend"] }],
  "tickets":  [{ "some": ["monatliches einkommen"] }, { "all": ["teilgenommen am", "vorname"] }],
  "leads":    [{ "all": ["gewonnen am"], "some": ["utm_source", "e-mail"] }]
}
```

Eine Regel trifft, wenn **alle** `all`-Spalten vorhanden sind **und** (falls
`some` gesetzt ist) mindestens eine `some`-Spalte. Mehrere Regeln je Typ = ODER.
Reihenfolge der Prüfung ist die Reihenfolge im JSON.

Spaltennamen werden normalisiert verglichen: klein geschrieben, ohne `? : .`,
Mehrfach-Leerzeichen zusammengefasst. `"Monatliches Einkommen?"` im Sheet
trifft also den Config-Eintrag `"monatliches einkommen"`.

Bei den `columns` ist jeder Wert eine **Liste** – der erste nicht-leere Treffer
gewinnt. Praktisch für Sheets, in denen eine Spalte mal so und mal anders heißt.

### Zwei Reiter, zwei Zählungen

Lead-Tab und Fragebogen-Tab sind **eigenständig**. Die Lead-Anzahl entspricht
exakt den Zeilen im Lead-Tab, die Ticket-Anzahl exakt den Zeilen im
Fragebogen-Tab. Es wird nichts zusammengeführt und nichts dedupliziert.

Beide Reiter tragen ihre eigenen UTM-Spalten und werden getrennt auf Kampagne,
Anzeigengruppe und Creative heruntergebrochen. Ein Ticket zählt also dort, wo
es entstanden ist, nicht dort, wo die Person mal Lead war.

Die E-Mail wird nur für die **Anzeige** genutzt: passt sie, erscheinen die
Fragebogen-Antworten beim Lead in der Leadliste und die Zeile bekommt ein
Ticket-Badge. Passt sie nicht (Vertipper im Formular), bleibt die Anzeige leer.
An den Zahlen ändert das nichts.

Eine Ticket-Spalte IM Lead-Tab (etwa "VIP-Ticket geholt am") erzeugt daher
kein Ticket. Gezählt wird ausschließlich der Fragebogen-Tab.

### Fragebogen und Scoring

Die Schlüssel unter `sheet.answers` verbinden Sheet und Bewertungsmodell:
`income`, `invested`, `realEstate` und `employment` werden von
`config/scoring.json` bewertet, alle anderen nur angezeigt und exportiert.

- Anderer Fragebogen, gleiche Logik → nur die `columns` austauschen.
- Zusätzliche Frage → neuen Schlüssel ergänzen (`label`, `columns`, optional
  `filter: true` für einen Dropdown-Filter, `wide: true` für Freitext).
- Anderes Bewertungsmodell → `config/scoring.json` anpassen (Gewichte, Stufen,
  harte Regeln, Tiers). Der Code bleibt gleich.

Nur die Dimensionen unter `weights` fließen in den Score ein; fehlt eine
Antwort, wird auf die vorhandenen Gewichte renormiert. Es gibt zwei Arten von
Dimensionen:

- **Spezial-Scorer** für `income` (Beträge und Spannen werden geparst,
  Stufenmodell), `invested` (Beträge/Sparraten) und `employment` (Stichwort →
  Score).
- **Regel-Dimensionen** für alles andere: eine Liste `rules` mit
  `{ "match": "…", "score": 0…1 }`, von oben nach unten als Teilstring geprüft,
  plus optionalem `default`. So lässt sich jede neue Frage bewerten – z. B.
  Dringlichkeit, Alter oder Zielgruppen-Fit – **ohne Code**.

```jsonc
"urgency": {
  "rules": [
    { "match": "sofort", "score": 1.0 },
    { "match": "nächsten wochen", "score": 0.9 },
    { "match": "jahr", "score": 0.25 }
  ],
  "default": 0.4
}
```

**Harte Geschäftsregeln** stehen daneben in `rules` auf oberster Ebene und
schlagen die Gewichtung – für Vorgaben, die keine Punktemischung kennen
(„Rentner ist immer D"). Die erste passende Regel gewinnt:

```jsonc
"rules": [
  {
    "label": "Disqualifiziert: kein planbares Einkommen oder über 60",
    "any": [
      { "dim": "employment", "matchAny": ["rentner", "schüler", "arbeitssuchend"] },
      { "dim": "age", "matchAny": ["über 60"] }
    ],
    "setScore": 15
  }
]
```

`any` = eine Bedingung reicht, `all` = alle müssen passen. `setScore` erzwingt
einen Wert, `minScore`/`maxScore` heben bzw. deckeln. Bedingungen gibt es in
zwei Formen: Text (`match` / `matchAny`, Teilstring, case-insensitiv) und Zahl
(`atLeast` / `below`, der Betrag wird aus der Antwort geparst, also
`"2.000 - 2.999 €"` -> 2.500). Die Zahlenform ist robuster, wenn sich die
Beschriftung der Antwortoption später ändert. Eine `setScore`-Regel
greift auch dann, wenn sich mangels Antworten gar kein Score berechnen ließ –
ein Disqualifikations-Merkmal reicht für ein Urteil. Gibt es weder eine
passende Regel noch eine bewertbare Antwort, bleibt die Qualität leer, statt
eine Note zu erfinden.

### Logo

`web/public/logo.svg` ersetzen oder eine neue Datei dort ablegen und in
`branding.logo` eintragen. Das mitgelieferte Logo nutzt die Akzentfarbe – wenn
du ein SVG behältst, dort den Hex-Wert mitändern.

## 3. Weitere Konfigurationsdateien (meist unverändert)

| Datei | Wann anfassen |
|---|---|
| `config/scoring.json` | Anderes Bewertungsmodell für die Lead-Qualität. |
| `config/campaigns.json` | Welche Kampagnen als Lead-Kampagnen zählen (Meta-`objective` + manuelle Overrides) und welche UTM-Muster als organisch gelten (`organicPatterns`, z. B. `manychat`, `bio`, der Kampagnen-Slug). |
| `config/supermetrics.json` | Nur relevant, wenn statt der Meta-API Supermetrics genutzt wird. |

Die `organicPatterns` in `campaigns.json` enthalten oft den Workshop-Slug des
Vorgängerprojekts – hier den neuen eintragen, sonst landen organische Leads im
Paid-Container.

## 4. Google Sheet anbinden

1. In der **Google Cloud Console** ein Projekt anlegen, die **Google Sheets API**
   aktivieren, einen **Service-Account** erstellen und einen JSON-Key
   herunterladen.
2. Das Tracking-Sheet für die E-Mail-Adresse des Service-Accounts freigeben
   (Leseberechtigung reicht).
3. Die Sheet-ID aus der URL zwischen `/d/` und `/edit` in `SPREADSHEET_ID`
   eintragen.

Ohne diese Konfiguration startet das Dashboard im **Demo-Modus** mit
synthetischen Daten – gut zum Ansehen des Layouts vor dem echten Anschluss.

## 5. Meta (Facebook) anbinden

1. Im **Meta Business Manager** eine App mit Zugriff auf das Werbekonto anlegen.
2. Access-Token mit der Berechtigung **`ads_read`** erzeugen (langlebiges Token
   verwenden, sonst läuft es nach Stunden ab).
3. Werbekonto-ID (`act_…`) eintragen. Mehrere Konten: kommagetrennt.

## 6. Lokal starten

```bash
cp .env.example .env    # und ausfüllen
npm run dev             # Server + Vite, http://localhost:5173
npm test                # muss grün sein
```

`npm test` enthält `server/project.test.mjs`: Der Test prüft die **aktuelle**
`project.config.json` gegen ein Abbild der echten Sheet-Kopfzeilen –
Tabellen-Erkennung, Spalten, UTM-Rollen und Scoring. Ändert sich das Sheet,
schlägt er fehl, statt dass das Dashboard still falsche Zahlen zeigt. Beim
Aufsetzen eines neuen Projekts die Fixtures dort durch die eigenen Kopfzeilen
ersetzen.

## 7. Deployen (Render)

`render.yaml` ist ein fertiger Blueprint. Alle Secrets stehen auf `sync: false`
und werden beim Deploy abgefragt.

**Zum Service-Namen:** Render ordnet Services über den `name` in der
`render.yaml` zu. Bei einem NEUEN Projekt den Namen einmal sauber setzen, bevor
der Blueprint das erste Mal synchronisiert. Bei einem BESTEHENDEN Service den
Namen nicht mehr ändern – der nächste Sync würde sonst einen zweiten Service
anlegen (neue URL, leere Env-Vars), während der alte aus dem Blueprint fällt.

```bash
npm run serve   # lokal wie in Production (Build + Server auf einem Port)
```

---

## Env-Vars

### Pflicht für echte Daten

| Variable | Beispiel | Zweck |
|---|---|---|
| `SPREADSHEET_ID` | `1rxK4s-…` | ID des Tracking-Sheets (aus der URL). |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | `{"type":"service_account",…}` | Kompletter Service-Account-Key als **eine Zeile**. Für Hosting der richtige Weg. |
| `GOOGLE_APPLICATION_CREDENTIALS` | `./service-account.json` | Alternative für lokal: Pfad zur Key-Datei. Wird von `GOOGLE_SERVICE_ACCOUNT_JSON` überstimmt. **Nie committen.** |

### Meta Marketing API (Facebook-Kennzahlen)

| Variable | Beispiel | Zweck |
|---|---|---|
| `META_ACCESS_TOKEN` | `EAAG…` | Token mit `ads_read`. |
| `META_AD_ACCOUNT_ID` | `act_123…` | Werbekonto; mehrere kommagetrennt. |
| `META_API_VERSION` | `v21.0` | Optional, Graph-API-Version. |
| `META_LOOKBACK_DAYS` | `90` | Optional, Zeitfenster ohne expliziten Datumsbereich. |

Ohne diese Variablen läuft das Dashboard weiter – nur die Facebook-Kennzahlen
fehlen, Leads aus dem Sheet bleiben vollständig.

### Zugangsschutz

| Variable | Zweck |
|---|---|
| `DASHBOARD_USER` | Benutzername für Basic Auth. Leer = kein Schutz. |
| `DASHBOARD_PASSWORD` | Passwort für Basic Auth. |

Beide setzen, sobald die URL geteilt wird. `/api/health` bleibt bewusst offen,
sonst scheitert der Health-Check des Hosters.

### KI-Chatbot

| Variable | Zweck |
|---|---|
| `ANTHROPIC_API_KEY` | Aktiviert den Analyse-Assistenten. Leer = Chat-Button aus. |

### Betrieb

| Variable | Default | Zweck |
|---|---|---|
| `PORT` | `3000` | Server-Port. |
| `CACHE_TTL_SECONDS` | `900` | Wie lange Sheet-/Meta-Daten gecacht werden. Der Button „Aktualisieren" umgeht den Cache. |

### Supermetrics (Alternative zur Meta-API, optional)

`SUPERMETRICS_API_KEY`, `SUPERMETRICS_DS_ACCOUNTS`, `SUPERMETRICS_DS_USER`,
`SUPERMETRICS_QUERY_JSON`. Wird nur genutzt, wenn **kein** Meta-Token gesetzt
ist. Die Meta-API ist der bessere Weg: mehr Kennzahlen, Hierarchie und
Ad-Status.

---

## Checkliste pro neuem Projekt

- [ ] `config/project.config.json`: Name, Subtitle, Slug, Akzentfarbe, Logo
- [ ] `config/project.config.json`: `features.hasTickets` / `hasQuality` gesetzt
- [ ] `config/project.config.json`: `labels.ticket` passend benannt
- [ ] `config/project.config.json`: `sheet.utmRoles` gegen das echte URL-Schema geprüft
- [ ] `config/project.config.json`: `sheet.detect` und `sheet.columns` gegen das echte Sheet geprüft
- [ ] `config/project.config.json`: `sheet.answers` auf den neuen Fragebogen gemappt
- [ ] `config/campaigns.json`: `organicPatterns` und `paidMediums` geprüft
- [ ] `server/project.test.mjs`: Fixtures auf die echten Sheet-Kopfzeilen umgestellt
- [ ] `config/scoring.json`: Bewertungsmodell geprüft (oder unverändert übernommen)
- [ ] `web/public/logo.svg` ersetzt
- [ ] `render.yaml`: `name` angepasst
- [ ] Sheet für den Service-Account freigegeben
- [ ] `.env` gefüllt, `npm test` grün, `npm run dev` zeigt echte Zahlen

## Architektur in zehn Zeilen

```
Google Sheet ─► sheets.js ─► parser.js ─┐
                                        ├─► build.js ─► Lead-Records (UTM → Kampagne/Anzeigengruppe/Creative)
Meta API ────► meta.js ─────────────────┘        │
                                                 └─► combine.js ─► Hierarchie + Tagesreihen
                                                                        │
                                        index.js (/api/data, /api/config)
                                                                        │
                                        React-Frontend (project.jsx liefert Flags + Branding)
```

Was du beim Erweitern nicht anfassen musst: `meta.js` (API-Abruf, Rate-Limits,
Retries), `combine.js` (hierarchische Attribution), die Chart-Komponenten.
