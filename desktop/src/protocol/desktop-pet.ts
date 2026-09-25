import { Type, type Static } from "@sinclair/typebox";

export const DesktopPetTaskSchema = Type.Object(
  {
    projectId: Type.String({ maxLength: 128, minLength: 1 }),
    rootPath: Type.Optional(Type.String({ maxLength: 4096, minLength: 1 })),
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("running"),
      Type.Literal("waiting"),
    ]),
    taskId: Type.String({ maxLength: 128, minLength: 1 }),
    taskName: Type.String({ maxLength: 512, minLength: 1 }),
  },
  { additionalProperties: false },
);

export const DesktopPetStateSchema = Type.Object(
  {
    animationName: Type.Union([
      Type.Literal("failed"),
      Type.Literal("idle"),
      Type.Literal("review"),
      Type.Literal("running"),
      Type.Literal("waiting"),
    ]),
    petId: Type.String({ maxLength: 128, minLength: 1 }),
    tasks: Type.Array(DesktopPetTaskSchema, { maxItems: 256 }),
  },
  { additionalProperties: false },
);

export type DesktopPetState = Readonly<Static<typeof DesktopPetStateSchema>>;
export type DesktopPetTask = Readonly<Static<typeof DesktopPetTaskSchema>>;

export type DesktopPetDragStrategy = "native" | "webview";
export type DesktopPetPosition = Readonly<{ x: number; y: number }>;
export type DesktopPetTaskOpen = Readonly<{ projectId: string; taskId: string }>;
