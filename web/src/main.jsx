import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { fetchConfig } from './api.js';
import { ProjectProvider, DEFAULT_PROJECT } from './project.jsx';
import './styles.css';

/**
 * Lädt zuerst die Projekt-Konfiguration (Branding/Flags) und rendert dann das
 * Dashboard. So stimmen Farbe, Logo und Begriffe ab dem ersten Frame – und die
 * Feature-Flags stehen fest, bevor irgendeine Tabelle gebaut wird.
 */
function Root() {
  const [project, setProject] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchConfig()
      .then((p) => alive && setProject(p))
      .catch(() => alive && setProject(DEFAULT_PROJECT)); // Server weg? Dann mit Defaults weiter.
    return () => { alive = false; };
  }, []);

  if (!project) return <div className="loader">Lade…</div>;

  return (
    <ProjectProvider project={project}>
      <App />
    </ProjectProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
