"use client";

import { useRef, useState, type PointerEvent, type ReactNode, type KeyboardEvent } from "react";
import type { StudentModulePosition } from "./types";

export default function DraggableGlassModule({
  title,
  enabled,
  position,
  onPositionChange,
  children
}: {
  title: string;
  enabled: boolean;
  position: StudentModulePosition;
  onPositionChange: (position: StudentModulePosition) => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(position);
  const [active, setActive] = useState(false);
  const offsetRef = useRef(position);
  const pointerRef = useRef<number | null>(null);
  const startRef = useRef({ x: 0, y: 0 });
  const originRef = useRef(position);
  const boundsRef = useRef({ left: 0, right: 0, top: 0, bottom: 0 });

  const begin = (event: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || window.matchMedia("(max-width: 767px)").matches) return;
    const element = event.currentTarget.closest(".student-draggable-module") as HTMLElement | null;
    const rect = element?.getBoundingClientRect();
    const base = offsetRef.current;
    pointerRef.current = event.pointerId;
    originRef.current = base;
    startRef.current = { x: event.clientX, y: event.clientY };
    if (rect) boundsRef.current = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(true);
  };

  const move = (event: PointerEvent<HTMLButtonElement>) => {
    if (!enabled || pointerRef.current !== event.pointerId) return;
    const element = event.currentTarget.closest(".student-draggable-module") as HTMLElement | null;
    const rect = element?.getBoundingClientRect();
    const dx = event.clientX - startRef.current.x;
    const dy = event.clientY - startRef.current.y;
    const bounds = boundsRef.current;
    const minX = rect ? Math.min(0, 12 - bounds.left) : -600;
    const maxX = rect ? Math.max(0, window.innerWidth - bounds.right - 12) : 600;
    const minY = rect ? Math.min(0, 82 - bounds.top) : -400;
    const maxY = rect ? Math.max(0, window.innerHeight - bounds.bottom - 12) : 600;
    const next = {
      x: Math.max(-600, Math.min(600, originRef.current.x + Math.max(minX, Math.min(maxX, dx)))),
      y: Math.max(-400, Math.min(600, originRef.current.y + Math.max(minY, Math.min(maxY, dy))))
    };
    offsetRef.current = next;
    setOffset(next);
  };

  const end = (event: PointerEvent<HTMLButtonElement>) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setActive(false);
    onPositionChange(offsetRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!enabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 24 : 8;
    const next = {
      x: Math.max(-600, Math.min(600, offsetRef.current.x + (event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0))),
      y: Math.max(-400, Math.min(600, offsetRef.current.y + (event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0)))
    };
    offsetRef.current = next;
    setOffset(next);
    onPositionChange(next);
  };

  return <section
    className={`student-draggable-module${enabled ? " is-freeform" : ""}${active ? " is-module-active" : ""}`}
    style={enabled ? { transform: `translate3d(${offset.x}px,${offset.y}px,0)` } : undefined}
  >
    {enabled && <button
      type="button"
      className="student-module-drag-handle"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={nudge}
      aria-label={`Move ${title} module. Use arrow keys to move it, hold Shift to move faster.`}
      title="Drag this module to reposition it"
    >
      <span aria-hidden="true">⠿</span>{title}<small>MOVE WINDOW</small>
    </button>}
    {children}
  </section>;
}
