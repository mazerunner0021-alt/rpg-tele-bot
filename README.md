# RPG Tele Bot

A production-ready Telegram bot for running group roleplay, built on Telegram's
**forum topics**. It gives every group a dedicated Casting topic (propose and
approve characters), lets admins spin up a forum topic per scene, casts
characters to players scene-by-scene, and automatically reformats a player's
messages as their in-character dialogue — bold character name, avatar
thumbnail, no OOC clutter — while they have an active role.

- **Language:** TypeScript (strict)
- **Bot framework:** [grammY](https://grammy.dev)
- **Database:** PostgreSQL via [Prisma](https://www.prisma.io), hosted on [Neon](https://neon.tech) (free tier)
- **Hosting:** [Render](https://render.com) free web service, webhook mode

## Table of contents

- [Features](#features)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local development setup](#local-development-setup)
- [Environment variables](#environment-variables)
- [Database & Prisma migrations](#database--prisma-migrations)
- [Deploying to Render](#deploying-to-render)
- [Setting the bot up in a Telegram group](#setting-the-bot-up-in-a-telegram-group)
- [Command reference](#command-reference)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)
- [Testing](#testing)

## Features

- **Setup flow** — checks the group has forum Topics enabled (with instructions
  if not), then auto-creates pinned 📋 Casting and 🎭 Introductions topics.
- **Character proposals** — any member proposes a character (name, description,
  optional photo) via a guided forced-reply flow; admins approve/reject with
  inline buttons.
- **Scene lifecycle** — admins create a scene (`/scene <name>`, optionally from
  a saved template), which becomes its own forum topic with a live setup card:
  set description, set a banner photo, assign cast (buttons *or* a
  `Name: @username` free-text shorthand), start the scene, close it.
- **Role switching + visual-flair reposting** — players tap "Switch character"
  to pick which of their assigned characters they're speaking as; every plain
  text message they send afterward is deleted and reposted as that character
  (bold name + avatar), rate-limited to protect against Bot API abuse.
- **Utility commands** — `/roll NdM` dice roller, `/character` card, scene
  templates, and `/export` transcript generation.
- **On-demand cleanup** — `/cleanup` removes the bot's own prompts,
  confirmations, and errors from a topic, keeping the RP content readable.
- **Scene index** — a pinned message in Casting (`/scenes`) listing every
  scene with a button that deep-links straight to its topic, so you don't
  have to hunt through the sidebar.
- **In-group social feed** — `/post` in the 📸 Feed topic reposts a photo
  under a self-service account (first post just asks for a name, no
  approval needed) with a "📱 View as Post" button that opens an
  Instagram-style card in Telegram's in-app browser (photo, caption, like
  count, comments), server-rendered with no build step. Replying to a post
  in-chat is a comment; native Telegram reactions on the post are mirrored
  as likes.
- All state lives in Postgres via Prisma — nothing important is held only in
  memory, so a Render restart/redeploy never loses in-progress work.

## Project structure

```
prisma/               Prisma schema + migrations
src/
  bot/                 grammY Bot construction, session storage, flow state, middleware
  config/              Environment variable loading/validation
  handlers/            One file per feature area: setup, casting, scenes, roles, utility
  lib/                 Shared helpers: admin cache, rate limiter, dice roller, cast parser, etc.
  server/              Express app (webhook + health) and webhook registration
  index.ts             Production entrypoint (webhook mode)
  dev-poll.ts          Optional local-dev entrypoint (long polling)
tests/                 Vitest unit tests for the pure-logic modules
render.yaml            Render Blueprint (service + env vars as code)
```

## Prerequisites

- Node.js 20.x and npm
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- A free [Neon](https://neon.tech) Postgres project
- A free [Render](https://render.com) account (for deployment)
- A Telegram group you can turn into a supergroup with Topics enabled

## Local development setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your bot with BotFather** and grab the token. While you're there:
   - Send `/setprivacy` → choose your bot → **Disable**. This is required —
     with privacy mode on, the bot only receives commands and replies, not
     plain group messages, which breaks both the in-character repost engine
     and OOC transcript logging.
   - Optionally send `/setjoingroups` → **Enable** (should be the default).

3. **Create a Neon project** at [neon.tech](https://neon.tech), then copy its
   connection string (Neon's dashboard → *Connect* → use the **pooled**
   connection string, which includes `-pooler` in the hostname).

4. **Copy `.env.example` to `.env`** and fill it in:

   ```bash
   cp .env.example .env
   ```

   - `BOT_TOKEN` — from BotFather
   - `DATABASE_URL` — your Neon pooled connection string
   - `WEBHOOK_SECRET` — any long random string, e.g.:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
   - `PORT` — `3000` is fine locally
   - `RENDER_EXTERNAL_URL` — leave blank for local dev (see below)

5. **Run the initial migration against your Neon database:**

   ```bash
   npx prisma migrate deploy
   ```

6. **Run the bot locally.** You have two options:

   - **Long polling (recommended for local dev, no public URL needed):**
     ```bash
     npm run dev:poll
     ```
     This uses `@grammyjs/runner` and clears any existing webhook first, so
     it "just works" without a tunnel.

   - **Webhook mode via a tunnel (optional, closer to production behavior).**
     Start a tunnel (e.g. `ngrok http 3000` or `cloudflared tunnel --url
     http://localhost:3000`), set `RENDER_EXTERNAL_URL` in `.env` to the
     `https://...` URL the tunnel prints, then:
     ```bash
     npm run dev
     ```
     This registers the webhook against your tunnel URL on boot. Remember to
     re-run (or re-register) if the tunnel URL changes.

7. **Add the bot to a Telegram group** and follow [Setting the bot up in a
   Telegram group](#setting-the-bot-up-in-a-telegram-group) below.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BOT_TOKEN` | yes | Bot token from BotFather |
| `DATABASE_URL` | yes | Postgres connection string (Neon pooled URL recommended) |
| `WEBHOOK_SECRET` | yes | Random secret; used as both the webhook's path segment and the value validated against Telegram's `X-Telegram-Bot-Api-Secret-Token` header |
| `PORT` | yes | HTTP server port (Render sets this for you in production) |
| `RENDER_EXTERNAL_URL` | no | Public HTTPS base URL, used at boot to register the webhook (`${RENDER_EXTERNAL_URL}/webhook/${WEBHOOK_SECRET}`). Render injects this automatically for web services; set it manually only for local tunnel testing. |

## Database & Prisma migrations

The schema lives in [`prisma/schema.prisma`](prisma/schema.prisma). An initial
migration is already committed under `prisma/migrations/`, generated offline
with `prisma migrate diff --from-empty` so the repo is deployable without ever
needing a live database connection at generation time.

- Apply migrations to Neon (also runs automatically in `render.yaml`'s build
  command):
  ```bash
  npx prisma migrate deploy
  ```
- After changing `prisma/schema.prisma` during development, create a new
  migration against your dev database:
  ```bash
  npx prisma migrate dev --name <what_changed>
  ```
- Regenerate the Prisma Client (also runs automatically after `npm install`
  via nothing special needed — just run it explicitly if types look stale):
  ```bash
  npx prisma generate
  ```
- Browse your data:
  ```bash
  npx prisma studio
  ```

## Deploying to Render

1. **Push this repository to GitHub** (or GitLab/Bitbucket).

2. **Create your Neon database** if you haven't already, and keep its pooled
   connection string handy.

3. **In Render, create a new Blueprint** (Dashboard → *New* → *Blueprint*) and
   point it at your repo. Render will read [`render.yaml`](render.yaml) and
   provision a single free web service called `rpg-tele-bot`.

4. **Set the secret environment variables** Render prompts for (these are
   marked `sync: false` in `render.yaml`, so Render asks for them instead of
   committing them):
   - `BOT_TOKEN`
   - `DATABASE_URL`
   - `WEBHOOK_SECRET` — generate one the same way as for local dev:
     ```bash
     node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     ```
     Don't let Render auto-generate this one for you: its generated values can
     include `+`, `/`, or `=`, which Telegram's `secret_token` parameter
     rejects (it only allows letters, digits, `_`, and `-`) — `setWebhook`
     will fail with a 400 at boot if that happens. A hex string like the one
     above is always safe.

   `RENDER_EXTERNAL_URL` is injected automatically by Render for every web
   service — you don't set that one yourself.

5. **Deploy.** Render will run `npm install && npm run build && npx prisma
   generate && npx prisma migrate deploy`, then start the service with `npm
   run start`. On boot, the bot registers its Telegram webhook at
   `https://<your-service>.onrender.com/webhook/<WEBHOOK_SECRET>` automatically
   — no manual `setWebhook` call needed.

6. **Verify:**
   - `GET https://<your-service>.onrender.com/health` should return `200 OK`.
   - Message your bot or add it to a group — it should respond.

7. **(Recommended) Keep the free instance warm.** Render's free web services
   spin down after ~15 minutes of inactivity, which delays the *next* webhook
   delivery until the instance wakes back up. Point an external uptime pinger
   (e.g. [UptimeRobot](https://uptimerobot.com) or
   [cron-job.org](https://cron-job.org)) at `GET /health` every 5–10 minutes.
   This is exactly what that endpoint is for.

## Setting the bot up in a Telegram group

1. Create a group (or use an existing one) and turn it into a **supergroup**
   if it isn't already (Telegram does this automatically once it has enough
   members, or via group settings).
2. Enable **Topics**: Group settings → **Edit** → **Topics** → on.
3. Add the bot to the group.
4. Promote the bot to **admin** with at least:
   - **Manage Topics** (to create/close the Casting, Introductions, and scene topics)
   - **Delete messages** (for the in-character repost engine)
   - **Pin messages** (for pinned instructions, banners, and scene control cards)
5. Run `/setup` in the group (or just wait — adding the bot as an admin
   triggers setup automatically). The bot creates 📋 Casting, 🎭
   Introductions, and 📸 Feed topics with pinned instructions.

## Command reference

| Command | Where | Who | What |
|---|---|---|---|
| `/setup` | anywhere in the group | admin | Enable/verify forum setup, create Casting + Introductions |
| `/scene [name]` | anywhere | admin | Create a new scene topic; with no name, offers saved templates |
| `/scenes` | anywhere | anyone | Show/refresh the pinned scene index in Casting (links straight to every scene's topic) |
| `/closescene` | in a scene topic | admin | Close the scene (and its forum topic) |
| `/addscenepic` | in an open scene topic | admin | Update the scene's banner photo |
| `/savetemplate <name>` | in a scene topic | admin | Save this scene's title+description as a reusable template |
| `/export` | in a scene topic | admin | Export the logged transcript as a `.txt` file |
| `/switch` | in an open scene topic | anyone with a role | Re-show the character picker (in case the pinned one scrolled away) |
| `/character` | in a scene topic | anyone | Show your active character's card in this topic |
| `/post` | in 📸 Feed only | anyone | Post a photo (+ optional caption) to the Feed; first time asks for an account name |
| `/feed` | anywhere | anyone | See/switch your Feed accounts, or create a new one |
| `/roll NdM` | anywhere | anyone | Roll dice, e.g. `/roll 2d6` (max 20 dice, max 1000 sides) |
| `/cancel` | anywhere | anyone | Cancel your current in-progress multi-step action |
| `/cleanup` | any topic | admin | Delete the bot's prompts, confirmations, and errors tracked in this topic |
| `/help`, `/start` | anywhere | anyone | Show a command summary |

Most of these also have inline-button equivalents (proposing a character,
assigning cast, starting/closing a scene, switching character) — the commands
exist as a keyboard-free fallback.

## Design decisions

The spec was detailed but left some points ambiguous or, in one case,
self-contradictory. Here's what was decided and why.

**`@grammyjs/runner` vs. webhook mode.** The spec asks for both "use
`@grammyjs/runner` for scalability" *and* "webhook mode (not long polling)" —
but `@grammyjs/runner` is grammY's concurrent **long-polling** runner; it has
no role in webhook mode, and a single bot token can't have an active webhook
and an active long-polling loop at the same time. Since every other
requirement (the `render.yaml` blueprint, `WEBHOOK_SECRET`,
`RENDER_EXTERNAL_URL`, `POST /webhook/:secret`, the boot-time `setWebhook`
step) unambiguously commits to webhooks, production (`src/index.ts`) uses
`webhookCallback` and never touches the runner. `@grammyjs/runner` is instead
used in `src/dev-poll.ts`, an optional local-dev-only entrypoint
(`npm run dev:poll`) for testing without a public URL/tunnel — so the
dependency is genuinely used, just not in production.

**Extra Prisma models beyond the six named in the spec.** `Group`, `Topic`,
`Character`, `Scene`, `SceneCast`, and `ActiveRole` are exactly as specified.
Four more were added because other required features need somewhere to persist
state:
- `GroupMember` — the Bot API has no "list all group members" endpoint (only
  `getChatAdministrators` and `getChatMember`-by-id). This table is a roster
  built from users the bot has actually observed messaging, and is what
  powers both the "assign cast" member picker and `@username` resolution in
  the free-text cast shorthand.
- `SceneTemplate` — backs `/savetemplate` and the template picker in `/scene`.
- `SceneMessage` — a log of text seen in `OPEN` scene topics (in-character
  reposts *and* OOC passthrough), since bots can't read arbitrary past group
  history via the Bot API; this is the only data `/export` has to work with.
- `BotSession` — backing store for grammY's session middleware (see below).

**Session/flow state is persisted to Postgres, not memory.** Multi-step
forced-reply flows (proposing a character, setting a scene description,
assigning cast) are modeled as a discriminated union (`src/bot/sessionTypes.ts`)
stored via grammY's session middleware, backed by a custom `StorageAdapter`
that reads/writes the `BotSession` table (`src/bot/session.ts`). This was the
one place an in-memory-only implementation would have been the "normal"
choice, but the spec is explicit that no state should be lost on a Render
restart/redeploy — so it's in Postgres too. Flows carry a start timestamp and
expire after 15 minutes (`src/bot/flow.ts`) so an abandoned flow can't
accidentally swallow an unrelated message sent much later.

**The group-admin cache is the one piece of state that stays in memory**
(`src/lib/adminCheck.ts`), intentionally, unlike the session store above:
it's pure derived data (Telegram is always the source of truth for who's an
admin), refreshed via `getChatAdministrators` on a 5-minute TTL per chat.
Losing it on restart just means the next permission check repopulates it —
there's nothing to lose.

**Approve/Reject (and other admin-only) buttons are visible to everyone.**
Telegram's Bot API has no concept of a per-user-visible inline keyboard —
every member in the topic sees the same buttons. "Visible only to group
admins" is implemented as a server-side check on tap (`requireGroupAdminCallback`
in `src/bot/guards.ts`): a non-admin tapping Approve/Reject gets a toast
saying so and nothing happens.

**One evolving "scene control message" instead of separate messages per
phase.** `Scene.controlMessageId` is posted once (pinned) and edited in place
throughout the scene's life: it's the CASTING-phase setup card (set
description/banner, assign cast, start), then becomes the OPEN-phase control
surface (switch character, add photo, close), then the CLOSED summary. This
satisfies "keep a pinned control message" for character switching without
spamming the topic with a new pinned message per phase, and the "assign cast"
button wizard (pick a character → pick a member → repeat) is implemented by
editing this same message in place rather than sending new ones.

**One banner field, not a `ScenePhoto` list.** The spec explicitly left this
as an implementer's choice. `Scene.bannerFileId` holds the current banner;
`/addscenepic` (and its button) overwrite it and re-pin the new photo. This
matches "banner" semantics (a scene has one current banner) and keeps the
data model simple; a `ScenePhoto` gallery is a natural extension if a group
wants a full photo history later, but nothing in the spec's usage examples
needed it.

**The `SETUP` topic type represents the group's implicit "General" topic.**
The spec's `Topic.type` enum includes `SETUP`, but the setup flow itself only
actively creates `CASTING` and `INTRO` topics. `/setup` registers a `SETUP`
row with `telegramTopicId = 0` (Telegram's General topic carries no
`message_thread_id`) purely for bookkeeping completeness.

**Rejecting *and* approving both notify the proposer.** The spec calls out
notification explicitly for rejection; approval was extended to match, since
"your character was approved" is at least as useful to know as a rejection,
and it costs nothing extra. Notification is a dedicated message with a
`tg://user` text-mention (which pings the user) rather than a DM, since bots
cannot message a user who hasn't started a conversation with them first.

**Rate-limited reposts drop the reformat, they never drop content.** When a
user exceeds ~20 reposts/minute in one scene, the bot leaves their message
exactly as sent (no delete, no repost) rather than queuing it — simpler to
reason about, and it trivially guarantees the "never drop the user's message
content" requirement. The message is still logged to `SceneMessage` under
their real name for the transcript, and the rate limit is logged as a warning.

**CommonJS output, not ESM.** `tsconfig.json` targets CommonJS so `node
dist/index.js` runs directly on Render with no loader flags or `"type":
"module"` interop concerns with grammY/Prisma/Express.

**Clutter cleanup is on-demand (`/cleanup`), not automatic deletion.** Every
bot-sent prompt/confirmation/error, and the raw replies that feed a
forced-reply flow, are tracked in an `EphemeralMessage` table as they're
sent. `/cleanup` bulk-deletes everything tracked for the current topic. This
was chosen over auto-deleting messages the instant they're superseded
because a manual, explicit command is safer to reason about (nothing
disappears mid-conversation while someone's still reading it) and matches
what was actually asked for. Deliberately never tracked as ephemeral: the
pinned control cards, character proposal cards, banners, RP dialogue,
approval/rejection notices, and `/roll`/`/character` results — anything
that's a record of something, not just clutter from getting there.

**The scene index links to topics, it doesn't group them — because Telegram
can't.** Forum topics are a flat list with no folder/nesting API; there's no
way for a bot (or anyone) to make several topics collapse into one entry in
the sidebar. `/scenes` is the closest practical alternative: one pinned
message in Casting listing every scene with a button that deep-links
straight to it (`t.me/c/<chat>/<topic>`), refreshed whenever a scene is
created, opened, or closed. It reduces sidebar-hunting; it doesn't reduce
the sidebar itself. A `/deletescenetopic`-style command that actually
removes old closed topics from the sidebar (auto-exporting the transcript
first, with the data staying in Postgres regardless of what happens to the
Telegram topic) was scoped out for now but would be a natural follow-up.

**The "View as Post" button is a plain `url` button, not a `web_app`
button.** The Bot API rejects `web_app` inline buttons with
`BUTTON_TYPE_INVALID` when attached to a message a bot sends directly into a
group — that button type only works from a private chat with the bot,
something confirmed the hard way against the live bot (every `/post`
briefly failed until this was caught and fixed). A plain `url` button
pointing at the same page works from anywhere and opens Telegram's in-app
browser, which for a read-only viewer like this looks and behaves almost
identically — the page still applies Telegram's theme colors via the
WebApp JS SDK where available, and degrades to a plain page otherwise. The
one thing a `url` link can't do that a true registered Mini App could is use
the deeper WebApp JS bridge (haptics, a native MainButton, `sendData` back
to the chat) — not needed for this viewer today, but the upgrade path is a
one-time manual step (register the page with @BotFather via `/newapp`, then
link to it as `t.me/<bot>/<shortname>?startapp=<postId>` instead of the
plain HTTPS URL) if that's ever wanted.

**The Feed's Mini App never stores a photo either — same proxy pattern as
everywhere else.** `GET /media/:fileId` calls Telegram's `getFile` fresh on
every request and streams the bytes straight through (`src/lib/media.ts`);
nothing touches disk or Postgres. The only things persisted are `Post` /
`PostComment` rows — tiny pointers (`fileId`, text, account, timestamps) —
because there's no Bot API query for "get replies to message X" either, so
comments have to be captured incrementally as replies arrive, exactly like
the `SceneMessage` transcript log.

**Feed identities (`FeedAccount`) are self-service and deliberately separate
from the curated `Character` model** used by Casting/Scenes — posting to the
Feed does not require proposing a character, admin approval, or being cast
in a scene. First `/post` (or `/feed`) just asks for a name and you're
posting seconds later; `FeedPersona` (`{groupId, userId}` → `feedAccountId`)
remembers which account is currently active, auto-resolved when you only
have one, prompted via a picker (with a "create new account" option) when
you have several. This was a deliberate pivot from an earlier version that
required scene casting — it added real friction for a feature meant to be
the easy, casual one, and had nothing to do with `ActiveRole`'s actual job
(tracking who's speaking as whom *inside a scene's dialogue*), so bending it
to fit would have meant coupling two unrelated concerns.

**Likes mirror Telegram's native reactions rather than inventing a button.**
`message_reaction` updates are opt-in (excluded from the Bot API's default
`allowed_updates`) — easy to miss, and does need requesting explicitly in
both `setWebhook` and the long-polling dev entrypoint (`src/dev-poll.ts`).
`PostReaction` tracks *whether* a user reacted, not which emoji, so switching
between 👍/❤️/etc. doesn't double-count and removing a reaction removes the
like.

## Known limitations

- **No full member list.** Because the Bot API doesn't expose one, the "known
  members" roster (`GroupMember`) only contains users who have sent at least
  one message in the group since the bot joined. A brand-new or silent member
  won't appear in the cast-assignment picker, and `@username` in the cast
  shorthand won't resolve for them, until they post something. There's no way
  around this with bot-only permissions.
- **Transcripts are best-effort.** `/export` can only include messages the bot
  itself has seen while running (with privacy mode disabled) in an `OPEN`
  scene topic — it cannot retrieve history from before the bot joined, from
  while privacy mode was enabled, or from any downtime.
- **Admin-only buttons are visible to everyone** in the topic (see "Design
  decisions" above); enforcement happens on tap, not via hiding the button.
- **Free-tier Render cold starts.** Without an external keep-warm pinger
  hitting `/health`, the service spins down after inactivity and the first
  webhook delivery after that will be delayed until it wakes up.
- **The Mini App post page (`GET /app/post/:postId`) isn't access-controlled.**
  Anyone with the exact link can view it without being a group member or
  opening it through Telegram — `postId`s aren't guessable (random UUIDs),
  but the link isn't secret once shared, roughly equivalent to forwarding a
  screenshot. Proper `initData` verification (confirming the request really
  came from Telegram, and who as) is the natural next step if that matters
  for a given group.
- **A comment only gets mirrored into the Mini App if the commenter has a
  resolved Feed account.** If someone has never posted or run `/feed`, their
  reply still shows up fine in the topic itself but silently doesn't appear
  in the comment thread server-side — there's no repeated nagging on every
  comment attempt by design (see "Design decisions"), so if a comment seems
  to be missing from the Mini App, that's almost always why.

## Testing

```bash
npm test
```

Unit tests (Vitest) cover the pure-logic modules that don't need a live
Telegram connection or database: the dice roller, the free-text cast
shorthand parser, and the rate limiter.

```bash
npm run typecheck   # tsc --noEmit
npm run build        # tsc -p tsconfig.json → dist/
```
