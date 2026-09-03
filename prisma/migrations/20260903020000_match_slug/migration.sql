-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "matches_slug_key" ON "matches"("slug");
