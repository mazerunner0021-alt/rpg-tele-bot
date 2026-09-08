import { randomUUID } from "node:crypto";
import { InlineKeyboard, type Composer } from "grammy";
import type { FeedAccount } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getEnv } from "../config/env";
import { escapeHtml } from "../lib/format";
import { safeCall, safeDeleteMessage } from "../lib/telegram";
import { getOrCreateGroup, getGroupIdCached, getCurrentTopic, currentThreadId } from "../lib/scope";
import { replyEphemeral, trackIncoming } from "../lib/ephemeral";
import { setFlow, clearFlow } from "../bot/flow";
import type { Flow } from "../bot/sessionTypes";
import type { MyContext } from "../bot/context";
import { logger } from "../lib/logger";

const MAX_ACCOUNT_NAME_LENGTH = 60;

async function getAccounts(groupId: string, userId: number): Promise<FeedAccount[]> {
  return prisma.feedAccount.findMany({
    where: { groupId, userId: BigInt(userId) },
    orderBy: { createdAt: "asc" },
  });
}

type AccountResolution =
  | { kind: "resolved"; account: FeedAccount }
  | { kind: "none" }
  | { kind: "ambiguous"; options: FeedAccount[] };

/** The user's currently-active Feed account, auto-resolving when they have exactly one. */
async function resolveActiveAccount(groupId: string, userId: number): Promise<AccountResolution> {
  const existing = await prisma.feedPersona.findUnique({
    where: { groupId_userId: { groupId, userId: BigInt(userId) } },
    include: { feedAccount: true },
  });
  if (existing) return { kind: "resolved", account: existing.feedAccount };

  const accounts = await getAccounts(groupId, userId);
  if (accounts.length === 0) return { kind: "none" };
  if (accounts.length === 1) {
    await prisma.feedPersona.create({
      data: { groupId, userId: BigInt(userId), feedAccountId: accounts[0]!.id },
    });
    return { kind: "resolved", account: accounts[0]! };
  }
  return { kind: "ambiguous", options: accounts };
}

async function sendAccountPicker(ctx: MyContext, groupId: string, userId: number, accounts: FeedAccount[]): Promise<void> {
  const persona = await prisma.feedPersona.findUnique({ where: { groupId_userId: { groupId, userId: BigInt(userId) } } });
  const kb = new InlineKeyboard();
  for (const a of accounts) {
    const label = a.id === persona?.feedAccountId ? `✅ ${a.name}` : a.name;
    kb.text(label, `account:pick:${a.id}`).row();
  }
  kb.text("➕ New account", "account:new");
  await replyEphemeral(ctx, "Your Feed accounts:", { message_thread_id: currentThreadId(ctx), reply_markup: kb });
}

async function promptNewAccountName(ctx: MyContext, purpose: "post" | "manage", intro: string): Promise<void> {
  setFlow(ctx, { kind: "await_account_name", purpose });
  await replyEphemeral(ctx, intro, {
    message_thread_id: currentThreadId(ctx),
    reply_markup: { force_reply: true, selective: true },
  });
}

async function publishPost(ctx: MyContext, feedAccountId: string, fileId: string, caption: string | null): Promise<void> {
  const chat = ctx.chat;
  if (!chat || !ctx.from) return;
  const account = await prisma.feedAccount.findUnique({ where: { id: feedAccountId } });
  if (!account) return;

  const threadId = currentThreadId(ctx);
  const originalMessageId = ctx.message!.message_id;

  const deleted = await safeDeleteMessage(ctx.api, chat.id, originalMessageId);
  if (!deleted) {
    logger.warn("Could not delete original post photo; reposting anyway", { chatId: chat.id, originalMessageId });
  }

  const postId = randomUUID();
  const captionHtml = `<b>${escapeHtml(account.name)}</b>${caption ? `\n${escapeHtml(caption)}` : ""}`;
  const env = getEnv();
  // A `web_app` inline button is rejected by the Bot API (BUTTON_TYPE_INVALID)
  // on messages sent directly into a group — that button type only works
  // from a private chat with the bot. A plain `url` button works everywhere
  // and still opens the page in Telegram's in-app browser; see README
  // "Design decisions" for the upgrade path to a fully registered Mini App.
  const keyboard = env.RENDER_EXTERNAL_URL
    ? new InlineKeyboard().url("📱 View as Post", `${env.RENDER_EXTERNAL_URL}/app/post/${postId}`)
    : undefined;

  const sent = await safeCall("repost as post", () =>
    ctx.api.sendPhoto(chat.id, fileId, {
      caption: captionHtml,
      parse_mode: "HTML",
      message_thread_id: threadId,
      reply_markup: keyboard,
    })
  );
  if (!sent) {
    await replyEphemeral(ctx, "Something went wrong posting that — please try again.", { message_thread_id: threadId });
    return;
  }

  await prisma.post.create({
    data: {
      id: postId,
      groupId: account.groupId,
      messageId: sent.message_id,
      feedAccountId: account.id,
      authorUserId: BigInt(ctx.from.id),
      fileId,
      caption,
    },
  });
}

/** Continues an await_account_name or await_post_photo flow. Returns true if the update was consumed. */
export async function continueFeedFlow(ctx: MyContext, flow: Flow): Promise<boolean> {
  if (flow.kind === "await_account_name") {
    const name = ctx.message?.text?.trim();
    if (!name) {
      await replyEphemeral(ctx, "Please send a name as text.");
      return true;
    }
    if (name.length > MAX_ACCOUNT_NAME_LENGTH) {
      await replyEphemeral(ctx, `That name's a bit long (max ${MAX_ACCOUNT_NAME_LENGTH} characters). Try again.`);
      return true;
    }
    if (!ctx.chat || !ctx.from) return true;

    await trackIncoming(ctx);
    const group = await getOrCreateGroup(ctx.chat);
    const account = await prisma.feedAccount.create({
      data: { groupId: group.id, userId: BigInt(ctx.from.id), name },
    });
    await prisma.feedPersona.upsert({
      where: { groupId_userId: { groupId: group.id, userId: BigInt(ctx.from.id) } },
      create: { groupId: group.id, userId: BigInt(ctx.from.id), feedAccountId: account.id },
      update: { feedAccountId: account.id },
    });

    if (flow.purpose === "post") {
      setFlow(ctx, { kind: "await_post_photo", feedAccountId: account.id });
      await replyEphemeral(
        ctx,
        `Account created! Posting as <b>${escapeHtml(account.name)}</b>. Send the photo you want to post (add a caption if you like).`,
        { parse_mode: "HTML", reply_markup: { force_reply: true, selective: true } }
      );
    } else {
      clearFlow(ctx);
      await replyEphemeral(ctx, `Account created! You're now posting as <b>${escapeHtml(account.name)}</b>.`, {
        parse_mode: "HTML",
      });
    }
    return true;
  }

  if (flow.kind !== "await_post_photo") return false;

  const photos = ctx.message?.photo;
  if (!photos || photos.length === 0) {
    await replyEphemeral(ctx, "Please send a photo.");
    return true;
  }

  await trackIncoming(ctx);
  clearFlow(ctx);
  await publishPost(ctx, flow.feedAccountId, photos[photos.length - 1]!.file_id, ctx.message?.caption ?? null);
  return true;
}

export function registerFeedCommands(composer: Composer<MyContext>): void {
  composer.command("post", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const topic = await getCurrentTopic(ctx);
    if (!topic || topic.type !== "FEED") {
      await replyEphemeral(ctx, "This only works in the 📸 Feed topic.", { message_thread_id: currentThreadId(ctx) });
      return;
    }

    const group = await getOrCreateGroup(ctx.chat);
    const resolution = await resolveActiveAccount(group.id, ctx.from.id);

    if (resolution.kind === "none") {
      await promptNewAccountName(ctx, "post", "You don't have a Feed account yet. What name do you want to post as?");
      return;
    }

    if (resolution.kind === "ambiguous") {
      setFlow(ctx, { kind: "await_account_pick", purpose: "post" });
      await sendAccountPicker(ctx, group.id, ctx.from.id, resolution.options);
      return;
    }

    setFlow(ctx, { kind: "await_post_photo", feedAccountId: resolution.account.id });
    await replyEphemeral(
      ctx,
      `Posting as <b>${escapeHtml(resolution.account.name)}</b>. Send the photo you want to post (add a caption if you like).`,
      { parse_mode: "HTML", message_thread_id: currentThreadId(ctx), reply_markup: { force_reply: true, selective: true } }
    );
  });

  composer.command("feed", async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const group = await getOrCreateGroup(ctx.chat);
    const accounts = await getAccounts(group.id, ctx.from.id);

    if (accounts.length === 0) {
      await promptNewAccountName(ctx, "manage", "You don't have a Feed account yet. What name do you want to post as?");
      return;
    }

    setFlow(ctx, { kind: "await_account_pick", purpose: "manage" });
    await sendAccountPicker(ctx, group.id, ctx.from.id, accounts);
  });

  composer.callbackQuery(/^account:pick:(.+)$/, async (ctx) => {
    if (!ctx.chat || !ctx.from) return;
    const flow = ctx.session.flow;
    if (!flow || flow.kind !== "await_account_pick") {
      await ctx.answerCallbackQuery({ text: "This menu expired — run /feed again.", show_alert: true });
      return;
    }

    const accountId = ctx.match[1]!;
    const account = await prisma.feedAccount.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== BigInt(ctx.from.id)) {
      await ctx.answerCallbackQuery({ text: "That's not your account.", show_alert: true });
      return;
    }

    const group = await getOrCreateGroup(ctx.chat);
    await prisma.feedPersona.upsert({
      where: { groupId_userId: { groupId: group.id, userId: BigInt(ctx.from.id) } },
      create: { groupId: group.id, userId: BigInt(ctx.from.id), feedAccountId: accountId },
      update: { feedAccountId: accountId },
    });

    await safeCall("delete account picker", () => ctx.deleteMessage());

    if (flow.purpose === "post") {
      await ctx.answerCallbackQuery({ text: `Posting as ${account.name}.` });
      setFlow(ctx, { kind: "await_post_photo", feedAccountId: accountId });
      await replyEphemeral(ctx, "Send the photo you want to post (add a caption if you like).", {
        message_thread_id: currentThreadId(ctx),
        reply_markup: { force_reply: true, selective: true },
      });
      return;
    }

    clearFlow(ctx);
    await ctx.answerCallbackQuery({ text: `You're now posting as ${account.name}.` });
  });

  composer.callbackQuery("account:new", async (ctx) => {
    const flow = ctx.session.flow;
    const purpose = flow && flow.kind === "await_account_pick" ? flow.purpose : "manage";
    await ctx.answerCallbackQuery();
    await safeCall("delete account picker", () => ctx.deleteMessage());
    await promptNewAccountName(ctx, purpose, "What name do you want to post as?");
  });
}

/**
 * Silently mirrors chat replies to a tracked Post into PostComment, for the
 * Mini App's comment thread. Never consumes the update — comments stay as
 * normal, visible chat replies in the topic (see README "Design decisions").
 */
export function registerFeedCommentHandler(composer: Composer<MyContext>): void {
  composer.on("message:text", async (ctx, next) => {
    if (!ctx.chat || !ctx.from) return next();
    if (ctx.message.text.startsWith("/")) return next();
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return next();

    const topic = await getCurrentTopic(ctx);
    if (!topic || topic.type !== "FEED") return next();

    const groupId = await getGroupIdCached(ctx.chat);
    const post = await prisma.post.findUnique({
      where: { groupId_messageId: { groupId, messageId: replyTo.message_id } },
    });
    if (!post) return next();

    const persona = await prisma.feedPersona.findUnique({
      where: { groupId_userId: { groupId, userId: BigInt(ctx.from.id) } },
    });
    if (!persona) return next(); // no resolvable account — leave the reply un-mirrored, don't nag on every comment

    await prisma.postComment
      .create({
        data: {
          postId: post.id,
          messageId: ctx.message.message_id,
          userId: BigInt(ctx.from.id),
          feedAccountId: persona.feedAccountId,
          text: ctx.message.text,
        },
      })
      .catch((err) => logger.warn("Failed to log post comment", { postId: post.id, err: String(err) }));

    return next();
  });
}

/** Mirrors Telegram's native message reactions onto a Post as Instagram-style "likes" (existence, not emoji, is what's tracked). */
export function registerFeedReactionHandler(composer: Composer<MyContext>): void {
  composer.on("message_reaction", async (ctx) => {
    const mr = ctx.messageReaction;
    if (!mr.user) return; // anonymous/chat-actor reactions aren't attributable to a user

    const groupId = await getGroupIdCached(mr.chat);
    const post = await prisma.post.findUnique({
      where: { groupId_messageId: { groupId, messageId: mr.message_id } },
    });
    if (!post) return;

    if (mr.new_reaction.length > 0) {
      await prisma.postReaction.upsert({
        where: { postId_userId: { postId: post.id, userId: BigInt(mr.user.id) } },
        create: { postId: post.id, userId: BigInt(mr.user.id) },
        update: {},
      });
    } else {
      await prisma.postReaction.deleteMany({ where: { postId: post.id, userId: BigInt(mr.user.id) } });
    }
  });
}
