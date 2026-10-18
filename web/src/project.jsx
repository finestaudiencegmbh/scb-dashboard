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
  branding: { accent: '#d0bb5a', logo: '/logo.svg' },
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
export function applyAccent(accent) {
  const rgb = hexToRgb(accent);
  if (!rgb) return;
  const root = document.documentElement;
  root.style.setProperty('--accent-rgb', rgb.join(', '));
  root.style.setProperty('--accent', toHex(rgb));
  root.style.setProperty('--accent-2', toHex(mix(rgb, 255, 0.34)));
  root.style.setProperty('--accent-hover', toHex(mix(rgb, 255, 0.34)));
  root.style.setProperty('--accent-ink', toHex(mix(rgb, 255, 0.46)));
  root.style.setProperty('--accent-deep', toHex(mix(rgb, 0, 0.28)));
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
    applyAccent(value.branding.accent);
    document.title = `${value.name} · ${value.subtitle}`;
    const icon = document.querySelector('link[rel="icon"]');
    if (icon && value.branding.logo) icon.setAttribute('href', value.branding.logo);
  }, [value]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}
