"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";

type Position = { x: number; y: number };

export default function DraggableGlassWindow({
  title,
  minimized,
  onMinimize,
  onExpand,
  position,
  onPositionChange,
  onActivate,
  children
}: {
  title: string;
  minimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  position: Position;
  onPositionChange: (position: Position) => void;
  onActivate: () => void;
  children: ReactNode;
}) {
  const [dragging, setDragging] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(position);
  const currentPositionRef = useRef(position);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragPointer = useRef<number | null>(null);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (minimized || window.matchMedia("(max-width: 767px)").matches) return;
    if ((event.target as HTMLElement).closest("button[data-window-action]")) return;
    const currentX = currentPositionRef.current.x || Math.max(12, window.innerWidth - 356);
    const layoutRoot = document.querySelector(".portal-layout");
    const configuredTop = layoutRoot ? Number.parseFloat(getComputedStyle(layoutRoot).getPropertyValue("--student-panel-default-top")) : Number.NaN;
    const currentY = currentPositionRef.current.y || (Number.isFinite(configuredTop) ? configuredTop : 116);
    dragOffset.current = { x: event.clientX - currentX, y: event.clientY - currentY };
    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startPosition = { x: currentX, y: currentY };
    currentPositionRef.current = startPosition;
    setCurrentPosition(startPosition);
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragPointer.current !== event.pointerId || minimized) return;
    const width = 320;
    const estimatedHeight = Math.min(window.innerHeight - 24, 620);
    const x = Math.max(12, Math.min(window.innerWidth - width - 12, event.clientX - dragOffset.current.x));
    const y = Math.max(82, Math.min(window.innerHeight - estimatedHeight, event.clientY - dragOffset.current.y));
    const nextPosition = { x, y };
    currentPositionRef.current = nextPosition;
    setCurrentPosition(nextPosition);
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragPointer.current !== event.pointerId) return;
    dragPointer.current = null;
    setDragging(false);
    onPositionChange(currentPositionRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (minimized) {
    return <button type="button" className="student-glass-dock-pill" onClick={onExpand} aria-label="Expand student quick panel">
      <span className="student-glass-dock-icon" aria-hidden="true">✦</span>
      <span>Quick panel</span>
      <span className="student-glass-dock-chevron" aria-hidden="true">↗</span>
    </button>;
  }

  return <section
    className={`student-floating-window${dragging ? " is-dragging" : ""}`}
    style={{ left: currentPosition.x > 0 ? currentPosition.x : "auto", right: currentPosition.x > 0 ? "auto" : 18, top: currentPosition.y > 0 ? currentPosition.y : "var(--student-panel-default-top, 116px)" }}
    aria-label={title}
    onPointerDownCapture={onActivate}
  >
    <header className="student-floating-window-head">
      <button
        type="button"
        className="student-window-drag-handle"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        aria-label="Drag quick panel"
        title="Drag to move"
      >
        <span className="student-window-grip" aria-hidden="true">⠿</span>
        <span>{title}</span>
        <span className="student-window-drag-hint">MOVE</span>
      </button>
      <button type="button" className="student-window-minimize" data-window-action="minimize" onClick={onMinimize} aria-label="Minimize quick panel">−</button>
    </header>
    <div className="student-floating-window-body">{children}</div>
  </section>;
}
