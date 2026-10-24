/**
 * 离线解析回归测试
 *
 * 用真实抓取的页面 HTML 验证 parse 层与 site 层。
 * BreezeHtml 由宿主注入，这里用 cheerio 提供同构实现。
 *
 * 运行：npx tsx test/parse.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

(globalThis as unknown as { BreezeHtml: unknown }).BreezeHtml = {
  load: (html: string) => cheerio.load(html),
};

const { parseSearchResults, parseComicDetail, parseChapterImages } = await import("../src/parse.ts");
const { collectSiteCandidates, PUBLISHER_URL } = await import("../src/site.ts");

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(resolve(here, "fixtures", name), "utf-8");

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}`);
    console.log(`    ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\n[1] 搜索页 / 列表页解析");
const searchHits = parseSearchResults(fixture("search.html"), "https://toonkor6.org");
check("搜索结果非空", () => assert.ok(searchHits.length > 0));
check("搜索结果含 레벨업 相关作品", () => {
  assert.ok(searchHits.some((h) => h.title.includes("레벨업")), `hits=${searchHits.length}`);
});
check("命中路径为短链接", () => {
  assert.ok(searchHits.every((h) => h.path.startsWith("/") && !h.path.includes(".php")));
});
check("无重复路径", () => {
  const paths = searchHits.map((h) => h.path);
  assert.equal(new Set(paths).size, paths.length);
});

const listHits = parseSearchResults(fixture("list.html"), "https://toonkor6.org");
check("列表页解析出作品", () => assert.ok(listHits.length > 0));
check("列表页排除导航链接", () => {
  const nav = ["/TV", "/단행본", "/망가", "/소설", "/애니", "/웹툰", "/notice"];
  assert.ok(listHits.every((h) => !nav.includes(h.path)));
});

console.log("\n[2] 详情页解析");
const detail = parseComicDetail(fixture("detail.html"), "https://toonkor6.org", "/S급-나무로-레벨업");
check("标题正确", () => assert.equal(detail.title, "S급 나무로 레벨업"));
check("作者提取正确", () => assert.equal(detail.author, "하언"));
check("封面为绝对地址", () => assert.ok(detail.coverUrl.startsWith("https://toonkor6.org/data/")));
check("章节列表非空且有序", () => {
  assert.ok(detail.chapters.length > 100, `chapters=${detail.chapters.length}`);
  assert.equal(detail.chapters[0].name, "1화");
  const numbers = detail.chapters.map((c) => c.number);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), "章节应按序号升序");
});
check("章节路径形如 /作品_N화.html", () => {
  assert.ok(detail.chapters.every((c) => /\/.+_\d+화\.html$/.test(c.path)));
});

console.log("\n[3] 章节页图片提取");
const images = parseChapterImages(fixture("chapter.html"));
check("解析出图片", () => assert.ok(images.length > 0, `images=${images.length}`));
check("图片为 aws-cloud CDN 绝对地址", () => {
  assert.ok(images.every((u) => u.startsWith("https://aws-cloud")), images[0] ?? "(空)");
});
check("图片无重复", () => {
  assert.equal(new Set(images).size, images.length);
});
check("图片后缀为 jpeg", () => {
  assert.ok(images.every((u) => /\.jpe?g$/i.test(u)));
});

console.log("\n[4] 发布页站点发现");
const candidates = collectSiteCandidates(fixture("publisher.html"));
check("识别出 toonkor 候选", () => {
  assert.ok((candidates.get("toonkor") ?? []).length > 0, "未找到 toonkor 候选");
});
check("识别出 funbe 候选", () => {
  assert.ok((candidates.get("funbe") ?? []).length > 0, "未找到 funbe 候选");
});
check("识别出 newtoki 候选", () => {
  assert.ok((candidates.get("newtoki") ?? []).length > 0, "未找到 newtoki 候选");
});
check("候选为绝对域名（归一化后）", () => {
  for (const list of candidates.values()) {
    for (const origin of list) {
      assert.ok(/^https?:\/\/[^/]+$/.test(origin), `非法候选: ${origin}`);
    }
  }
});
check("发布页 URL 正确", () => assert.equal(PUBLISHER_URL, "https://korsite.net/"));

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  process.exit(1);
}
