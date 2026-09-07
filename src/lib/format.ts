export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function mentionHtml(userId: number | bigint, label: string): string {
  return `<a href="tg://user?id=${userId}">${escapeHtml(label)}</a>`;
}

export function displayNameOf(user: { first_name: string; last_name?: string; username?: string }): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || (user.username ? `@${user.username}` : "Unknown");
}

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "scene";
}

/**
 * Telegram deep link straight to one forum topic's thread, so a button can
 * take a user directly there instead of them scrolling the sidebar. Only
 * valid for supergroups, whose chat ids are always -100xxxxxxxxxx.
 */
export function topicDeepLink(chatId: number, telegramTopicId: number): string {
  const internalId = String(chatId).replace(/^-100/, "");
  return `https://t.me/c/${internalId}/${telegramTopicId}`;
}
