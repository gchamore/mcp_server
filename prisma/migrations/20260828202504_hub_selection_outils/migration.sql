-- AlterTable
ALTER TABLE "oauth_grants" ADD COLUMN     "toolSelection" JSONB;

-- AlterTable
ALTER TABLE "oauth_tokens" ADD COLUMN     "toolSelection" JSONB;
