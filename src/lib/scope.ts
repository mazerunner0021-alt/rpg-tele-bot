import type { Chat } from "grammy/types";
import type { Group, Scene, Topic } from "@prisma/client";
import { prisma } from "./prisma";
import type { MyContext } from "../bot/context";

/** Telegram's "General" topic carries no message_thread_id. We record it as topic id 0. */
export const GENERAL_TOPIC_ID = 0;

export function currentThreadId(ctx: MyContext): number {
  return ctx.message?.message_thread_id ?? ctx.callbackQuery?.message?.message_thread_id ?? GENERAL_TOPIC_ID;
}

function chatTitle(chat: Chat): string {
  switch (chat.type) {
    case "group":
    case "supergroup":
    case "channel":
      return chat.title;
    case "private":
      return [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "Direct message";
  }
}

export async function getOrCreateGroup(chat: Chat): Promise<Group> {
  const telegramChatId = BigInt(chat.id);
  const title = chatTitle(chat);
  const isForum = chat.type === "supergroup" ? Boolean(chat.is_forum) : false;

  return prisma.group.upsert({
    where: { telegramChatId },
    create: { telegramChatId, title, isForumEnabled: isForum },
    update: { title, isForumEnabled: isForum },
  });
}

const groupIdCache = new Map<number, string>();

/**
 * Cached variant of getOrCreateGroup that returns just the internal id.
 * Used on the hot path (every group message, for member tracking) so we
 * don't do a write-upsert per message — only once per chat per process
 * lifetime (title/isForum drift until the next /setup or restart, which is
 * an acceptable tradeoff for a hobby-scale bot).
 */
export async function getGroupIdCached(chat: Chat): Promise<string> {
  const cached = groupIdCache.get(chat.id);
  if (cached) return cached;
  const group = await getOrCreateGroup(chat);
  groupIdCache.set(chat.id, group.id);
  return group.id;
}

export async function getGroupByChatId(chatId: number): Promise<Group | null> {
  return prisma.group.findUnique({ where: { telegramChatId: BigInt(chatId) } });
}

export async function getTopicForThread(groupId: string, telegramTopicId: number): Promise<Topic | null> {
  return prisma.topic.findUnique({
    where: { groupId_telegramTopicId: { groupId, telegramTopicId } },
  });
}

/** Resolves the Scene that owns the topic the current update was sent in, if any. */
export async function getSceneForCurrentTopic(ctx: MyContext): Promise<Scene | null> {
  const chat = ctx.chat;
  if (!chat) return null;
  const threadId = currentThreadId(ctx);

  const topic = await prisma.topic.findFirst({
    where: {
      telegramTopicId: threadId,
      group: { telegramChatId: BigInt(chat.id) },
    },
    include: { scene: true },
  });

  return topic?.scene ?? null;
}

/** Resolves the Topic row for wherever the current update was sent, regardless of type. */
export async function getCurrentTopic(ctx: MyContext): Promise<Topic | null> {
  const chat = ctx.chat;
  if (!chat) return null;
  const threadId = currentThreadId(ctx);

  return prisma.topic.findFirst({
    where: {
      telegramTopicId: threadId,
      group: { telegramChatId: BigInt(chat.id) },
    },
  });
}
