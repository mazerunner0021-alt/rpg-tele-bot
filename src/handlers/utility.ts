import type { Composer } from "grammy";
import { prisma } from "../lib/prisma";
import { escapeHtml } from "../lib/format";
import { getSceneForCurrentTopic, currentThreadId } from "../lib/scope";
import { rollFromNotation, DiceParseError } from "../lib/diceRoller";
import { clearFlow } from "../bot/flow";
import type { MyContext } from "../bot/context";

const HELP_TEXT = [
  "<b>RP Bot commands</b>",
  "",
  "<b>Setup</b>",
  "/setup — enable forum topics support and create Casting + Introductions (admin)",
  "",
  "<b>Casting</b>",
  "Use the ✨ Propose a character button in 📋 Casting",
  "",
  "<b>Scenes</b> (admin)",
  "/scene [name] — create a scene, or pick a saved template if no name is given",
  "/closescene — close the scene in this topic",
  "/addscenepic — update this scene's banner photo",
  "/savetemplate &lt;name&gt; — save this scene's title+description for reuse",
  "/export — export this scene's transcript as a .txt file",
  "",
  "<b>In a scene</b>",
  "/switch — pick which of your characters you're speaking as here",
  "/character — show your active character's card in this topic",
  "",
  "<b>Anywhere</b>",
  "/roll NdM — roll dice, e.g. /roll 2d6",
  "/cancel — cancel whatever multi-step action you're in the middle of",
].join("\n");

export function registerUtilityHandlers(composer: Composer<MyContext>): void {
  composer.command(["start", "help"], async (ctx) => {
    await ctx.reply(HELP_TEXT, { parse_mode: "HTML" });
  });

  composer.command("cancel", async (ctx) => {
    if (ctx.session.flow) {
      clearFlow(ctx);
      await ctx.reply("Cancelled.");
    } else {
      await ctx.reply("Nothing to cancel.");
    }
  });

  composer.command("roll", async (ctx) => {
    const arg = (ctx.match ?? "").toString().trim();
    if (!arg) {
      await ctx.reply("Usage: /roll NdM, e.g. /roll 2d6", { message_thread_id: currentThreadId(ctx) });
      return;
    }
    try {
      const result = rollFromNotation(arg);
      const text = `🎲 ${result.count}d${result.sides}: [${result.rolls.join(", ")}] = <b>${result.total}</b>`;
      await ctx.reply(text, { parse_mode: "HTML", message_thread_id: currentThreadId(ctx) });
    } catch (err) {
      const message = err instanceof DiceParseError ? err.message : "Something went wrong rolling those dice.";
      await ctx.reply(message, { message_thread_id: currentThreadId(ctx) });
    }
  });

  composer.command("character", async (ctx) => {
    if (!ctx.from) return;
    const scene = await getSceneForCurrentTopic(ctx);
    if (!scene) {
      await ctx.reply("There's no scene in this topic.");
      return;
    }

    const activeRole = await prisma.activeRole.findUnique({
      where: { userId_sceneId: { userId: BigInt(ctx.from.id), sceneId: scene.id } },
      include: { character: true },
    });

    if (!activeRole) {
      await ctx.reply('You don\'t have an active character in this topic. Use "🔀 Switch character" on the scene\'s pinned message first.', {
        message_thread_id: currentThreadId(ctx),
      });
      return;
    }

    const c = activeRole.character;
    const caption = `<b>${escapeHtml(c.name)}</b>\n${escapeHtml(c.description)}`;
    if (c.avatarFileId) {
      await ctx.replyWithPhoto(c.avatarFileId, { caption, parse_mode: "HTML", message_thread_id: currentThreadId(ctx) });
    } else {
      await ctx.reply(caption, { parse_mode: "HTML", message_thread_id: currentThreadId(ctx) });
    }
  });
}
