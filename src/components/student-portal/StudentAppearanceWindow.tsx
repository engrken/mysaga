"use client";

import { useState, type CSSProperties } from "react";
import type { StudentPortalPreferences } from "./types";
import DraggableGlassWindow from "./DraggableGlassWindow";
import PortalCustomizer from "./PortalCustomizer";

export default function StudentAppearanceWindow({
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
  const [minimized, setMinimized] = useState(false);
  const [front, setFront] = useState(false);

  const updatePosition = (panelPosition: StudentPortalPreferences["panelPosition"]) => {
    onChange({ ...preferences, panelPosition });
  };
  const minimizePanel = () => {
    setMinimized(true);
    if (requested) onRequestHandled();
  };
  const expandPanel = () => {
    setMinimized(false);
    setFront(true);
    if (requested) onRequestHandled();
  };

  return <div
    id="student-appearance-window-host"
    className="student-appearance-window-host"
    style={{ "--student-panel-z": front ? 125 : 96 } as CSSProperties}
  >
    <DraggableGlassWindow
      key={`appearance-${preferences.panelPosition.x}:${preferences.panelPosition.y}`}
      title="Customize appearance"
      minimizedLabel="Customize appearance"
      minimized={minimized && !requested}
      onMinimize={minimizePanel}
      onExpand={expandPanel}
      position={preferences.panelPosition}
      onPositionChange={updatePosition}
      onActivate={() => setFront(true)}
    >
      <PortalCustomizer preferences={preferences} onChange={onChange} onReset={onReset}/>
      <p className="student-appearance-window-note">
        {demoMode
          ? "Demo changes are temporary and stay in this session."
          : "Your choices are saved in this browser for your student account."}
      </p>
    </DraggableGlassWindow>
  </div>;
}
