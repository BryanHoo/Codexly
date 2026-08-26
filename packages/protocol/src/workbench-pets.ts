import { Type, type Static } from "@sinclair/typebox";

export const WorkbenchPetSettingsSchema = Type.Union([
  Type.Object(
    { enabled: Type.Literal(false), selectedPetId: Type.Union([Type.String(), Type.Null()]) },
    { additionalProperties: false },
  ),
  Type.Object(
    { enabled: Type.Literal(true), selectedPetId: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
]);
export type WorkbenchPetSettings = Readonly<Static<typeof WorkbenchPetSettingsSchema>>;

export const WorkbenchPetFrameSchema = Type.Object(
  {
    columns: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    rows: Type.Integer({ minimum: 1 }),
    width: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);
export type WorkbenchPetFrame = Readonly<Static<typeof WorkbenchPetFrameSchema>>;

export const WorkbenchPetAnimationFrameSchema = Type.Object(
  {
    durationMs: Type.Integer({ minimum: 1 }),
    spriteIndex: Type.Integer({ maximum: 255, minimum: 0 }),
  },
  { additionalProperties: false },
);
export type WorkbenchPetAnimationFrame = Readonly<Static<typeof WorkbenchPetAnimationFrameSchema>>;

export const WorkbenchPetAnimationSchema = Type.Object(
  {
    fallback: Type.String({ minLength: 1 }),
    frames: Type.Array(WorkbenchPetAnimationFrameSchema, { maxItems: 512, minItems: 1 }),
    loopStart: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type WorkbenchPetAnimation = Readonly<Static<typeof WorkbenchPetAnimationSchema>>;

export const WorkbenchPetDescriptorSchema = Type.Object(
  {
    animations: Type.Record(Type.String({ minLength: 1 }), WorkbenchPetAnimationSchema),
    assetId: Type.String({ pattern: "^[a-f0-9]{64}$" }),
    availability: Type.Union([Type.Literal("downloadable"), Type.Literal("ready")]),
    description: Type.String(),
    displayName: Type.String({ minLength: 1 }),
    frame: WorkbenchPetFrameSchema,
    id: Type.String({ minLength: 1 }),
    source: Type.Union([Type.Literal("builtin"), Type.Literal("custom"), Type.Literal("legacy")]),
  },
  { additionalProperties: false },
);
export type WorkbenchPetDescriptor = Readonly<Static<typeof WorkbenchPetDescriptorSchema>>;

export const WorkbenchPetCatalogResponseSchema = Type.Object(
  { data: Type.Array(WorkbenchPetDescriptorSchema) },
  { additionalProperties: false },
);
export type WorkbenchPetCatalogResponse = Readonly<
  Static<typeof WorkbenchPetCatalogResponseSchema>
>;

export const WorkbenchPetDownloadRequestSchema = Type.Object(
  { petId: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
export type WorkbenchPetDownloadRequest = Readonly<
  Static<typeof WorkbenchPetDownloadRequestSchema>
>;

export const WorkbenchPetDownloadResponseSchema = Type.Object(
  { data: WorkbenchPetDescriptorSchema },
  { additionalProperties: false },
);
export type WorkbenchPetDownloadResponse = Readonly<
  Static<typeof WorkbenchPetDownloadResponseSchema>
>;
