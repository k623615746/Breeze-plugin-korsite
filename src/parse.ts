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
  find: (selector: string) => Selection;
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
  /** 封面图（列表卡片的 data-src），可能为空 */
  coverUrl: string;
};

export type ComicDetail = {
  title: string;
  author: string;
  description: string;
  coverUrl: string;
  chapters: ChapterLink[];
  /** 总话数（从「총 N화」提取），无则 0 */
  totalChapters: number;
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

/** 从搜索页/列表页 HTML 提取作品列表（含封面） */
export function parseSearchResults(pageHtml: string, base: string): SearchHit[] {
  const $ = html().load(pageHtml);
  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  // 列表卡片结构：.section-item-inner 里 .section-item-photo 的 <img data-src> 是封面，
  // .section-item-title 里的 <a href> 是作品链接。先按容器建立 封面 与 链接 的对应关系。
  // 兜底：也支持「先遍历 a 提取链接，再全局找 img」的旧逻辑。

  // 1) 建立 data-src 封面表（按 alt 标题 + 顺序）
  $(".section-item-inner").each((_, element) => {
    const $item = $(element as never);
    // 标题链接在 .section-item-title 里，避免把「더 읽기」等按钮文字混进标题
    const $a = $item.find(".section-item-title a");
    const href = String($a.attr("href") ?? "").trim();
    const $img = $item.find("img");
    const dataSrc = String($img.attr("data-src") ?? "").trim();
    const src = String($img.attr("src") ?? "").trim();
    const coverRaw = dataSrc || (src && !src.startsWith("data:image") ? src : "");
    const title = cleanText($a.text() || $img.attr("alt"));

    if (!href.startsWith("/") || NAV_PATHS.has(href)) {
      return;
    }
    if (/\.(php|html?|css|js|png|jpe?g|gif|webp)$/i.test(href) || href.includes("?")) {
      return;
    }
    if (href.split("/").filter(Boolean).length > 1) {
      return;
    }
    if (!title || title === "더 읽기" || title === "더보기") {
      return;
    }
    if (seen.has(href)) {
      return;
    }
    seen.add(href);
    hits.push({
      path: href,
      title,
      coverUrl: coverRaw ? absoluteUrl(coverRaw, base) : "",
    });
  });

  // 2) 若上面没解析到卡片（比如列表结构不同），退回纯链接遍历
  if (hits.length === 0) {
    $("a").each((_, element) => {
      const $a = $(element as never);
      const href = String($a.attr("href") ?? "").trim();
      if (!href.startsWith("/") || NAV_PATHS.has(href)) {
        return;
      }
      if (/\.(php|html?|css|js|png|jpe?g|gif|webp)$/i.test(href) || href.includes("?")) {
        return;
      }
      const title = cleanText($a.text());
      if (!title || title === "더 읽기" || title === "더보기") {
        return;
      }
      if (href.split("/").filter(Boolean).length > 1) {
        return;
      }
      if (seen.has(href)) {
        return;
      }
      seen.add(href);
      hits.push({ path: href, title, coverUrl: "" });
    });
  }

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

  // 总话数：从「총 N화」或「총편수 총 N화」提取
  let totalChapters = 0;
  const totalMatch = description.match(/총\s*(?:편수\s*)?(\d+)\s*화/);
  if (totalMatch) {
    totalChapters = parseInt(totalMatch[1], 10);
  }

  // 章节链接：形如 /作品名_N화.html（下划线分隔，区别于短链接的连字符）
  const chapters: ChapterLink[] = [];
  // 短篇合集章节（副标题+括号编号）单独收集：组内编号不全局唯一，需特殊排序
  const anthology: Array<{ path: string; subtitle: string; seq: number }> = [];
  const seenHref = new Set<string>();
  $("a").each((_, element) => {
    const $a = $(element as never);
    // 站方部分章节链接的 .html 前带空格（如 "_169화 .html"），trim 后再匹配
    const href = String($a.attr("href") ?? "").trim();
    if (!href.startsWith("/") || seenHref.has(href)) {
      return;
    }
    // 章节序号识别（按优先级从右锚定，避免作品名里的数字干扰）：
    //  1) 「_<序号>화」——序号紧跟「화」字，最可靠（_100화 / _128화_[19세] / _10화_-_친친）
    //  2) 「_<序号>[.．]<副标题>.html」——数字+点+副标题（_04._도깨비의_왕.html，含全角点）
    //  3) 「_<序号>.html」结尾——纯数字格式（_001.html）
    //  4) 「NO.<序号>」——生活记录类（_NO.23_고수의_실력.html）
    //  5) 「_<副标题>(<编号>).html」——短篇合集（사육일지_SNS_노예_계약(1).html）
    let numStr = "";
    const hwaMatches = [...href.matchAll(/_((?:NO\.)?\d+(?:\.\d+)?)화(?![0-9])/gi)];
    if (hwaMatches.length > 0) {
      numStr = hwaMatches[hwaMatches.length - 1][1].replace(/^NO\./i, "");
    } else {
      const dotted = href.match(/_(\d+(?:\.\d+)?)[.．][\s\S]*\.html$/i);
      if (dotted) {
        numStr = dotted[1];
      } else {
        const bare = href.match(/_(\d+(?:\.\d+)?)\s*\.html$/i);
        if (bare) {
          numStr = bare[1];
        } else {
          const noMatch = href.match(/NO\.(\d+(?:\.\d+)?)/i);
          if (noMatch) {
            numStr = noMatch[1];
          }
        }
      }
    }
    if (numStr) {
      seenHref.add(href);
      chapters.push({ path: href, name: `${numStr}화`, number: parseFloat(numStr) });
      return;
    }
    // 短篇合集：副标题 + 括号编号（编号仅在同一副标题内唯一，不能按编号去重）
    // 例：/사육일지_SNS_노예_계약(1).html → 名「SNS 노예 계약 (1)」
    const m2 = href.match(/^\/(.+?)_(.+?)\s*\((\d+)\)\s*\.html$/i);
    if (m2) {
      const subtitle = cleanText(m2[2]);
      // 副标题不能是纯数字（那是别的格式），也不能为空
      if (subtitle && !/^\d+$/.test(subtitle)) {
        seenHref.add(href);
        anthology.push({ path: href, subtitle, seq: parseInt(m2[3], 10) });
      }
    }
  });

  // 合集排序：站点把最新组放最前，阅读顺序应为「组倒序 + 组内编号升序」
  if (anthology.length > 0) {
    const groups: string[] = [];
    for (const item of anthology) {
      if (!groups.includes(item.subtitle)) {
        groups.push(item.subtitle);
      }
    }
    for (const item of anthology) {
      const groupOrder = groups.indexOf(item.subtitle);
      chapters.push({
        path: item.path,
        name: `${item.subtitle} (${item.seq})`,
        number: (groups.length - groupOrder) * 1000 + item.seq,
      });
    }
  }

  // 按序号升序（第 1 话在前）；序号相同（多季/重制版）按页面出现顺序稳定排列
  const sorted = chapters
    .map((chapter, index) => ({ chapter, index }))
    .sort((a, b) => a.chapter.number - b.chapter.number || a.index - b.index)
    .map((entry) => entry.chapter);

  return { title, author, description, coverUrl, chapters: sorted, totalChapters };
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
