import type { Project } from "@code-agent/protocol";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent } from "react";

import { useTranslation } from "../../../i18n/i18n.js";

const PROJECT_REORDER_MOVEMENT_TOLERANCE_PX = 8;

type ProjectPlacement = "after" | "before";

interface ProjectPressSession {
  activated: boolean;
  element: HTMLElement;
  pointerId: number;
  projectId: string;
  removeGlobalListeners: () => void;
  startClientX: number;
  startClientY: number;
}

type UseProjectReorderingOptions = Readonly<{
  disabled?: boolean;
  onReorder: (projectIds: readonly string[]) => Promise<boolean>;
  projects: readonly Project[];
}>;

export function moveProject(
  projectIds: readonly string[],
  movingProjectId: string,
  targetProjectId: string,
  placement: ProjectPlacement,
): readonly string[] {
  if (movingProjectId === targetProjectId || !projectIds.includes(movingProjectId)) {
    return projectIds;
  }
  const remainingProjectIds = projectIds.filter((projectId) => projectId !== movingProjectId);
  const targetIndex = remainingProjectIds.indexOf(targetProjectId);
  if (targetIndex === -1) {
    return projectIds;
  }
  const insertionIndex = placement === "after" ? targetIndex + 1 : targetIndex;
  return remainingProjectIds.toSpliced(insertionIndex, 0, movingProjectId);
}

export function moveProjectByOffset(
  projectIds: readonly string[],
  movingProjectId: string,
  offset: -1 | 1,
): readonly string[] {
  const currentIndex = projectIds.indexOf(movingProjectId);
  const targetIndex = currentIndex + offset;
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= projectIds.length) {
    return projectIds;
  }
  return projectIds.toSpliced(currentIndex, 1).toSpliced(targetIndex, 0, movingProjectId);
}

function orderProjectsByIds(
  projects: readonly Project[],
  projectIds: readonly string[] | null,
): readonly Project[] {
  if (projectIds === null) {
    return projects;
  }
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const orderedProjects = projectIds.flatMap((projectId) => {
    const project = projectById.get(projectId);
    return project === undefined ? [] : [project];
  });
  const orderedProjectIds = new Set(orderedProjects.map((project) => project.id));
  return [...orderedProjects, ...projects.filter((project) => !orderedProjectIds.has(project.id))];
}

export function useProjectReordering({
  disabled = false,
  onReorder,
  projects,
}: UseProjectReorderingOptions) {
  const { t } = useTranslation("conversation");
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [transientProjectIds, setTransientProjectIds] = useState<readonly string[] | null>(null);
  const pressSessionRef = useRef<ProjectPressSession | null>(null);
  const suppressClickProjectIdRef = useRef<string | null>(null);
  const orderedProjects = orderProjectsByIds(projects, transientProjectIds);
  const orderedProjectsRef = useRef(orderedProjects);
  orderedProjectsRef.current = orderedProjects;

  const clearPressSession = (releasePointer: boolean) => {
    const session = pressSessionRef.current;
    if (session === null) {
      return;
    }
    session.removeGlobalListeners();
    if (releasePointer && session.element.hasPointerCapture(session.pointerId)) {
      session.element.releasePointerCapture(session.pointerId);
    }
    pressSessionRef.current = null;
  };

  useEffect(
    () => () => {
      // Sidebar 卸载时清理全局指针监听，避免残留拖动会话。
      clearPressSession(false);
    },
    [],
  );

  const commitOrder = async (projectIds: readonly string[], movedProjectId: string) => {
    const succeeded = await onReorder(projectIds);
    setTransientProjectIds(null);
    if (succeeded) {
      const movedProject = projects.find((project) => project.id === movedProjectId);
      const position = projectIds.indexOf(movedProjectId) + 1;
      setAnnouncement(
        t("reorder.moved", {
          name: movedProject?.name ?? t("reorder.projectFallback"),
          position,
        }),
      );
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>, projectId: string) => {
    if (disabled || event.button !== 0) {
      return;
    }
    clearPressSession(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    const element = event.currentTarget;
    const handleGlobalPointerUp = (pointerEvent: globalThis.PointerEvent) => {
      finishPointerSession(pointerEvent.pointerId);
    };
    const handleGlobalPointerCancel = (pointerEvent: globalThis.PointerEvent) => {
      cancelPointerSession(pointerEvent.pointerId);
    };
    const session: ProjectPressSession = {
      activated: false,
      element,
      pointerId: event.pointerId,
      projectId,
      removeGlobalListeners: () => {
        window.removeEventListener("pointercancel", handleGlobalPointerCancel);
        window.removeEventListener("pointerup", handleGlobalPointerUp);
      },
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
    pressSessionRef.current = session;
    // 指针释放可能发生在 Project 行之外，Window 兜底保证排序总能提交或取消。
    window.addEventListener("pointercancel", handleGlobalPointerCancel);
    window.addEventListener("pointerup", handleGlobalPointerUp);
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const session = pressSessionRef.current;
    if (session?.pointerId !== event.pointerId) {
      return;
    }
    const movement = Math.hypot(
      event.clientX - session.startClientX,
      event.clientY - session.startClientY,
    );
    if (!session.activated) {
      if (movement <= PROJECT_REORDER_MOVEMENT_TOLERANCE_PX) {
        return;
      }

      // 移动超过点击容差后才认定为拖拽，避免等待固定长按时间。
      session.activated = true;
      if (session.element.hasPointerCapture(session.pointerId)) {
        session.element.releasePointerCapture(session.pointerId);
      }
      setTransientProjectIds(orderedProjectsRef.current.map((project) => project.id));
      setActiveProjectId(session.projectId);
      setAnnouncement(t("reorder.started"));
    }

    event.preventDefault();
    const targetElement =
      document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("[data-project-reorder-id]") ?? null;
    if (targetElement === null) {
      return;
    }
    const targetProjectId = targetElement.dataset["projectReorderId"];
    if (targetProjectId === undefined) {
      return;
    }
    const targetBounds = targetElement.getBoundingClientRect();
    const placement =
      event.clientY < targetBounds.top + targetBounds.height / 2 ? "before" : "after";
    setTransientProjectIds((currentProjectIds) =>
      currentProjectIds === null
        ? currentProjectIds
        : moveProject(currentProjectIds, session.projectId, targetProjectId, placement),
    );
  };

  const finishPointerSession = (pointerId: number) => {
    const session = pressSessionRef.current;
    if (session?.pointerId !== pointerId) {
      return;
    }
    const wasActivated = session.activated;
    clearPressSession(true);
    if (!wasActivated) {
      return;
    }
    suppressClickProjectIdRef.current = session.projectId;
    setActiveProjectId(null);
    const projectIds = orderedProjectsRef.current.map((project) => project.id);
    void commitOrder(projectIds, session.projectId);
  };

  const cancelPointerSession = (pointerId: number) => {
    const session = pressSessionRef.current;
    if (session?.pointerId !== pointerId) {
      return;
    }
    clearPressSession(false);
    setActiveProjectId(null);
    setTransientProjectIds(null);
    setAnnouncement(t("reorder.cancelled"));
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    finishPointerSession(event.pointerId);
  };

  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    cancelPointerSession(event.pointerId);
  };

  const handleClickCapture = (event: ReactMouseEvent<HTMLElement>, projectId: string) => {
    if (suppressClickProjectIdRef.current !== projectId) {
      return;
    }
    suppressClickProjectIdRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, projectId: string) => {
    if (disabled || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }
    event.preventDefault();
    const currentProjectIds = orderedProjectsRef.current.map((project) => project.id);
    const reorderedProjectIds = moveProjectByOffset(
      currentProjectIds,
      projectId,
      event.key === "ArrowUp" ? -1 : 1,
    );
    if (reorderedProjectIds === currentProjectIds) {
      return;
    }
    setTransientProjectIds(reorderedProjectIds);
    void commitOrder(reorderedProjectIds, projectId);
  };

  return {
    activeProjectId,
    announcement,
    getProjectReorderProps: (projectId: string) => {
      return {
        "aria-keyshortcuts": "Alt+ArrowUp Alt+ArrowDown",
        "data-project-reorder-id": projectId,
        onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
          handleClickCapture(event, projectId);
        },
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          handleKeyDown(event, projectId);
        },
        onPointerCancel: handlePointerCancel,
        onPointerDown: (event: PointerEvent<HTMLElement>) => {
          handlePointerDown(event, projectId);
        },
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
        title: t("reorder.title"),
      };
    },
    orderedProjects,
  };
}
