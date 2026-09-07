import { InlineKeyboard, type Composer } from "grammy";
import type { Character } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { escapeHtml, mentionHtml, displayNameOf } from "../lib/format";
import { safeCall } from "../lib/telegram";
import { getOrCreateGroup, currentThreadId } from "../lib/scope";
import { replyEphemeral, trackIncoming } from "../lib/ephemeral";
import { requireGroupAdminCallback } from "../bot/guards";
import { setFlow, clearFlow } from "../bot/flow";
import type { Flow } from "../bot/sessionTypes";
import type { MyContext } from "../bot/context";

function renderProposalCard(character: Pick<Character, "name" | "description" | "status">, reviewerMention?: string): string {
  const lines = [`<b>${escapeHtml(character.name)}</b>`, escapeHtml(character.description)];
  if (character.status === "PENDING") {
    lines.push("", "⏳ Awaiting admin approval.");
  } else if (character.status === "APPROVED") {
    lines.push("", `✅ Approved${reviewerMention ? ` by ${reviewerMention}` : ""}.`);
  } else {
    lines.push("", `❌ Rejected${reviewerMention ? ` by ${reviewerMention}` : ""}.`);
  }
  return lines.join("\n");
}

async function finalizeCharacterProposal(
  ctx: MyContext,
  name: string,
  description: string,
  avatarFileId: string | null
): Promise<void> {
  const chat = ctx.chat;
  if (!chat || !ctx.from) return;
  const group = await getOrCreateGroup(chat);

  const castingTopic = await prisma.topic.findFirst({ where: { groupId: group.id, type: "CASTING" } });
  if (!castingTopic) {
    await replyEphemeral(ctx, "This group hasn't run /setup yet, so there's no Casting topic to post to. Ask an admin to run /setup.");
    return;
  }

  const character = await prisma.character.create({
    data: {
      groupId: group.id,
      name,
      description,
      avatarFileId: avatarFileId ?? undefined,
      proposedByUserId: BigInt(ctx.from.id),
      status: "PENDING",
    },
  });

  const text = renderProposalCard(character);
  const keyboard = new InlineKeyboard()
    .text("✅ Approve", `char:approve:${character.id}`)
    .text("❌ Reject", `char:reject:${character.id}`);

  const sent = avatarFileId
    ? await safeCall("post character proposal (photo)", () =>
        ctx.api.sendPhoto(chat.id, avatarFileId, {
          caption: text,
          parse_mode: "HTML",
          message_thread_id: castingTopic.telegramTopicId,
          reply_markup: keyboard,
        })
      )
    : await safeCall("post character proposal", () =>
        ctx.api.sendMessage(chat.id, text, {
          parse_mode: "HTML",
          message_thread_id: castingTopic.telegramTopicId,
          reply_markup: keyboard,
        })
      );

  if (sent) {
    await prisma.character.update({ where: { id: character.id }, data: { proposalMessageId: sent.message_id } });
  }

  await replyEphemeral(ctx, "Your character has been submitted for approval!");
}

/** Continues a propose_character_* flow. Returns true if the update was consumed. */
export async function continueCastingFlow(ctx: MyContext, flow: Flow): Promise<boolean> {
  if (flow.kind === "propose_character_name") {
    const name = ctx.message?.text?.trim();
    if (!name) {
      await replyEphemeral(ctx, "Please send the character's name as text.");
      return true;
    }
    if (name.length > 100) {
      await replyEphemeral(ctx, "That name is too long (max 100 characters). Try again.");
      return true;
    }
    await trackIncoming(ctx);
    setFlow(ctx, { kind: "propose_character_description", name });
    await replyEphemeral(ctx, "Got it. Now send a short description of the character.", {
      reply_markup: { force_reply: true, selective: true },
    });
    return true;
  }

  if (flow.kind === "propose_character_description") {
    const description = ctx.message?.text?.trim();
    if (!description) {
      await replyEphemeral(ctx, "Please send a short text description.");
      return true;
    }
    if (description.length > 1000) {
      await replyEphemeral(ctx, "That description is too long (max 1000 characters). Try again.");
      return true;
    }
    await trackIncoming(ctx);
    setFlow(ctx, { kind: "propose_character_photo", name: flow.name, description });
    await replyEphemeral(ctx, "Optional: send a photo to use as the character's avatar, or send /skip to finish without one.", {
      reply_markup: { force_reply: true, selective: true },
    });
    return true;
  }

  if (flow.kind === "propose_character_photo") {
    const photos = ctx.message?.photo;
    const avatarFileId = photos && photos.length > 0 ? photos[photos.length - 1]!.file_id : null;
    await trackIncoming(ctx);
    clearFlow(ctx);
    await finalizeCharacterProposal(ctx, flow.name, flow.description, avatarFileId);
    return true;
  }

  return false;
}

async function handleReview(ctx: MyContext, characterId: string, status: "APPROVED" | "REJECTED"): Promise<void> {
  if (!(await requireGroupAdminCallback(ctx))) return;
  const chat = ctx.chat;
  if (!chat || !ctx.from) return;

  const character = await prisma.character.findUnique({ where: { id: characterId } });
  if (!character) {
    await ctx.answerCallbackQuery({ text: "This proposal no longer exists.", show_alert: true });
    return;
  }
  if (character.status !== "PENDING") {
    await ctx.answerCallbackQuery({ text: `Already ${character.status.toLowerCase()}.`, show_alert: true });
    return;
  }

  const updated = await prisma.character.update({ where: { id: characterId }, data: { status } });
  await ctx.answerCallbackQuery({ text: status === "APPROVED" ? "Approved!" : "Rejected." });

  const reviewerLabel = mentionHtml(ctx.from.id, displayNameOf(ctx.from));
  const text = renderProposalCard(updated, reviewerLabel);
  const clearKeyboard = { inline_keyboard: [] as never[] };

  if (updated.proposalMessageId) {
    if (updated.avatarFileId) {
      await safeCall("editMessageCaption", () =>
        ctx.api.editMessageCaption(chat.id, updated.proposalMessageId!, {
          caption: text,
          parse_mode: "HTML",
          reply_markup: clearKeyboard,
        })
      );
    } else {
      await safeCall("editMessageText", () =>
        ctx.api.editMessageText(chat.id, updated.proposalMessageId!, text, {
          parse_mode: "HTML",
          reply_markup: clearKeyboard,
        })
      );
    }
  }

  const proposerMention = mentionHtml(updated.proposedByUserId, "there");
  const notice =
    status === "APPROVED"
      ? `${proposerMention} your character <b>${escapeHtml(updated.name)}</b> was approved! ✅ It can now be cast into scenes.`
      : `${proposerMention} your character <b>${escapeHtml(updated.name)}</b> was rejected. ❌`;

  await safeCall("notify proposer", () =>
    ctx.api.sendMessage(chat.id, notice, {
      message_thread_id: currentThreadId(ctx),
      parse_mode: "HTML",
    })
  );
}

export function registerCastingHandlers(composer: Composer<MyContext>): void {
  composer.callbackQuery("char:propose", async (ctx) => {
    await ctx.answerCallbackQuery();
    setFlow(ctx, { kind: "propose_character_name" });
    await replyEphemeral(ctx, "What's the character's name?", {
      message_thread_id: currentThreadId(ctx),
      reply_markup: { force_reply: true, selective: true },
    });
  });

  composer.callbackQuery(/^char:approve:(.+)$/, async (ctx) => {
    await handleReview(ctx, ctx.match[1]!, "APPROVED");
  });

  composer.callbackQuery(/^char:reject:(.+)$/, async (ctx) => {
    await handleReview(ctx, ctx.match[1]!, "REJECTED");
  });
}
