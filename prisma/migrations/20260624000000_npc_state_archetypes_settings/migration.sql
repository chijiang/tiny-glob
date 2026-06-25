-- AlterTable:对话记录增加 NPC 状态快照(NpcState JSONB)
ALTER TABLE "Friend" ADD COLUMN "state" JSONB;

-- CreateTable:可后台调整的键值配置(稀遇概率等)
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable:稀遇(隐藏)NPC 原型池,数据驱动
CREATE TABLE "HiddenArchetype" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "flavor" TEXT NOT NULL,
    "directive" TEXT NOT NULL,
    "stateOverride" JSONB,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HiddenArchetype_pkey" PRIMARY KEY ("id")
);

-- CreateIndex:HiddenArchetype.key 唯一
CREATE UNIQUE INDEX "HiddenArchetype_key_key" ON "HiddenArchetype"("key");
