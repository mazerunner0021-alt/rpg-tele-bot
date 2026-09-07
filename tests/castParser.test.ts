import { describe, expect, it } from "vitest";
import { looksLikeCastShorthand, parseCastShorthand } from "../src/lib/castParser";

describe("parseCastShorthand", () => {
  it("parses a single comma-separated line", () => {
    const result = parseCastShorthand("Aria: @alice, Bors: @bob");
    expect(result.unparsed).toEqual([]);
    expect(result.assignments).toEqual([
      { raw: "Aria: @alice", characterName: "Aria", username: "alice" },
      { raw: "Bors: @bob", characterName: "Bors", username: "bob" },
    ]);
  });

  it("parses one-assignment-per-line input", () => {
    const result = parseCastShorthand("Aria: @alice\nBors: @bob\n");
    expect(result.assignments).toHaveLength(2);
    expect(result.unparsed).toEqual([]);
  });

  it("parses a mix of newlines and commas", () => {
    const result = parseCastShorthand("Aria: @alice, Bors: @bob\nCass: @carol");
    expect(result.assignments.map((a) => a.characterName)).toEqual(["Aria", "Bors", "Cass"]);
  });

  it("trims whitespace around names and handles multi-word character names", () => {
    const result = parseCastShorthand("  The Grey Wanderer :  @gandalf  ");
    expect(result.assignments).toEqual([
      { raw: "The Grey Wanderer :  @gandalf", characterName: "The Grey Wanderer", username: "gandalf" },
    ]);
  });

  it("reports lines it cannot parse instead of failing silently", () => {
    const result = parseCastShorthand("Aria: @alice, this is not valid, Bors: @bob");
    expect(result.assignments).toHaveLength(2);
    expect(result.unparsed).toEqual(["this is not valid"]);
  });

  it("rejects a line with no character name before the colon", () => {
    const result = parseCastShorthand(": @alice");
    expect(result.assignments).toEqual([]);
    expect(result.unparsed).toEqual([": @alice"]);
  });

  it("ignores blank lines and empty input", () => {
    expect(parseCastShorthand("").assignments).toEqual([]);
    expect(parseCastShorthand("\n\n , ,\n").unparsed).toEqual([]);
  });
});

describe("looksLikeCastShorthand", () => {
  it("detects a plausible shorthand line", () => {
    expect(looksLikeCastShorthand("Aria: @alice")).toBe(true);
  });

  it("rejects ordinary dialogue", () => {
    expect(looksLikeCastShorthand("Hello there, how are you?")).toBe(false);
    expect(looksLikeCastShorthand("check out @alice's post")).toBe(false);
  });
});
