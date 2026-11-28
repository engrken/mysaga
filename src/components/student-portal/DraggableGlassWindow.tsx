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
  const [dragPosition, setDragPosition] = useState<Position | null>(null);
  const dragPositionRef = useRef<Position | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });
  const dragPointer = useRef<number | null>(null);

  useEffect(() => {
    if (minimized || typeof window === "undefined") return;
    const compactQuery = window.matchMedia("(max-width: 767px), (pointer: coarse)");
    const body = document.body;
    const html = document.documentElement;
    let savedScrollY: number | null = null;
    let previousBodyStyles: { position: string; top: string; width: string; overflow: string; overscrollBehavior: string } | null = null;
    let previousHtmlOverflow = "";

    const unlock = () => {
      if (savedScrollY === null || !previousBodyStyles) return;
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      body.style.overscrollBehavior = previousBodyStyles.overscrollBehavior;
      html.style.overflow = previousHtmlOverflow;
      const restoreY = savedScrollY;
      savedScrollY = null;
      previousBodyStyles = null;
      window.scrollTo(0, restoreY);
    };

    const syncScrollLock = () => {
      if (!compactQuery.matches) {
        unlock();
        return;
      }
      if (savedScrollY !== null) return;
      savedScrollY = window.scrollY;
      previousBodyStyles = {
        position: body.style.position,
        top: body.style.top,
        width: body.style.width,
        overflow: body.style.overflow,
        overscrollBehavior: body.style.overscrollBehavior
      };
      previousHtmlOverflow = html.style.overflow;
      body.style.position = "fixed";
      body.style.top = `-${savedScrollY}px`;
      body.style.width = "100%";
      body.style.overflow = "hidden";
      body.style.overscrollBehavior = "none";
      html.style.overflow = "hidden";
    };

    syncScrollLock();
    if (typeof compactQuery.addEventListener === "function") {
      compactQuery.addEventListener("change", syncScrollLock);
    } else {
      compactQuery.addListener(syncScrollLock);
    }
    return () => {
      if (typeof compactQuery.removeEventListener === "function") {
        compactQuery.removeEventListener("change", syncScrollLock);
      } else {
        compactQuery.removeListener(syncScrollLock);
      }
      unlock();
    };
  }, [minimized]);

  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (minimized || event.pointerType !== "mouse" || window.matchMedia("(max-width: 1180px), (pointer: coarse)").matches) return;
    if ((event.target as HTMLElement).closest("button[data-window-action]")) return;
    const inPortal = Boolean(document.querySelector(".portal-layout"));
    const rawX = position.x || (inPortal && window.innerWidth >= 1181 ? getDefaultPanelX() : Math.max(12, window.innerWidth - 356));
    const layoutRoot = document.querySelector(".portal-layout");
    const configuredTop = layoutRoot
      ? Number.parseFloat(getComputedStyle(layoutRoot).getPropertyValue("--student-panel-default-top"))
      : Number.NaN;
    const rawY = position.y || (Number.isFinite(configuredTop) ? configuredTop : 116);
    const currentX = clampPanelX(rawX);
    const currentY = clampPanelY(rawY, inPortal);
    dragOffset.current = { x: event.clientX - currentX, y: event.clientY - currentY };
    dragPointer.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startPosition = { x: currentX, y: currentY };
    dragPositionRef.current = startPosition;
    setDragPosition(startPosition);
    setDragging(true);
  };

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragPointer.current !== event.pointerId || minimized) return;
    const inPortal = Boolean(document.querySelector(".portal-layout"));
    const nextPosition = {
      x: clampPanelX(event.clientX - dragOffset.current.x),
      y: clampPanelY(event.clientY - dragOffset.current.y, inPortal)
    };
    dragPositionRef.current = nextPosition;
    setDragPosition(nextPosition);
  };

  const endDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (dragPointer.current !== event.pointerId) return;
    dragPointer.current = null;
    const finalPosition = dragPositionRef.current ?? position;
    dragPositionRef.current = null;
    setDragPosition(null);
    setDragging(false);
    onPositionChange(finalPosition);
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
  const activePosition = dragging && dragPosition ? dragPosition : position;
  const visiblePosition = typeof window === "undefined" ? activePosition : {
    x: activePosition.x > 0
      ? clampPanelX(activePosition.x)
      : inPortal && window.innerWidth >= 1181 ? getDefaultPanelX() : 0,
    y: activePosition.y > 0 ? clampPanelY(activePosition.y, inPortal) : 0
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
        <button type="button" className="student-window-minimize" data-window-action="minimize" onClick={onMinimize} aria-label={`Close ${title.toLowerCase()}`} title="Close panel">×</button>
      </header>
      <div className="student-floating-window-body">{children}</div>
    </section>
  </>;
}
