-- CreateTable
CREATE TABLE "EphemeralMessage" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "telegramTopicId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EphemeralMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EphemeralMessage_groupId_telegramTopicId_idx" ON "EphemeralMessage"("groupId", "telegramTopicId");

-- AddForeignKey
ALTER TABLE "EphemeralMessage" ADD CONSTRAINT "EphemeralMessage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

