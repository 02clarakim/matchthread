-- AlterEnum
ALTER TYPE "CommentarySource" ADD VALUE 'LLM';

-- AlterTable
ALTER TABLE "match_events" ADD COLUMN     "sourceText" TEXT;
