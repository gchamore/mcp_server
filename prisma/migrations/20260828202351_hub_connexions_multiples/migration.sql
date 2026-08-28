-- AlterTable
ALTER TABLE "oauth_grants" ADD COLUMN     "connectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "oauth_tokens" ADD COLUMN     "connectionIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
