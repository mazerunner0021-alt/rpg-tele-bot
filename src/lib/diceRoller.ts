export class DiceParseError extends Error {}

export interface DiceSpec {
  count: number;
  sides: number;
}

export interface RollResult extends DiceSpec {
  rolls: number[];
  total: number;
}

const MAX_COUNT = 20;
const MAX_SIDES = 1000;

const DICE_PATTERN = /^\s*(\d{1,3})\s*d\s*(\d{1,5})\s*$/i;

/**
 * Parses standard dice notation like "2d6" or "1d20". Throws DiceParseError
 * with a user-facing message on anything malformed or out of sane bounds.
 */
export function parseDiceNotation(input: string): DiceSpec {
  const match = DICE_PATTERN.exec(input);
  if (!match) {
    throw new DiceParseError('Usage: /roll NdM, e.g. "/roll 2d6" (rolls two six-sided dice).');
  }

  const count = Number(match[1]);
  const sides = Number(match[2]);

  if (count < 1 || count > MAX_COUNT) {
    throw new DiceParseError(`Number of dice must be between 1 and ${MAX_COUNT}.`);
  }
  if (sides < 2 || sides > MAX_SIDES) {
    throw new DiceParseError(`Number of sides must be between 2 and ${MAX_SIDES}.`);
  }

  return { count, sides };
}

/** Rolls `count` dice with `sides` faces. `rng` is injectable for deterministic tests. */
export function rollDice(spec: DiceSpec, rng: () => number = Math.random): RollResult {
  const rolls = Array.from({ length: spec.count }, () => Math.floor(rng() * spec.sides) + 1);
  const total = rolls.reduce((sum, r) => sum + r, 0);
  return { ...spec, rolls, total };
}

/** Convenience wrapper: parse + roll in one call, as used by the /roll command. */
export function rollFromNotation(input: string, rng: () => number = Math.random): RollResult {
  return rollDice(parseDiceNotation(input), rng);
}
