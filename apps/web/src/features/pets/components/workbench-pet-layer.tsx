import type { WorkbenchPetDescriptor, WorkbenchPetSettings } from "@codexly/protocol";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { useAccess } from "../../access/access-context.js";
import { useProjectActivity, useProjectData } from "../../projects/project-context.js";
import { useTranslation } from "../../../i18n/i18n.js";
import { deriveWorkbenchPetActivity, type WorkbenchPetActivity } from "../pet-activity.js";
import { petCatalogQueryOptions } from "../pet-catalog-query.js";
import {
  DEFAULT_PET_POSITION,
  clampPetPosition,
  petPositionFromRatio,
  petPositionToRatio,
  readPetPositionPreference,
  writePetPositionPreference,
  type PetPixelPosition,
  type PetPositionBounds,
  type PetPositionPreference,
} from "../pet-position-preference.js";
import { WorkbenchPetCanvas } from "./workbench-pet-canvas.js";
import { WorkbenchPetBubbles } from "./workbench-pet-bubbles.js";

const DRAG_DIRECTION_THRESHOLD = 4;

function introDuration(pet: WorkbenchPetDescriptor, animationName: string): number {
  const animation = pet.animations[animationName];
  if (animation === undefined) return 0;
  const end = animation.loopStart ?? animation.frames.length;
  return animation.frames.slice(0, end).reduce((total, frame) => total + frame.durationMs, 0);
}

function applyPosition(element: HTMLElement, position: PetPixelPosition): void {
  element.style.transform = `translate3d(${String(position.x)}px, ${String(position.y)}px, 0)`;
}

function bubblesNeedBelow(position: PetPixelPosition, bounds: PetPositionBounds): boolean {
  return position.y < Math.min(160, bounds.height * 0.4);
}

interface DragState {
  bounds: PetPositionBounds;
  directionChosen: boolean;
  origin: PetPixelPosition;
  pointerId: number;
  startX: number;
  startY: number;
}

export function WorkbenchPetLayerView({
  activity,
  localAccess,
  onTaskSelect,
  pet,
}: Readonly<{
  activity: WorkbenchPetActivity;
  localAccess: boolean;
  onTaskSelect: (projectId: string, taskId: string) => void;
  pet: WorkbenchPetDescriptor;
}>) {
  const { t } = useTranslation("workbench");
  const boundaryRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  const positionerRef = useRef<HTMLDivElement>(null);
  const boundsRef = useRef<PetPositionBounds | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPositionRef = useRef<PetPixelPosition | null>(null);
  const positionRef = useRef<PetPixelPosition>({ x: 0, y: 0 });
  const preferenceRef = useRef<PetPositionPreference>(DEFAULT_PET_POSITION);
  const rafRef = useRef<number | null>(null);
  const baseAnimationRef = useRef(activity.animationName);
  const [animationName, setAnimationName] = useState<string>(activity.animationName);
  const [bubblesBelow, setBubblesBelow] = useState(false);
  const [positionReady, setPositionReady] = useState(false);

  useEffect(() => {
    baseAnimationRef.current = activity.animationName;
    if (dragRef.current === null && jumpTimerRef.current === null) {
      setAnimationName(activity.animationName);
    }
  }, [activity.animationName]);

  useEffect(() => {
    const boundary = boundaryRef.current;
    const positioner = positionerRef.current;
    if (boundary === null || positioner === null) return;
    preferenceRef.current = readPetPositionPreference(window.localStorage);
    const updateBounds = () => {
      const bounds = {
        height: boundary.clientHeight,
        petHeight: positioner.offsetHeight,
        petWidth: positioner.offsetWidth,
        width: boundary.clientWidth,
      };
      boundsRef.current = bounds;
      positionRef.current = petPositionFromRatio(preferenceRef.current, bounds);
      applyPosition(positioner, positionRef.current);
      setBubblesBelow(bubblesNeedBelow(positionRef.current, bounds));
      setPositionReady(true);
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(boundary);
    observer.observe(positioner);
    return () => {
      observer.disconnect();
    };
  }, [pet.assetId]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current);
      const positioner = positionerRef.current;
      const pending = pendingPositionRef.current;
      const bounds = boundsRef.current;
      if (positioner !== null && pending !== null) {
        positionRef.current = pending;
        applyPosition(positioner, pending);
      }
      if (bounds !== null) {
        const preference = petPositionToRatio(positionRef.current, bounds);
        writePetPositionPreference(window.localStorage, preference);
      }
    },
    [],
  );

  const commitPendingPosition = () => {
    rafRef.current = null;
    const positioner = positionerRef.current;
    const pending = pendingPositionRef.current;
    if (positioner === null || pending === null) return;
    pendingPositionRef.current = null;
    positionRef.current = pending;
    applyPosition(positioner, pending);
  };

  const schedulePosition = (position: PetPixelPosition) => {
    pendingPositionRef.current = position;
    rafRef.current ??= requestAnimationFrame(commitPendingPosition);
  };

  const saveCurrentPosition = () => {
    const bounds = boundsRef.current;
    if (bounds === null) return;
    preferenceRef.current = petPositionToRatio(positionRef.current, bounds);
    writePetPositionPreference(window.localStorage, preferenceRef.current);
  };

  const finishDrag = (pointerId: number) => {
    const handle = handleRef.current;
    if (dragRef.current?.pointerId !== pointerId || handle === null) return;
    dragRef.current = null;
    handle.removeAttribute("data-dragging");
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    commitPendingPosition();
    saveCurrentPosition();
    const bounds = boundsRef.current;
    if (bounds !== null) setBubblesBelow(bubblesNeedBelow(positionRef.current, bounds));
    setAnimationName("jumping");
    if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current);
    jumpTimerRef.current = setTimeout(
      () => {
        jumpTimerRef.current = null;
        setAnimationName(baseAnimationRef.current);
      },
      Math.max(1, introDuration(pet, "jumping")),
    );
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    const positioner = positionerRef.current;
    const boundary = boundaryRef.current;
    if (positioner === null || boundary === null) return;
    const bounds = {
      height: boundary.clientHeight,
      petHeight: positioner.offsetHeight,
      petWidth: positioner.offsetWidth,
      width: boundary.clientWidth,
    };
    boundsRef.current = bounds;
    dragRef.current = {
      bounds,
      directionChosen: false,
      origin: positionRef.current,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.setAttribute("data-dragging", "");
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    schedulePosition(
      clampPetPosition({ x: drag.origin.x + deltaX, y: drag.origin.y + deltaY }, drag.bounds),
    );
    if (!drag.directionChosen && Math.abs(deltaX) >= DRAG_DIRECTION_THRESHOLD) {
      drag.directionChosen = true;
      setAnimationName(deltaX < 0 ? "running-left" : "running-right");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const bounds = boundsRef.current;
    const positioner = positionerRef.current;
    if (bounds === null || positioner === null) return;
    if (event.key === "Home") {
      event.preventDefault();
      preferenceRef.current = DEFAULT_PET_POSITION;
      positionRef.current = petPositionFromRatio(DEFAULT_PET_POSITION, bounds);
    } else if (["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      const step = event.shiftKey ? 24 : 8;
      positionRef.current = clampPetPosition(
        {
          x:
            positionRef.current.x +
            (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0),
          y:
            positionRef.current.y +
            (event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0),
        },
        bounds,
      );
    } else {
      return;
    }
    applyPosition(positioner, positionRef.current);
    saveCurrentPosition();
    setBubblesBelow(bubblesNeedBelow(positionRef.current, bounds));
  };

  return (
    <div className="workbench-pet-layer">
      <div className="workbench-pet-boundary" ref={boundaryRef}>
        <div
          className="workbench-pet-positioner"
          data-animation={animationName}
          ref={positionerRef}
          style={{ opacity: positionReady ? 1 : 0 }}
        >
          <WorkbenchPetBubbles
            localAccess={localAccess}
            onTaskSelect={onTaskSelect}
            placement={bubblesBelow ? "below" : "above"}
            tasks={activity.tasks}
          />
          <button
            aria-label={t("pet.move", { name: pet.displayName })}
            className="workbench-pet-target"
            onKeyDown={handleKeyDown}
            onLostPointerCapture={(event) => {
              finishDrag(event.pointerId);
            }}
            onPointerCancel={(event) => {
              finishDrag(event.pointerId);
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => {
              finishDrag(event.pointerId);
            }}
            ref={handleRef}
            type="button"
          >
            <WorkbenchPetCanvas animationName={animationName} pet={pet} />
          </button>
        </div>
      </div>
    </div>
  );
}

function EnabledWorkbenchPetLayer({ petId }: Readonly<{ petId: string }>) {
  const access = useAccess();
  const { projects, tasks } = useProjectData();
  const { taskActivity } = useProjectActivity();
  const navigate = useNavigate();
  const catalog = useQuery(petCatalogQueryOptions());
  const activity = useMemo(
    () => deriveWorkbenchPetActivity(projects, tasks, taskActivity),
    [projects, taskActivity, tasks],
  );
  const pet = catalog.data?.data.find(
    (candidate) => candidate.id === petId && candidate.availability === "ready",
  );
  const handleTaskSelect = useCallback(
    (projectId: string, taskId: string) => {
      void navigate({ params: { projectId, taskId }, to: "/p/$projectId/t/$taskId" });
    },
    [navigate],
  );
  if (pet === undefined) return null;
  return (
    <WorkbenchPetLayerView
      activity={activity}
      localAccess={access.status?.mode === "local"}
      onTaskSelect={handleTaskSelect}
      pet={pet}
    />
  );
}

export function WorkbenchPetLayer({
  settings,
}: Readonly<{ settings: WorkbenchPetSettings | undefined }>) {
  if (settings?.enabled !== true) return null;
  return <EnabledWorkbenchPetLayer petId={settings.selectedPetId} />;
}
