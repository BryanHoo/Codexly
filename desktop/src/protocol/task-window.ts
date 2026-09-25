export type TaskWindowRow = Readonly<{ id: string; kind: string; text: string }>;

export type TaskWindowPacket = Readonly<{
  sequence: number;
  title: string;
  status: string;
  order: readonly string[];
  updates: readonly (TaskWindowRow & Readonly<{ append: boolean }>)[];
  truncated: boolean;
}>;
