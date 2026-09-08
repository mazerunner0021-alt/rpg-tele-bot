-- DropForeignKey
ALTER TABLE "FeedPersona" DROP CONSTRAINT "FeedPersona_characterId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_characterId_fkey";

-- DropForeignKey
ALTER TABLE "PostComment" DROP CONSTRAINT "PostComment_characterId_fkey";

-- DropIndex
DROP INDEX "FeedPersona_characterId_idx";

-- AlterTable
ALTER TABLE "FeedPersona" DROP COLUMN "characterId",
ADD COLUMN     "feedAccountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "characterId",
ADD COLUMN     "feedAccountId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "PostComment" DROP COLUMN "characterId",
ADD COLUMN     "feedAccountId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "FeedAccount" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeedAccount_groupId_idx" ON "FeedAccount"("groupId");

-- CreateIndex
CREATE INDEX "FeedAccount_groupId_userId_idx" ON "FeedAccount"("groupId", "userId");

-- CreateIndex
CREATE INDEX "FeedPersona_feedAccountId_idx" ON "FeedPersona"("feedAccountId");

-- AddForeignKey
ALTER TABLE "FeedAccount" ADD CONSTRAINT "FeedAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedPersona" ADD CONSTRAINT "FeedPersona_feedAccountId_fkey" FOREIGN KEY ("feedAccountId") REFERENCES "FeedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_feedAccountId_fkey" FOREIGN KEY ("feedAccountId") REFERENCES "FeedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_feedAccountId_fkey" FOREIGN KEY ("feedAccountId") REFERENCES "FeedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

