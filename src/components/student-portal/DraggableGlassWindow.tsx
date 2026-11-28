"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";

type Position = { x: number; y: number };
const WINDOW_WIDTH = 320;

function getPortalRightEdge() {
  const content = document.querySelector(".portal-layout .content-wrap");
  return content?.getBoundingClientRect().right ?? window.innerWidth;
}

function getDefaultPanelX() {
  return Math.max(12, getPortalRightEdge() - WINDOW_WIDTH - 18);
}

function clampPanelX(value: number) {
  if (window.innerWidth < 1181) {
    return Math.max(12, Math.min(window.innerWidth - WINDOW_WIDTH - 12, value));
  }
  const rightEdge = getPortalRightEdge();
  const minX = Math.max(12, rightEdge - 370);
  const maxX = Math.max(minX, rightEdge - WINDOW_WIDTH - 12);
  return Math.max(minX, Math.min(maxX, value));
}

function clampPanelY(value: number, inPortal: boolean) {
  const pageHeader = inPortal ? document.querySelector(".student-portal-topbar") : null;
  const headerBottom = pageHeader?.getBoundingClientRect().bottom ?? 164;
  const minY = inPortal ? Math.max(176, headerBottom + 16) : 82;
  const estimatedHeight = Math.min(window.innerHeight * 0.76, Math.max(240, window.innerHeight - 210), 650);
  const maxY = Math.max(minY, window.innerHeight - estimatedHeight - 12);
  return Math.max(minY, Math.min(maxY, value));
}

export default function DraggableGlassWindow({
  title,
  minimizedLabel = "Quick panel",
  minimized,
  onMinimize,
  onExpand,
  position,
  onPositionChange,
  onActivate,
  children
}: {
  title: string;
  minimizedLabel?: string;
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

  useEffect(() => {
    currentPositionRef.current = position;
    setCurrentPosition(position);
  }, [position.x, position.y]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (minimized || window.matchMedia("(max-width: 767px)").matches) return;
    if ((event.target as HTMLElement).closest("button[data-window-action]")) return;
    const rawX = currentPositionRef.current.x || (inPortal && window.innerWidth >= 1181 ? getDefaultPanelX() : Math.max(12, window.innerWidth - 356));
    const inPortal = Boolean(document.querySelector(".portal-layout"));
    const layoutRoot = document.querySelector(".portal-layout");
    const configuredTop = layoutRoot
      ? Number.parseFloat(getComputedStyle(layoutRoot).getPropertyValue("--student-panel-default-top"))
      : Number.NaN;
    const rawY = currentPositionRef.current.y || (Number.isFinite(configuredTop) ? configuredTop : 116);
    const currentX = clampPanelX(rawX);
    const currentY = clampPanelY(rawY, inPortal);
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
    const inPortal = Boolean(document.querySelector(".portal-layout"));
    const nextPosition = {
      x: clampPanelX(event.clientX - dragOffset.current.x),
      y: clampPanelY(event.clientY - dragOffset.current.y, inPortal)
    };
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
    return <button type="button" className="student-glass-dock-pill" onClick={onExpand} aria-label={`Expand ${minimizedLabel.toLowerCase()}`}>
      <span className="student-glass-dock-icon" aria-hidden="true">✦</span>
      <span>{minimizedLabel}</span>
      <span className="student-glass-dock-chevron" aria-hidden="true">↗</span>
    </button>;
  }

  const inPortal = typeof document !== "undefined" && Boolean(document.querySelector(".portal-layout"));
  const visiblePosition = typeof window === "undefined" ? currentPosition : {
    x: currentPosition.x > 0
      ? clampPanelX(currentPosition.x)
      : inPortal && window.innerWidth >= 1181 ? getDefaultPanelX() : 0,
    y: currentPosition.y > 0 ? clampPanelY(currentPosition.y, inPortal) : 0
  };

  return <>
    <button
      type="button"
      className="student-floating-window-backdrop"
      aria-label={`Close ${title.toLowerCase()}`}
      onClick={onMinimize}
    />
    <section
      className={`student-floating-window${dragging ? " is-dragging" : ""}`}
      style={{
        left: visiblePosition.x > 0 ? visiblePosition.x : "auto",
        right: visiblePosition.x > 0 ? "auto" : 18,
        top: visiblePosition.y > 0 ? visiblePosition.y : "var(--student-panel-default-top, 116px)"
      }}
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
          aria-label={`Drag ${title.toLowerCase()}`}
          title="Drag to move"
        >
          <span className="student-window-grip" aria-hidden="true">⠿</span>
          <span>{title}</span>
          <span className="student-window-drag-hint">MOVE</span>
        </button>
        <button type="button" className="student-window-minimize" data-window-action="minimize" onClick={onMinimize} aria-label={`Minimize ${title.toLowerCase()}`}>−</button>
      </header>
      <div className="student-floating-window-body">{children}</div>
    </section>
  </>;
}
