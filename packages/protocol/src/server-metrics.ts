import { Type, type Static } from "@sinclair/typebox";

const CounterSchema = Type.Integer({ minimum: 0 });
const DistributionSchema = Type.Object(
  {
    count: CounterSchema,
    p95: Type.Number({ minimum: 0 }),
    p99: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

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
    // 新诊断字段可选，以便旧服务端与共享协议消费者继续兼容。
    queueBytes: Type.Optional(CounterSchema),
    queueBytesPerBatch: Type.Optional(DistributionSchema),
    queueWaitMs: Type.Optional(DistributionSchema),
    snapshotRetries: Type.Optional(CounterSchema),
    snapshotRetriesPerRead: Type.Optional(DistributionSchema),
  },
  { additionalProperties: false },
);

export type EventStreamProjectMetrics = Readonly<Static<typeof EventStreamProjectMetricsSchema>>;

export const EventStreamMetricsResponseSchema = Type.Object(
  {
    projects: Type.Array(EventStreamProjectMetricsSchema),
    eventLoopDelayMs: Type.Optional(DistributionSchema),
    version: Type.Literal(1),
  },
  { additionalProperties: false },
);

export type EventStreamMetricsResponse = Readonly<Static<typeof EventStreamMetricsResponseSchema>>;
