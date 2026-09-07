export interface ParsedCastAssignment {
  raw: string;
  characterName: string;
  username: string;
}

export interface CastParseResult {
  assignments: ParsedCastAssignment[];
  unparsed: string[];
}

// "CharacterName: @username" — character name is everything before the last
// colon, trimmed; username is a standard Telegram handle (5-32 word chars).
const LINE_PATTERN = /^(.+):\s*@(\w{1,32})$/;

/**
 * Parses the admin free-text cast shorthand:
 *   "CharacterName: @username, CharacterName2: @username2"
 * also accepting one assignment per line instead of/in addition to commas.
 * Never throws — lines that don't match are returned in `unparsed` so the
 * caller can report them back rather than failing silently.
 */
export function parseCastShorthand(input: string): CastParseResult {
  const tokens = input
    .split(/[\n,]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const assignments: ParsedCastAssignment[] = [];
  const unparsed: string[] = [];

  for (const token of tokens) {
    const match = LINE_PATTERN.exec(token);
    if (!match) {
      unparsed.push(token);
      continue;
    }
    const characterName = match[1]!.trim();
    const username = match[2]!;
    if (!characterName) {
      unparsed.push(token);
      continue;
    }
    assignments.push({ raw: token, characterName, username });
  }

  return { assignments, unparsed };
}

/**
 * A message is only treated as cast shorthand if it plausibly looks like one
 * (contains at least one "text: @handle" pair). Used to decide whether to
 * intercept a message at all before running the full parse + DB validation.
 */
export function looksLikeCastShorthand(input: string): boolean {
  return /:\s*@\w{1,32}/.test(input);
}
