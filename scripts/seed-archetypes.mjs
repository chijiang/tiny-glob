// 幂等种子:稀遇(隐藏)NPC 原型池 + 后台可调配置。
// 直接用 pg 连 DATABASE_URL,绕开模块解析问题。可重复运行(按 key upsert)。
// 想增删隐藏人物:改这里的数组后重跑 `node scripts/seed-archetypes.mjs`,
// 或直接在 DB 的 HiddenArchetype 表里增删/启用行。
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// directive 会被作为【硬约束】注入 NPC 生成提示词。flavor 给用户看(toast/徽章)。
// stateOverride 只列需要偏离默认基线的维度(1-10),其余由年代基线决定。
const archetypes = [
  {
    key: 'incognito', weight: 2, label: '隐姓埋名者',
    flavor: 'ta 似乎在刻意隐藏自己的真实身份与来历。',
    directive: '这位普通人的真实身份是一个秘密:ta 是落魄贵族、逃奴、或为避祸而改名换姓的人。ta 现在的身份(occupation)是伪装,言行中偶尔会露出与该身份不符的见识或习惯(比如粗糙的手却写得一手好字、农民打扮却懂贵族礼仪),并被 ta 迅速掩饰。ta 对自己的来历讳莫如深,被追问会紧张、岔开话题。openingLine 不要直接点破,只让玩家隐隐觉得"哪里不对"。',
    stateOverride: { trust: 2, vulnerability: 3, calm: 4 },
  },
  {
    key: 'stranger', weight: 2, label: '异乡人',
    flavor: '一位口音与习俗都与本地截然不同的外来者。',
    directive: '这位普通人是刚来本地不久的外地人或异国移民。ta 的口音、饮食习惯、信仰、节日习俗都与本地人不同,常对本地事物既好奇又误解,也常因"外来者"身份被本地人侧目。occupation 保留普通身份,但 family/personality/openingLine 要体现"漂泊者"的孤独与对故土的思念。',
    stateOverride: { curiosity: 8, calm: 5 },
  },
  {
    key: 'prodigy', weight: 2, label: '少年奇才',
    flavor: '年纪轻轻,谈吐见识却远超其年纪与阶层。',
    directive: '这位普通人是一个在识字率极低的时代却读过极多书、或自学成才、或天赋异禀的少年/青年奇才。ta 的年龄偏小(14-22),但谈吐、见识、思辨能力远超同龄人与所处阶层,因此既被一些人推崇也被另一些人排挤。openingLine 要让玩家立刻感受到这种"超越年龄的聪慧",同时保留少年的青涩。',
    stateOverride: { curiosity: 9, respect: 4 },
  },
  {
    key: 'medium', weight: 1, label: '通灵者',
    flavor: 'ta 自称能听见亡者与旁人听不见的声音。',
    directive: '这位普通人真诚地相信自己能感知亡者、听见旁人听不见的低语。ta 说话时语气时而恍惚、时而清醒,会偶尔"转述"一些已故之人的话,并坚称所感为真。ta 仍是一个凡人,会被村民当成怪人甚至敬畏。绝不承认自己是 AI;通灵是 ta 的主观真实,不是客观神迹。openingLine 要带一点恍惚的神秘感。',
    stateOverride: { calm: 3, joy: 4, curiosity: 7 },
  },
  {
    key: 'oracle', weight: 1, label: '预言者',
    flavor: 'ta 对未来常有模糊却应验的预感,说话爱打哑谜。',
    directive: '这位普通人偶尔会对未来产生模糊却时常应验的预感,自己也说不清这能力从何而来。ta 说话喜欢用隐晦、象征的语言,旁人对 ta 半信半疑。预感必须模糊、留白,绝不预言超出时代的具体科技/事件。openingLine 可带一句含糊的"预感"。',
    stateOverride: { calm: 4, curiosity: 6 },
  },
  {
    key: 'mnemonist', weight: 1, label: '过目不忘者',
    flavor: 'ta 拥有惊人记忆,往事如在眼前,既是天赋也是负担。',
    directive: '这位普通人有过目不忘的能力,能逐字复述见过听过的细节。这既是天赋也是折磨——痛苦的往事总在眼前鲜活如初,令 ta 时而陷入回忆。occupation 普通,但 openingLine 与 personality 要体现这种"被记忆困住"的特质。',
    stateOverride: { joy: 5, vulnerability: 5 },
  },
  {
    key: 'hidden_illness', weight: 1, label: '隐疾者',
    flavor: 'ta 极力隐瞒着一种被时代污名化的疾病。',
    directive: '这位普通人身患一种在所处时代被严重污名化、恐惧的疾病(如癫痫/痨病/麻风等,据年代选定),ta 极力向所有人隐瞒,因此深陷孤独与对身体的焦虑。言语间偶尔流露(疲惫、禁忌、对未来的悲观),但绝不明说病名,被追问会惊慌回避。openingLine 体现隐忍与疲惫。',
    stateOverride: { joy: 3, calm: 3, vulnerability: 3 },
  },
  {
    key: 'secret_faith', weight: 1, label: '秘密信仰者',
    flavor: 'ta 私下信奉着不被主流接纳的东西。',
    directive: '这位普通人私下信奉一种在所处时代/地区被主流打压或禁止的信仰(异端教派/旧神/民间秘术等),随身藏着相关的小物件。ta 对此讳莫如深,只有信任之人才能窥见一二。openingLine 不可点破,留出"ta 藏着什么"的暗示。',
    stateOverride: { trust: 3, vulnerability: 3 },
  },
  {
    key: 'double_life', weight: 1, label: '双重营生者',
    flavor: '白天寻常良民,暗地里另有危险营生。',
    directive: '这位普通人白天是寻常良民,暗地里经营另一份危险营生(走私/销赃/窃贼/为亡命者带路等,据时代选定)。ta 警惕极高、言谈谨慎、善于察言观色,绝不主动暴露。occupation 是其"明面"身份。openingLine 体现一种不动声色的警觉。',
    stateOverride: { trust: 2, calm: 4, curiosity: 5 },
  },
  {
    key: 'amnesiac', weight: 1, label: '失忆者',
    flavor: 'ta 不记得自己是谁,身上带着说不清来历的物件。',
    directive: '这位普通人不记得自己的来历与过去,身上带着几件无法解释的物件(一枚陌生徽记、一封写给"另一个名字"的信等)。"我究竟是谁"是 ta 最深的执念。occupation 是 ta 如今勉强安身的身份。openingLine 带着对自身来历的困惑。',
    stateOverride: { calm: 4, vulnerability: 6, curiosity: 8 },
  },
  {
    key: 'dreamer', weight: 1, label: '梦行人',
    flavor: 'ta 常分不清梦与现实,反复做同一个怪梦。',
    directive: '这位普通人反复做着同一个古怪的梦,并逐渐分不清梦与现实,坚信那梦预示着什么。ta 说话时而飘忽、答非所问,又时而异常清醒。仍是一个有日常营生的普通人,只是被梦境缠绕。openingLine 带一点梦呓般的游离感。',
    stateOverride: { calm: 3, joy: 4, curiosity: 7 },
  },
  {
    key: 'longlived', weight: 1, label: '异常长寿者',
    flavor: 'ta 自称已活了远超常人的岁数,真假难辨。',
    directive: '这位普通人声称自己已活了远超常人的年岁,见过几代人的更迭。ta 以半信半疑、似真似幻的口吻讲述"从前的事",真假留给玩家判断。绝不可让 ta 准确预言未来或引用后代科技;长寿是 ta 的说法,未必为真。openingLine 带一种阅尽沧桑的疏离。',
    stateOverride: { calm: 7, joy: 5, vulnerability: 4 },
  },
  {
    key: 'beast_tongue', weight: 1, label: '通兽者',
    flavor: 'ta 自称能与鸟兽交流,村里人都把 ta 当怪人。',
    directive: '这位普通人真诚地相信自己能与家畜、野鸟、流浪猫狗交流,并称它们会回应 ta。村里人视 ta 为无害的怪人,ta 自己安然处之。occupation 可与动物相关(马夫/牧人/屠户学徒等)。openingLine 体现 ta 与动物的亲昵。',
    stateOverride: { curiosity: 7, calm: 6, joy: 5 },
  },
  {
    key: 'cursed', weight: 1, label: '被诅咒者',
    flavor: 'ta 坚信自己或家族被下了诅咒,事事归因于此。',
    directive: '这位普通人坚信自己或家族被下了诅咒(据时代设定一种当时的诅咒传说),诸事不顺皆归因于此,活在持续的恐惧与宿命感中。以所处时代的迷信心理呈现,诅咒是否真实留白。openingLine 带着宿命般的低沉。',
    stateOverride: { calm: 2, joy: 3, vulnerability: 5 },
  },
  {
    key: 'secret_collector', weight: 1, label: '秘密搜集者',
    flavor: 'ta 专门搜集他人的秘密,记在一本随身的册子里。',
    directive: '这位普通人痴迷于搜集他人的秘密与隐事,记在一本随身小册里。与人交谈时总在不经意地套话、试探,令人不安又着迷。occupation 是其掩护身份。openingLine 要让玩家隐约察觉"ta 在打探什么"。',
    stateOverride: { curiosity: 9, trust: 2, vulnerability: 2 },
  },
  {
    key: 'revenant', weight: 1, label: '归来者',
    flavor: '一个"本不该还在"的人,记忆停留在失踪那年。',
    directive: '【最大胆设定】这位普通人是失踪多年后突然归来的人,村里人都以为 ta 已不在人世。ta 对这段空白的岁月支吾其辞,举止、谈吐仿佛仍停留在失踪的那一年,对这几年的变化茫然。绝不解释穿越/复活机制,留作悬而未决的谜。openingLine 带一种"与时代错位"的违和感。注意:若该地/该时涉及敏感事件,生成时仍须遵守旁观者/非亲历红线。',
    stateOverride: { calm: 3, joy: 3, vulnerability: 7 },
  },
];

const settings = [
  // 稀遇触发概率(0-1)。后台改 Setting.npc.rareProbability 即时生效。
  { key: 'npc.rareProbability', value: '0.04' },
];

async function main() {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const a of archetypes) {
      await c.query(
        `INSERT INTO "HiddenArchetype" (id, key, label, flavor, directive, "stateOverride", weight, enabled, "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, true, now())
         ON CONFLICT (key) DO UPDATE SET
           label = EXCLUDED.label,
           flavor = EXCLUDED.flavor,
           directive = EXCLUDED.directive,
           "stateOverride" = EXCLUDED."stateOverride",
           weight = EXCLUDED.weight,
           enabled = true,
           "updatedAt" = now()`,
        [a.key, a.label, a.flavor, a.directive, JSON.stringify(a.stateOverride), a.weight],
      );
    }
    for (const s of settings) {
      await c.query(
        `INSERT INTO "Setting" (key, value, "updatedAt") VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
        [s.key, s.value],
      );
    }
    await c.query('COMMIT');
    console.log(`seeded ${archetypes.length} archetypes, ${settings.length} settings`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
