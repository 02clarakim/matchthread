-- CreateEnum
CREATE TYPE "SocialMediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "social_posts" ADD COLUMN     "mediaType" "SocialMediaType";
