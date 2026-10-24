/**
 * 端到端测试（真实网络）
 *
 * 验证：翻译 → 搜索 → 详情 → 章节 → 图片 的完整链路。
 * 需要真实网络访问 korsite.net / toonkor / funbe / MyMemory。
 *
 * 运行：npx tsx test/e2e.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

(globalThis as unknown as { BreezeHtml: unknown }).BreezeHtml = {
  load: (html: string) => cheerio.load(html),
};

const { translateToKorean } = await import("../src/translate.ts");
const { fetchSitePath, fetchImage } = await import("../src/http.ts");
const { parseSearchResults, parseComicDetail, parseChapterImages } = await import("../src/parse.ts");

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n[1] 中文 → 韩文翻译");
await check("翻译「独行玩家」→ 韩文", async () => {
  const r = await translateToKorean("独行玩家");
  assert.ok(r.query.length > 0, "翻译结果为空");
  console.log(`    结果: 「${r.korean}」 translated=${r.translated}`);
  assert.ok(r.translated, "应发生翻译");
});
await check("韩文关键词不重复翻译", async () => {
  const r = await translateToKorean("나 혼자만 레벨업");
  assert.equal(r.translated, false);
  assert.equal(r.query, "나 혼자만 레벨업");
});

console.log("\n[2] toonkor 搜索");
let searchPath = "";
await check("搜索 레벨업 返回结果", async () => {
  const html = await fetchSitePath("toonkor", "/bbs/search.php?sfl=wr_subject%7C%7Cwr_content&stx=%EB%A0%88%EB%B2%A8%EC%97%85");
  const hits = parseSearchResults(html, "https://toonkor6.org");
  assert.ok(hits.length > 0, "无搜索结果");
  searchPath = hits[0].path;
  console.log(`    命中 ${hits.length} 条，首条: ${hits[0].title}`);
});

console.log("\n[3] toonkor 详情");
let chapterPath = "";
await check("详情页解析章节", async () => {
  const html = await fetchSitePath("toonkor", searchPath);
  const detail = parseComicDetail(html, "https://toonkor6.org", searchPath);
  assert.ok(detail.chapters.length > 0, "无章节");
  assert.ok(detail.title.length > 0, "无标题");
  chapterPath = detail.chapters[0].path;
  console.log(`    《${detail.title}》 共 ${detail.chapters.length} 话`);
});

console.log("\n[4] toonkor 章节图片");
await check("章节页提取图片并下载验证", async () => {
  const html = await fetchSitePath("toonkor", chapterPath);
  const images = parseChapterImages(html);
  assert.ok(images.length > 0, "无图片");
  // 下载第一张图验证 JPEG 魔数
  const bytes = await fetchImage(images[0], 20000);
  assert.ok(bytes.length > 100, `图片太小: ${bytes.length}`);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  assert.ok(isJpeg, `非 JPEG 魔数: ${bytes[0]},${bytes[1]}`);
  console.log(`    ${images.length} 张图，首张 ${bytes.length} 字节，JPEG 校验通过`);
});

console.log("\n[5] funbe 同构验证");
await check("funbe 首页可访问且识别为同构站", async () => {
  const html = await fetchSitePath("funbe", "/bbs/board.php?bo_table=wtoon");
  const hits = parseSearchResults(html, "https://funbe683.com");
  assert.ok(hits.length > 0, "funbe 列表无作品");
  console.log(`    funbe 列表 ${hits.length} 条`);
});

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
