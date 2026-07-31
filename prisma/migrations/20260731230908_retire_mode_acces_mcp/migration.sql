/*
  Warnings:

  - You are about to drop the column `connectionId` on the `mcp_accesses` table. All the data in the column will be lost.
  - You are about to drop the column `mode` on the `mcp_accesses` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."mcp_accesses" DROP CONSTRAINT "mcp_accesses_connectionId_fkey";

-- AlterTable
ALTER TABLE "public"."mcp_accesses" DROP COLUMN "connectionId",
DROP COLUMN "mode";

-- DropEnum
DROP TYPE "public"."McpAccessMode";
