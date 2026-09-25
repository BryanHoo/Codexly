import { invoke } from "./native-invoke.js";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  DesktopPetDragStrategy,
  DesktopPetPosition,
  DesktopPetState,
  DesktopPetTaskOpen,
} from "../../protocol/desktop-pet.js";
import type { WorkbenchPetDescriptor } from "../../protocol/index.js";
import {
  mapNativePet,
  type NativePetCatalogResponse,
} from "./workbench-pet-catalog.js";

const DESKTOP_PET_STATE_EVENT = "desktop-pet://state";
const DESKTOP_PET_MOVED_EVENT = "desktop-pet://moved";

export async function configureDesktopPet(petId: string | null): Promise<void> {
  await invoke("configure_desktop_pet", { petId });
}

export async function getDesktopPetState(): Promise<DesktopPetState | null> {
  return invoke<DesktopPetState | null>("get_desktop_pet_state");
}

export async function listenDesktopPetState(
  listener: (state: DesktopPetState) => void,
): Promise<UnlistenFn> {
  return listen<DesktopPetState>(DESKTOP_PET_STATE_EVENT, (event) => {
    listener(event.payload);
  });
}

export async function listenDesktopPetMoved(
  listener: (position: DesktopPetPosition) => void,
): Promise<UnlistenFn> {
  return listen<DesktopPetPosition>(DESKTOP_PET_MOVED_EVENT, (event) => {
    listener(event.payload);
  });
}

export async function loadDesktopPet(petId: string): Promise<WorkbenchPetDescriptor | null> {
  const response = await invoke<NativePetCatalogResponse>("list_workbench_pets");
  const record = response.data.find((pet) => pet.id === petId && pet.availability === "ready");
  return record === undefined ? null : mapNativePet(record);
}

export async function showDesktopPet(): Promise<void> {
  await invoke("show_desktop_pet");
}

export async function getDesktopPetPosition(): Promise<DesktopPetPosition> {
  return invoke<DesktopPetPosition>("get_desktop_pet_position");
}

export async function getDesktopPetDragStrategy(): Promise<DesktopPetDragStrategy> {
  return invoke<DesktopPetDragStrategy>("get_desktop_pet_drag_strategy");
}

export async function layoutDesktopPet(bubbleHeight: number): Promise<void> {
  await invoke("layout_desktop_pet", { bubbleHeight });
}

export async function openDesktopPetTask(target: DesktopPetTaskOpen): Promise<void> {
  await invoke("open_desktop_pet_task", target);
}

export async function setDesktopPetDragPosition(position: DesktopPetPosition): Promise<void> {
  await invoke("set_desktop_pet_drag_position", position);
}

export async function startDesktopPetNativeDrag(): Promise<void> {
  await invoke("start_desktop_pet_native_drag");
}

export async function moveDesktopPet(input: Readonly<{
  deltaX: number;
  deltaY: number;
  reset: boolean;
}>): Promise<void> {
  await invoke("move_desktop_pet", input);
}
