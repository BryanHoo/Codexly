import { Type, type Static } from "@sinclair/typebox";

const CounterSchema = Type.Integer({ minimum: 0 });

export const EventStreamProjectMetricsSchema = Type.Object(
  {
    coalescedEvents: CounterSchema,
    ipcEventsPerSecond: Type.Number({ minimum: 0 }),
    mergeRate: Type.Number({ maximum: 1, minimum: 0 }),
    projectId: Type.String({ minLength: 1 }),
    providerEventsReceived: CounterSchema,
    publishedEvents: CounterSchema,
    queueHighWatermark: CounterSchema,
  },
  { additionalProperties: false },
);

export type EventStreamProjectMetrics = Readonly<Static<typeof EventStreamProjectMetricsSchema>>;

export const EventStreamMetricsResponseSchema = Type.Object(
  {
    projects: Type.Array(EventStreamProjectMetricsSchema),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type EventStreamMetricsResponse = Readonly<Static<typeof EventStreamMetricsResponseSchema>>;
