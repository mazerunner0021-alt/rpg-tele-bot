import { escapeHtml } from "../lib/format";

export interface PostViewData {
  accountName: string;
  photoUrl: string;
  caption: string | null;
  likeCount: number;
  createdAt: Date;
  comments: { accountName: string; text: string; createdAt: Date }[];
}

function timeAgo(date: Date): string {
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

/**
 * Server-rendered Mini App page for one Post — no client-side framework or
 * build step, just HTML/CSS with the Telegram WebApp JS SDK for theme
 * matching. Data is embedded directly rather than fetched client-side.
 */
export function renderPostPage(data: PostViewData): string {
  const commentsHtml = data.comments.length
    ? data.comments
        .map(
          (c) => `
        <div class="comment">
          <span class="comment-author">${escapeHtml(c.accountName)}</span>
          <span class="comment-text">${escapeHtml(c.text)}</span>
          <div class="comment-time">${escapeHtml(timeAgo(c.createdAt))}</div>
        </div>`
        )
        .join("")
    : `<div class="no-comments">No comments yet — reply to the post in the group to comment.</div>`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(data.accountName)}'s post</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root {
    --bg: #ffffff; --text: #111111; --hint: #707579; --link: #2481cc; --card: #f0f0f0; --separator: #e6e6e6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  }
  .card { max-width: 480px; margin: 0 auto; }
  .header { display: flex; align-items: center; gap: 10px; padding: 14px 16px; }
  .avatar {
    width: 36px; height: 36px; border-radius: 50%; background: var(--link);
    color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 600; flex-shrink: 0;
  }
  .account-name { font-weight: 600; font-size: 15px; }
  .photo-wrap { width: 100%; background: var(--card); }
  .photo-wrap img { width: 100%; display: block; }
  .actions { padding: 10px 16px 0; font-size: 14px; color: var(--hint); }
  .likes { font-weight: 600; color: var(--text); }
  .caption { padding: 8px 16px 14px; font-size: 14px; line-height: 1.4; }
  .caption .account-name { margin-right: 6px; }
  .separator { height: 1px; background: var(--separator); margin: 0 16px; }
  .comments { padding: 8px 16px 24px; }
  .comment { padding: 8px 0; font-size: 14px; line-height: 1.4; border-bottom: 1px solid var(--separator); }
  .comment:last-child { border-bottom: none; }
  .comment-author { font-weight: 600; margin-right: 6px; }
  .comment-time { color: var(--hint); font-size: 12px; margin-top: 2px; }
  .no-comments { color: var(--hint); font-size: 13px; padding: 12px 0; }
  .footer-time { padding: 0 16px 16px; color: var(--hint); font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; }
</style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="avatar">${escapeHtml(data.accountName.charAt(0).toUpperCase())}</div>
      <div class="account-name">${escapeHtml(data.accountName)}</div>
    </div>
    <div class="photo-wrap"><img src="${data.photoUrl}" alt="" /></div>
    <div class="actions">❤️ <span class="likes">${data.likeCount}</span> ${data.likeCount === 1 ? "like" : "likes"}</div>
    ${
      data.caption
        ? `<div class="caption"><span class="account-name">${escapeHtml(data.accountName)}</span>${escapeHtml(data.caption)}</div>`
        : ""
    }
    <div class="separator"></div>
    <div class="comments">${commentsHtml}</div>
    <div class="footer-time">${escapeHtml(timeAgo(data.createdAt))}</div>
  </div>
  <script>
    (function () {
      try {
        var tg = window.Telegram && window.Telegram.WebApp;
        if (!tg) return;
        tg.ready();
        tg.expand();
        var theme = tg.themeParams || {};
        var root = document.documentElement.style;
        if (theme.bg_color) root.setProperty("--bg", theme.bg_color);
        if (theme.text_color) root.setProperty("--text", theme.text_color);
        if (theme.hint_color) root.setProperty("--hint", theme.hint_color);
        if (theme.link_color) root.setProperty("--link", theme.link_color);
        if (theme.secondary_bg_color) root.setProperty("--card", theme.secondary_bg_color);
      } catch (e) {
        // Not running inside Telegram (e.g. opened directly in a browser) — plain light theme is fine.
      }
    })();
  </script>
</body>
</html>`;
}

export function renderNotFoundPage(): string {
  return `<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Post not found</title></head>
<body style="font-family: -apple-system, sans-serif; text-align: center; padding: 48px 16px; color: #707579;">
  <p>This post doesn't exist anymore.</p>
</body>
</html>`;
}
