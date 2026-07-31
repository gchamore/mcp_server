-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."AuthProvider" AS ENUM ('LOCAL', 'GOOGLE');

-- CreateEnum
CREATE TYPE "public"."ConnectionStatus" AS ENUM ('PENDING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "public"."McpAccessMode" AS ENUM ('INDIVIDUAL', 'SHARED');

-- CreateEnum
CREATE TYPE "public"."OAuthTokenType" AS ENUM ('ACCESS', 'REFRESH');

-- CreateTable
CREATE TABLE "public"."users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "avatarUrl" TEXT,
    "role" "public"."Role" NOT NULL DEFAULT 'USER',
    "provider" "public"."AuthProvider" NOT NULL DEFAULT 'LOCAL',
    "googleId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Compte principal',
    "credentials" TEXT NOT NULL,
    "status" "public"."ConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "statusMessage" TEXT,
    "accountLabel" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mcp_endpoints" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Point d''accès',
    "lastUsedAt" TIMESTAMP(3),
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tool_invocations" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "endpointId" TEXT,
    "connectorId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."password_reset_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT,
    "isStatic" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "grantTypes" TEXT[],
    "scopes" TEXT[],
    "registeredFromIp" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mcp_accesses" (
    "id" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "mode" "public"."McpAccessMode" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "connectionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_grants" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectionId" TEXT,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "scopes" TEXT[],
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."oauth_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "type" "public"."OAuthTokenType" NOT NULL,
    "oauthClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectorId" TEXT NOT NULL,
    "connectionId" TEXT,
    "scopes" TEXT[],
    "resource" TEXT,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "public"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "public"."users"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "public"."sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "public"."sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "public"."sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "connections_userId_idx" ON "public"."connections"("userId");

-- CreateIndex
CREATE INDEX "connections_connectorId_idx" ON "public"."connections"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "connections_userId_connectorId_label_key" ON "public"."connections"("userId", "connectorId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_endpoints_tokenHash_key" ON "public"."mcp_endpoints"("tokenHash");

-- CreateIndex
CREATE INDEX "mcp_endpoints_connectionId_idx" ON "public"."mcp_endpoints"("connectionId");

-- CreateIndex
CREATE INDEX "tool_invocations_connectionId_createdAt_idx" ON "public"."tool_invocations"("connectionId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_invocations_connectorId_createdAt_idx" ON "public"."tool_invocations"("connectorId", "createdAt");

-- CreateIndex
CREATE INDEX "tool_invocations_createdAt_idx" ON "public"."tool_invocations"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "public"."password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "public"."password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "public"."password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "public"."audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "public"."audit_logs"("action", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_clients_clientId_key" ON "public"."oauth_clients"("clientId");

-- CreateIndex
CREATE INDEX "mcp_accesses_connectorId_idx" ON "public"."mcp_accesses"("connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_accesses_oauthClientId_connectorId_key" ON "public"."mcp_accesses"("oauthClientId", "connectorId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_grants_codeHash_key" ON "public"."oauth_grants"("codeHash");

-- CreateIndex
CREATE INDEX "oauth_grants_expiresAt_idx" ON "public"."oauth_grants"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_tokens_tokenHash_key" ON "public"."oauth_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "oauth_tokens_userId_connectorId_idx" ON "public"."oauth_tokens"("userId", "connectorId");

-- CreateIndex
CREATE INDEX "oauth_tokens_familyId_idx" ON "public"."oauth_tokens"("familyId");

-- CreateIndex
CREATE INDEX "oauth_tokens_expiresAt_idx" ON "public"."oauth_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."connections" ADD CONSTRAINT "connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_endpoints" ADD CONSTRAINT "mcp_endpoints_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tool_invocations" ADD CONSTRAINT "tool_invocations_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "public"."mcp_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_accesses" ADD CONSTRAINT "mcp_accesses_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "public"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_accesses" ADD CONSTRAINT "mcp_accesses_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mcp_accesses" ADD CONSTRAINT "mcp_accesses_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_grants" ADD CONSTRAINT "oauth_grants_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "public"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_grants" ADD CONSTRAINT "oauth_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_grants" ADD CONSTRAINT "oauth_grants_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "public"."connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_oauthClientId_fkey" FOREIGN KEY ("oauthClientId") REFERENCES "public"."oauth_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."oauth_tokens" ADD CONSTRAINT "oauth_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

