export type SkillMarketErrorCode =
  | "SKILL_MARKET_CONFLICT"
  | "SKILL_MARKET_FILESYSTEM"
  | "SKILL_MARKET_INCOMPATIBLE"
  | "SKILL_MARKET_INVALID_ARCHIVE"
  | "SKILL_MARKET_INVALID_RESPONSE"
  | "SKILL_MARKET_NETWORK"
  | "SKILL_MARKET_NOT_FOUND"
  | "SKILL_MARKET_RATE_LIMITED"
  | "SKILL_MARKET_UNSAFE";

export class SkillMarketError extends Error {
  public constructor(
    public readonly code: SkillMarketErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SkillMarketError";
  }
}
