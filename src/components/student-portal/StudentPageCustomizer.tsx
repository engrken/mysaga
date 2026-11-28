"use client";

import { useState } from "react";
import type { StudentPortalPreferences } from "./types";
import PortalCustomizer from "./PortalCustomizer";

export default function StudentPageCustomizer({
  preferences,
  onChange,
  onReset,
  requested,
  onRequestHandled,
  demoMode = false
}: {
  preferences: StudentPortalPreferences;
  onChange: (next: StudentPortalPreferences) => void;
  onReset: () => void;
  requested: boolean;
  onRequestHandled: () => void;
  demoMode?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const isOpen = requested || open;
  const close = () => {
    setOpen(false);
    if (requested) onRequestHandled();
  };

  return <section className="student-page-customizer" aria-label="Page appearance settings">
    <button
      type="button"
      className="student-page-customizer-trigger"
      aria-expanded={isOpen}
      aria-controls="student-page-customizer-panel"
      onClick={() => isOpen ? close() : setOpen(true)}
    >
      <span aria-hidden="true">✧</span>
      {isOpen ? "Close appearance settings" : "Customize appearance"}
    </button>
    {isOpen && <div className="student-page-customizer-panel" id="student-page-customizer-panel">
      <header>
        <div>
          <span className="student-spatial-eyebrow">STUDENT WORKSPACE</span>
          <h2>Personalize your portal</h2>
          <p>These appearance choices carry across Overview, Announcements, and Class Chats.</p>
        </div>
        <button type="button" className="student-page-customizer-close" onClick={close} aria-label="Close appearance settings">×</button>
      </header>
      <PortalCustomizer preferences={preferences} onChange={onChange} onReset={onReset}/>
      <p className="student-page-customizer-note">{demoMode ? "Demo changes are temporary and stay in this session." : "Your choices are saved in this browser for your student account."}</p>
    </div>}
  </section>;
}
