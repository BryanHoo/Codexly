export type BuildPlanAction = () => Promise<boolean>;
export type ForkTaskAction = (
  lastTurnId: string,
  idempotencyKey: string,
  lastItemId?: string,
) => Promise<void>;
