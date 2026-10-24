/**
 * Gnuboard 站点的 HTML 解析
 *
 * 覆盖三个能力：
 *  - 搜索 /bbs/search.php   → 作品链接列表
 *  - 详情 /作品名            → 标题/作者/简介/封面 + 章节链接列表
 *  - 章节 /作品名_N화.html   → toon_img 里的 base64 图片 HTML → 图片 URL 列表
 */

import { absoluteUrl, cleanText } from "./common";

type Selection = {
  attr: (name: string) => string | undefined;
  text: () => string;
  each: (fn: (index: number, element: unknown) => void) => void;
};

type HtmlApi = ((selector: string) => Selection) & { load: (html: string) => HtmlApi };

function html(): HtmlApi {
  return (globalThis as unknown as { BreezeHtml: HtmlApi }).BreezeHtml;
}

export type SearchHit = {
  /** 作品短链接路径，如 /S급-나무로-레벨업 */
  path: string;
  title: string;
};

export type ComicDetail = {
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  chapters: ChapterLink[];
};

export type ChapterLink = {
  /** 章节页路径，如 /S급_나무로_레벨업_100화.html */
  path: string;
  /** 章节显示名，如 100화 / 1화 */
  name: string;
  /** 解析出的序号，用于排序 */
  number: number;
};

/** 详情页里也是导航链接（栏目/首页/论坛板块），需要排除 */
const NAV_PATHS = new Set([
  "/TV",
  "/단행본",
  "/망가",
  "/소설",
  "/애니",
  "/웹툰",
  "/주소안내",
  "/커뮤니티",
  "/코사이트",
  "/토토보증업체",
  "/포토툰",
  "/notice",
  // 论坛板块（搜索结果里会出现，不是作品）
  "/자유게시판",
  "/툰톡",
  "/공지사항",
  "/최근본",
  "/최근",
  "/인기",
  "/완결",
  "/장르",
]);

/** 从搜索页 HTML 提取作品链接列表 */
export function parseSearchResults(pageHtml: string, base: string): SearchHit[] {
  const $ = html().load(pageHtml);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  $("a").each((_, element) => {
    const $a = $(element as never);
    const href = String($a.attr("href") ?? "").trim();
    if (!href.startsWith("/")) {
      return; // 只处理站内短链接
    }
    if (NAV_PATHS.has(href)) {
      return;
    }
    // 作品短链接形如 /한글-제목，不含查询串、不含文件扩展
    if (/\.(php|html?|css|js|png|jpe?g|gif|webp)$/i.test(href)) {
      return;
    }
    if (href.includes("?")) {
      return;
    }
    const title = cleanText($a.text());
    if (!title) {
      return;
    }
    // 「더 읽기」(更多) 是重复链接，跳过
    if (title === "더 읽기" || title === "더보기") {
      return;
    }
    // 过滤明显的非作品链接（含斜杠子路径的、纯图标）
    if (href.split("/").filter(Boolean).length > 1) {
      return;
    }
    if (seen.has(href)) {
      return;
    }
    seen.add(href);
    hits.push({ path: href, title });
  });

  return hits;
}

/** 从详情页 HTML 提取作品元信息 + 章节列表 */
export function parseComicDetail(pageHtml: string, base: string, comicPath: string): ComicDetail {
  const $ = html().load(pageHtml);

  // 标题：<title> 或 og:title
  let title = "";
  const ogTitle = $('meta[property="og:title"]').attr("content");
  title = cleanText(ogTitle) || cleanText($("title").text());
  // 去掉站点后缀「 - 툰코(Toonkor)」等
  title = title.replace(/\s*-\s*(툰코|펀비|뉴토끼|Toonkor|Funbe|Newtoki).*$/i, "").trim();

  // 封面：og:image
  const coverUrl = absoluteUrl($('meta[property="og:image"]').attr("content"), base);

  // 简介/作者：meta description
  const description = cleanText($('meta[name="description"]').attr("content"));

  // 作者：从 description 里「작가 xxx」提取
  let author = "";
  const authorMatch = description.match(/작가\s+([^\s,.]+)/);
  if (authorMatch) {
    author = authorMatch[1];
  }

  // 章节链接：形如 /作品名_N화.html（下划线分隔，区别于短链接的连字符）
  const chapters: ChapterLink[] = [];
  const seen = new Set<string>();
  $("a").each((_, element) => {
    const $a = $(element as never);
    const href = String($a.attr("href") ?? "").trim();
    if (!href.startsWith("/")) {
      return;
    }
    const m = href.match(/^\/(.+?)_(\d+)화\.html$/);
    if (!m) {
      return;
    }
    if (seen.has(href)) {
      return;
    }
    seen.add(href);
    const number = parseInt(m[2], 10);
    chapters.push({ path: href, name: `${number}화`, number });
  });

  // 按序号升序（第 1 话在前）
  chapters.sort((a, b) => a.number - b.number);

  return { title, author, description, coverUrl, chapters };
}

/**
 * 从章节页提取图片 URL 列表。
 * 站点把 `<img>` 列表 base64 后塞进 `toon_img = '<base64>'`，
 * 需要先解出这段 JS 字符串再 base64 解码。
 */
export function parseChapterImages(pageHtml: string): string[] {
  const $ = html().load(pageHtml);

  // 方法一：直接找 toon_img = '...' 的赋值
  const m = pageHtml.match(/toon_img\s*=\s*['"]([A-Za-z0-9+/=\s]+)['"]/);
  let decodedHtml = "";
  if (m) {
    decodedHtml = decodeBase64(m[1]);
  }

  // 方法二：若没找到 base64 片段，尝试直接抓页面里 data/wtoon 等图片
  if (!decodedHtml) {
    const urls: string[] = [];
    $("img").each((_, element) => {
      const $img = $(element as never);
      const src = String($img.attr("src") ?? "").trim();
      if (isContentImage(src)) {
        urls.push(src);
      }
    });
    if (urls.length > 0) {
      return dedupe(urls);
    }
    return [];
  }

  const $imgs = html().load(decodedHtml);
  const urls: string[] = [];
  $imgs("img").each((_, element) => {
    const $img = $imgs(element as never);
    const src = String($img.attr("src") ?? "").trim();
    if (src) {
      urls.push(src);
    }
  });

  return dedupe(urls);
}

function decodeBase64(input: string): string {
  // 去掉可能的空白
  const raw = input.replace(/\s+/g, "");
  if (!raw) {
    return "";
  }
  try {
    // 标准 base64（QuickJS 有 atob，但保险起见用 Buffer 风格不可用，用 atob）
    if (typeof atob === "function") {
      const binary = atob(raw);
      // 转成 UTF-8 字符串（韩文是多字节 UTF-8）
      return utf8FromBinary(binary);
    }
    return "";
  } catch {
    return "";
  }
}

function utf8FromBinary(binary: string): string {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  // 手动 UTF-8 解码（避免 TextDecoder 在 QuickJS 里不可用）
  let result = "";
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let codePoint = 0;
    let extra = 0;
    if (b0 < 0x80) {
      codePoint = b0;
    } else if ((b0 & 0xe0) === 0xc0) {
      codePoint = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      codePoint = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      codePoint = b0 & 0x07;
      extra = 3;
    } else {
      i++;
      continue;
    }
    if (i + extra >= bytes.length) {
      break;
    }
    for (let k = 1; k <= extra; k++) {
      codePoint = (codePoint << 6) | (bytes[i + k] & 0x3f);
    }
    result += String.fromCodePoint(codePoint);
    i += extra + 1;
  }
  return result;
}

function isContentImage(src: string): boolean {
  if (!src) {
    return false;
  }
  if (!/\.(jpe?g|png|webp|gif|avif)/i.test(src)) {
    return false;
  }
  // 排除广告/图标/logo
  if (/(betplay|onetop|thing|ang-|tting|betyogiyo|logo|banner|adv|icon|default\.png)/i.test(src)) {
    return false;
  }
  return true;
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }
  return result;
}
