import { InlineKeyboard, type Composer } from "grammy";
import { TopicType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { safeCall, safePinMessage } from "../lib/telegram";
import { getOrCreateGroup, GENERAL_TOPIC_ID } from "../lib/scope";
import { requireGroupAdmin, requireGroupChat } from "../bot/guards";
import type { MyContext } from "../bot/context";

const FORUM_HELP =
  "This group needs <b>Topics</b> (forum mode) enabled before I can set up Casting and Introductions channels.\n\n" +
  "A group admin can turn it on:\n" +
  "1. Open the group's info, then <b>Edit</b>\n" +
  "2. Tap <b>Topics</b>\n" +
  "3. Turn <b>Topics</b> on\n\n" +
  "Then run /setup again.";

/**
 * Shared entry point used by both the /setup command and the my_chat_member
 * listener (bot added to a group). Idempotent: re-running it after topics
 * already exist just confirms rather than duplicating them.
 */
export async function runSetup(ctx: MyContext): Promise<void> {
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    await ctx.reply("Setup only works inside a group.");
    return;
  }

  const isForum = "is_forum" in chat && Boolean(chat.is_forum);
  const group = await getOrCreateGroup(chat);

  if (!isForum) {
    await ctx.reply(FORUM_HELP, { parse_mode: "HTML" });
    return;
  }

  const me = await ctx.api.getMe();
  const botMember = await safeCall("getChatMember(bot)", () => ctx.api.getChatMember(chat.id, me.id));
  const canManageTopics = botMember?.status === "administrator" && botMember.can_manage_topics === true;

  if (!canManageTopics) {
    await ctx.reply(
      "Topics are enabled, but I need to be a group admin with the <b>Manage Topics</b> permission to create the Casting and Introductions topics. Please promote me, then run /setup again.",
      { parse_mode: "HTML" }
    );
    return;
  }

  // Register the group's default "General" topic for bookkeeping completeness
  // (see README "Design decisions" — SETUP represents this implicit topic).
  await prisma.topic.upsert({
    where: { groupId_telegramTopicId: { groupId: group.id, telegramTopicId: GENERAL_TOPIC_ID } },
    create: { groupId: group.id, telegramTopicId: GENERAL_TOPIC_ID, type: TopicType.SETUP },
    update: {},
  });

  const [existingCasting, existingIntro] = await Promise.all([
    prisma.topic.findFirst({ where: { groupId: group.id, type: TopicType.CASTING } }),
    prisma.topic.findFirst({ where: { groupId: group.id, type: TopicType.INTRO } }),
  ]);

  if (existingCasting && existingIntro) {
    await ctx.reply("Setup already ran for this group — check the 📋 Casting and 🎭 Introductions topics.");
    return;
  }

  if (!existingCasting) await createCastingTopic(ctx, group.id, chat.id);
  if (!existingIntro) await createIntroTopic(ctx, group.id, chat.id);

  await ctx.reply("Setup complete! Check the new 📋 Casting and 🎭 Introductions topics.");
}

async function createCastingTopic(ctx: MyContext, groupId: string, chatId: number): Promise<void> {
  const forumTopic = await safeCall("createForumTopic(Casting)", () => ctx.api.createForumTopic(chatId, "📋 Casting"));
  if (!forumTopic) {
    await ctx.reply("Couldn't create the Casting topic. Make sure I have the Manage Topics admin permission.");
    return;
  }

  const topic = await prisma.topic.create({
    data: { groupId, telegramTopicId: forumTopic.message_thread_id, type: TopicType.CASTING },
  });

  const keyboard = new InlineKeyboard().text("✨ Propose a character", "char:propose").row().text("🎬 New scene", "scene:new");

  const sent = await safeCall("send Casting welcome", () =>
    ctx.api.sendMessage(
      chatId,
      "<b>📋 Casting</b>\n\nPropose a character below — an admin will approve or reject it. Once approved, admins can cast it into scenes here or with /scene.",
      { message_thread_id: topic.telegramTopicId, parse_mode: "HTML", reply_markup: keyboard }
    )
  );
  if (sent) await safePinMessage(ctx.api, chatId, sent.message_id);
}

async function createIntroTopic(ctx: MyContext, groupId: string, chatId: number): Promise<void> {
  const forumTopic = await safeCall("createForumTopic(Introductions)", () =>
    ctx.api.createForumTopic(chatId, "🎭 Introductions")
  );
  if (!forumTopic) {
    await ctx.reply("Couldn't create the Introductions topic. Make sure I have the Manage Topics admin permission.");
    return;
  }

  const topic = await prisma.topic.create({
    data: { groupId, telegramTopicId: forumTopic.message_thread_id, type: TopicType.INTRO },
  });

  const keyboard = new InlineKeyboard().text("👋 How do I introduce myself?", "intro:howto");

  const sent = await safeCall("send Introductions welcome", () =>
    ctx.api.sendMessage(
      chatId,
      "<b>🎭 Introductions</b>\n\nSay hello! Post a short introduction of yourself (the player, not your character) so the group knows who's who.",
      { message_thread_id: topic.telegramTopicId, parse_mode: "HTML", reply_markup: keyboard }
    )
  );
  if (sent) await safePinMessage(ctx.api, chatId, sent.message_id);
}

export function registerSetupHandlers(composer: Composer<MyContext>): void {
  composer.command("setup", async (ctx) => {
    if (!requireGroupChat(ctx)) {
      await ctx.reply("This command only works inside a group.");
      return;
    }
    if (!(await requireGroupAdmin(ctx))) return;
    await runSetup(ctx);
  });

  composer.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    if (update.new_chat_member.user.id !== ctx.me.id) return;

    const wasIn = update.old_chat_member.status === "member" || update.old_chat_member.status === "administrator";
    const isInNow = update.new_chat_member.status === "member" || update.new_chat_member.status === "administrator";

    if (!wasIn && isInNow) {
      logger.info("Bot added to group, attempting auto-setup", { chatId: ctx.chat.id });
      await runSetup(ctx).catch((err) => logger.error("Auto-setup failed", { err: String(err) }));
    }
  });

  composer.callbackQuery("intro:howto", async (ctx) => {
    await ctx.answerCallbackQuery({
      text: "Just type your introduction as a normal message in this topic — no command needed!",
      show_alert: true,
    });
  });
}
