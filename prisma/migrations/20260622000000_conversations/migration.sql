-- 对话持久化迁移
-- 物理表名仍为 "Friend"(Conversation 模型 @@map("Friend")),避免重命名数据风险。
-- 把 7 个 NPC 标量列合并为 npc JSONB;把 Message 关系表聚合为 messages JSONB。

-- 1) 新增列(带临时默认值,兼容已有行)
ALTER TABLE "Friend" ADD COLUMN "localId" TEXT;
ALTER TABLE "Friend" ADD COLUMN "npc" JSONB;
ALTER TABLE "Friend" ADD COLUMN "summary" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Friend" ADD COLUMN "messages" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "Friend" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Friend" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2) NPC 数据迁移:7 列 → npc
UPDATE "Friend" SET "npc" = jsonb_build_object(
  'name', "name",
  'age', "age",
  'gender', "gender",
  'occupation', "occupation",
  'family', "family",
  'personality', "personality",
  'openingLine', "openingLine"
);

-- 3) 消息迁移:Message 行 → messages(按时间排序)
UPDATE "Friend" f SET "messages" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object('role', m."role", 'content', m."content") ORDER BY m."createdAt")
  FROM "Message" m WHERE m."friendId" = f."id"
), '[]'::jsonb);

-- 4) 既有「朋友」均为显式收藏 → favorite = true
UPDATE "Friend" SET "favorite" = true;

-- 5) updatedAt 取最近消息时间,回退 createdAt
UPDATE "Friend" f SET "updatedAt" = COALESCE(
  (SELECT MAX(m."createdAt") FROM "Message" m WHERE m."friendId" = f."id"),
  "createdAt"
);

-- 6) 删除旧 NPC 标量列
ALTER TABLE "Friend" DROP COLUMN "name";
ALTER TABLE "Friend" DROP COLUMN "age";
ALTER TABLE "Friend" DROP COLUMN "gender";
ALTER TABLE "Friend" DROP COLUMN "occupation";
ALTER TABLE "Friend" DROP COLUMN "family";
ALTER TABLE "Friend" DROP COLUMN "personality";
ALTER TABLE "Friend" DROP COLUMN "openingLine";

-- 7) 去掉临时默认值,与 schema 对齐(messages/updatedAt 无 @default;summary/favorite 保留)
ALTER TABLE "Friend" ALTER COLUMN "messages" DROP DEFAULT;
ALTER TABLE "Friend" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- 8) localId 唯一约束
CREATE UNIQUE INDEX "Friend_localId_key" ON "Friend"("localId");

-- 9) 删除 Message 表
DROP TABLE "Message";
