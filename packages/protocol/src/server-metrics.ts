import { Type, type Static } from "@sinclair/typebox";

const CounterSchema = Type.Integer({ minimum: 0 });

export const EventStreamProjectMetricsSchema = Type.Object(
  {
    activeClients: CounterSchema,
    backpressureSignals: CounterSchema,
    coalescedEvents: CounterSchema,
    pendingDeltas: CounterSchema,
    projectId: Type.String({ minLength: 1 }),
    providerEventsReceived: CounterSchema,
    publishedEvents: CounterSchema,
    retainedEvents: CounterSchema,
    retentionEvictions: CounterSchema,
    slowClientDisconnects: CounterSchema,
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
