import { describe, expect, it } from "vitest";
import { DiceParseError, parseDiceNotation, rollDice, rollFromNotation } from "../src/lib/diceRoller";

describe("parseDiceNotation", () => {
  it("parses standard NdM notation", () => {
    expect(parseDiceNotation("2d6")).toEqual({ count: 2, sides: 6 });
    expect(parseDiceNotation("1d20")).toEqual({ count: 1, sides: 20 });
  });

  it("is forgiving of case and whitespace", () => {
    expect(parseDiceNotation(" 3D10 ")).toEqual({ count: 3, sides: 10 });
    expect(parseDiceNotation("1 d 20")).toEqual({ count: 1, sides: 20 });
  });

  it("rejects malformed input", () => {
    expect(() => parseDiceNotation("hello")).toThrow(DiceParseError);
    expect(() => parseDiceNotation("d6")).toThrow(DiceParseError);
    expect(() => parseDiceNotation("2x6")).toThrow(DiceParseError);
    expect(() => parseDiceNotation("")).toThrow(DiceParseError);
  });

  it("enforces the dice-count upper bound", () => {
    expect(() => parseDiceNotation("20d6")).not.toThrow();
    expect(() => parseDiceNotation("21d6")).toThrow(DiceParseError);
    expect(() => parseDiceNotation("0d6")).toThrow(DiceParseError);
  });

  it("enforces the sides upper bound", () => {
    expect(() => parseDiceNotation("1d1000")).not.toThrow();
    expect(() => parseDiceNotation("1d1001")).toThrow(DiceParseError);
    expect(() => parseDiceNotation("1d1")).toThrow(DiceParseError);
  });
});

describe("rollDice", () => {
  it("rolls the requested number of dice within range using an injected RNG", () => {
    const rng = () => 0; // Math.floor(0 * sides) + 1 == 1 every time
    const result = rollDice({ count: 3, sides: 6 }, rng);
    expect(result.rolls).toEqual([1, 1, 1]);
    expect(result.total).toBe(3);
  });

  it("uses the top of the range when rng approaches 1", () => {
    const rng = () => 0.9999999;
    const result = rollDice({ count: 1, sides: 6 }, rng);
    expect(result.rolls[0]).toBe(6);
  });

  it("sums rolls correctly for a deterministic sequence", () => {
    const values = [0, 0.5, 0.99];
    let i = 0;
    const rng = () => values[i++]!;
    const result = rollDice({ count: 3, sides: 10 }, rng);
    expect(result.rolls).toEqual([1, 6, 10]);
    expect(result.total).toBe(17);
  });
});

describe("rollFromNotation", () => {
  it("parses and rolls in one call", () => {
    const result = rollFromNotation("2d6", () => 0);
    expect(result.count).toBe(2);
    expect(result.sides).toBe(6);
    expect(result.rolls).toEqual([1, 1]);
  });
});
