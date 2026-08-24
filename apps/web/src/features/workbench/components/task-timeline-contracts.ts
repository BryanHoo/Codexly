export type BuildPlanAction = () => Promise<boolean>;
export type ForkTaskAction = (lastTurnId: string, idempotencyKey: string) => Promise<void>;
