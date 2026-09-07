-- CreateEnum
CREATE TYPE "TopicType" AS ENUM ('SETUP', 'CASTING', 'INTRO', 'SCENE');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "CharacterStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SceneStatus" AS ENUM ('CASTING', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "telegramChatId" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "isForumEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topic" (
    "id" TEXT NOT NULL,
    "telegramTopicId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" "TopicType" NOT NULL,
    "status" "TopicStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "avatarFileId" TEXT,
    "status" "CharacterStatus" NOT NULL DEFAULT 'PENDING',
    "proposedByUserId" BIGINT NOT NULL,
    "proposalMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "bannerFileId" TEXT,
    "status" "SceneStatus" NOT NULL DEFAULT 'CASTING',
    "createdByUserId" BIGINT NOT NULL,
    "controlMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneCast" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneCast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveRole" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "username" TEXT,
    "displayName" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneTemplate" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdByUserId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneMessage" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "displayName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSession" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSession_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Group_telegramChatId_key" ON "Group"("telegramChatId");

-- CreateIndex
CREATE INDEX "Topic_groupId_idx" ON "Topic"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "Topic_groupId_telegramTopicId_key" ON "Topic"("groupId", "telegramTopicId");

-- CreateIndex
CREATE INDEX "Character_groupId_idx" ON "Character"("groupId");

-- CreateIndex
CREATE INDEX "Character_groupId_status_idx" ON "Character"("groupId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_topicId_key" ON "Scene"("topicId");

-- CreateIndex
CREATE INDEX "Scene_groupId_idx" ON "Scene"("groupId");

-- CreateIndex
CREATE INDEX "Scene_groupId_status_idx" ON "Scene"("groupId", "status");

-- CreateIndex
CREATE INDEX "SceneCast_sceneId_idx" ON "SceneCast"("sceneId");

-- CreateIndex
CREATE INDEX "SceneCast_characterId_idx" ON "SceneCast"("characterId");

-- CreateIndex
CREATE INDEX "SceneCast_sceneId_userId_idx" ON "SceneCast"("sceneId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneCast_sceneId_characterId_key" ON "SceneCast"("sceneId", "characterId");

-- CreateIndex
CREATE INDEX "ActiveRole_sceneId_idx" ON "ActiveRole"("sceneId");

-- CreateIndex
CREATE INDEX "ActiveRole_characterId_idx" ON "ActiveRole"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveRole_userId_sceneId_key" ON "ActiveRole"("userId", "sceneId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_username_idx" ON "GroupMember"("groupId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "GroupMember_groupId_userId_key" ON "GroupMember"("groupId", "userId");

-- CreateIndex
CREATE INDEX "SceneTemplate_groupId_idx" ON "SceneTemplate"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "SceneTemplate_groupId_name_key" ON "SceneTemplate"("groupId", "name");

-- CreateIndex
CREATE INDEX "SceneMessage_sceneId_idx" ON "SceneMessage"("sceneId");

-- CreateIndex
CREATE INDEX "SceneMessage_sceneId_createdAt_idx" ON "SceneMessage"("sceneId", "createdAt");

-- AddForeignKey
ALTER TABLE "Topic" ADD CONSTRAINT "Topic_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "Topic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneCast" ADD CONSTRAINT "SceneCast_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneCast" ADD CONSTRAINT "SceneCast_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveRole" ADD CONSTRAINT "ActiveRole_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActiveRole" ADD CONSTRAINT "ActiveRole_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupMember" ADD CONSTRAINT "GroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneTemplate" ADD CONSTRAINT "SceneTemplate_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneMessage" ADD CONSTRAINT "SceneMessage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

