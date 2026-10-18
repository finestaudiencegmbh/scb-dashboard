import React, { createContext, useContext, useEffect, useMemo } from 'react';

/**
 * Projekt-Konfiguration im Frontend: Branding, Feature-Flags, Begriffe und die
 * Fragebogen-Labels. Kommt vom Server (/api/config bzw. payload.project) und
 * steckt hier in einem Context, damit jede Komponente sie ohne Prop-Drilling
 * lesen kann. Defaults = Vollausstattung, damit nie etwas leer bleibt, falls
 * der Abruf scheitert.
 */

export const DEFAULT_PROJECT = {
  name: 'Lead-Dashboard',
  shortName: 'Dashboard',
  subtitle: 'Lead-Dashboard',
  slug: 'dashboard',
  branding: { accent: '#7aa2f7', logo: '/logo.svg' }, // neutraler Fallback, falls die Config kein Branding setzt
  features: { hasTickets: true, hasQuality: true },
  labels: { ticket: { one: 'Ticket', many: 'Tickets', short: 'Ticket' } },
  answers: {},
};

const ProjectContext = createContext(DEFAULT_PROJECT);

export const useProject = () => useContext(ProjectContext);

/** Kurzform für die Flags – der mit Abstand häufigste Zugriff. */
export function useFeatures() {
  return useContext(ProjectContext).features;
}

/** Begriffe der zweiten Conversion-Stufe ("VIP-Ticket" / "Tickets" / "VIP"). */
export function useTicketLabels() {
  return useContext(ProjectContext).labels.ticket;
}

/** "#f4cf57" -> [244, 207, 87]; akzeptiert auch Kurzform "#abc". */
function hexToRgb(hex) {
  let h = String(hex || '').trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
const toHex = (rgb) => '#' + rgb.map((c) => clamp(c).toString(16).padStart(2, '0')).join('');
/** Richtung ratio: 1 = Weiß, 0 = Schwarz. */
const mix = (rgb, target, ratio) => rgb.map((c) => c + (target - c) * ratio);

/**
 * Setzt die CSS-Variablen für die Akzentfarbe. styles.css arbeitet mit
 * --accent-rgb für alle Transparenz-Töne (Linien, Glow, Verläufe), daher
 * reichen diese sechs Variablen, um das komplette Theme umzufärben.
 */
export function applyAccent(accent, gradient) {
  const rgb = hexToRgb(accent);
  if (!rgb) return;
  const root = document.documentElement;
  root.style.setProperty('--accent-rgb', rgb.join(', '));
  root.style.setProperty('--accent', toHex(rgb));
  root.style.setProperty('--accent-2', toHex(mix(rgb, 255, 0.34)));
  root.style.setProperty('--accent-hover', toHex(mix(rgb, 255, 0.34)));
  root.style.setProperty('--accent-ink', toHex(mix(rgb, 255, 0.46)));
  root.style.setProperty('--accent-deep', toHex(mix(rgb, 0, 0.28)));

  // Verlauf: eigene Farbstopps aus branding.gradient, sonst hell -> Akzent -> dunkel
  const stops = (Array.isArray(gradient) ? gradient : []).map(hexToRgb).filter(Boolean);
  const grad = stops.length >= 2
    ? `linear-gradient(135deg, ${stops.map((c, i) => `${toHex(c)} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ')})`
    : 'linear-gradient(135deg, var(--accent-2), var(--accent) 55%, var(--accent-deep))';
  root.style.setProperty('--accent-grad', grad);
  // Text auf Akzentflächen: dunkel auf hellen Akzenten (Gold, Gelb), weiß auf
  // kräftigen/dunklen (Rot, Blau). Maßgeblich ist die Mitte des Verlaufs.
  const mid = stops.length >= 2 ? stops[Math.floor((stops.length - 1) / 2)] : rgb;
  root.style.setProperty('--on-accent', luminance(mid) > 0.45 ? '#141005' : '#ffffff');
}

/** Relative Helligkeit nach WCAG (0 = schwarz, 1 = weiß). */
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Hintergrund aus branding.background. Alle Flächen (Panels, Sidebar, Topbar,
 * Eingabefelder) leiten sich davon ab, damit ein Wert das ganze Theme trägt.
 */
export function applyBackground(background) {
  const rgb = hexToRgb(background);
  if (!rgb) return;
  const root = document.documentElement;
  root.style.setProperty('--bg', toHex(rgb));
  root.style.setProperty('--bg-rgb', rgb.map(clamp).join(', '));
  root.style.setProperty('--deep-rgb', mix(rgb, 0, 0.5).map(clamp).join(', '));
  root.style.setProperty('--bg-2', toHex(mix(rgb, 255, 0.02)));
  root.style.setProperty('--bg-elevated', toHex(mix(rgb, 255, 0.04)));
  root.style.setProperty('--panel-rgb', mix(rgb, 255, 0.055).map(clamp).join(', '));
  root.style.setProperty('--panel-solid', toHex(mix(rgb, 255, 0.055)));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', toHex(rgb));
}

export function ProjectProvider({ project, children }) {
  const value = useMemo(() => {
    const p = project || {};
    return {
      ...DEFAULT_PROJECT,
      ...p,
      branding: { ...DEFAULT_PROJECT.branding, ...(p.branding || {}) },
      features: { ...DEFAULT_PROJECT.features, ...(p.features || {}) },
      labels: { ticket: { ...DEFAULT_PROJECT.labels.ticket, ...((p.labels || {}).ticket || {}) } },
      answers: p.answers || {},
    };
  }, [project]);

  useEffect(() => {
    applyBackground(value.branding.background);
    applyAccent(value.branding.accent, value.branding.gradient);
    document.title = `${value.name} · ${value.subtitle}`;
    if (value.branding.logo) {
      for (const link of document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) {
        link.setAttribute('href', value.branding.logo);
        link.removeAttribute('type'); // PNG-Logo statt des SVG-Platzhalters
      }
    }
  }, [value]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
