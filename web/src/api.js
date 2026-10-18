const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchData({ refresh = false, from = '', to = '', retries = 2 } = {}) {
  const params = new URLSearchParams();
  if (refresh) params.set('refresh', '1');
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  const url = `/api/data${qs ? `?${qs}` : ''}`;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Timeout, damit ein hängender Abruf nicht ewig blockiert
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      // Netzwerkfehler/Abbruch (z. B. Render-Cold-Start) -> kurz warten und erneut
      const isNetwork = e.name === 'AbortError' || e.name === 'TypeError' || /fetch/i.test(e.message || '');
      if (attempt < retries && isNetwork) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      break;
    }
  }
  const msg = lastErr?.name === 'AbortError'
    ? 'Zeitüberschreitung beim Laden (Server evtl. im Standby) – bitte erneut auf Aktualisieren klicken.'
    : (lastErr?.message || 'Verbindung fehlgeschlagen');
  throw new Error(msg);
}

/** Projekt-Konfiguration (Branding, Feature-Flags, Begriffe). */
export async function fetchConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
