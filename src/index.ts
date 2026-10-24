import type {
  CapabilitiesBundleContract,
  ChapterContentContract,
  ChapterPayload,
  ChapterSummary,
  ComicDetailContract,
  ComicDetailPayload,
  ComicPagedListContract,
  DownloadConcurrencyResult,
  FetchImageBytesPayload,
  FilterBundleContract,
  InfoContract,
  ReadSnapshotContract,
  ReadSnapshotPayload,
  SearchComicPayload,
  SearchResultContract,
  SettingsBundleContract,
} from "breeze-plugin-kit";
import { authConfig } from "breeze-plugin-kit";
import {
  PLUGIN_ID,
  cleanText,
  containsHangul,
  createImage,
  createMetadata,
  safePathSegment,
  toComicListItem,
} from "./common";
import { fetchImage, fetchSitePath, siteAbsoluteUrl } from "./http";
import { parseChapterImages, parseComicDetail, parseSearchResults } from "./parse";
import { refreshOrigins } from "./site";
import { defaultSites, getOrigin, getSiteById } from "./sites";
import { getTranslateEmail, setTranslateEmail, translateToKorean } from "./translate";
import { buildPluginInfo } from "./get-info";
import {
  applyTranslateSettings,
  isDisplayTranslateEnabled,
  translateChapterNames,
  translateListTitles,
  translateToChinese,
} from "./translate-display";

/** 设置里开了「显示翻译」才生效：把韩文列表标题批量译成中文 */
async function maybeTranslateTitles<T extends { title: string }>(items: T[]): Promise<T[]> {
  if (!(await isDisplayTranslateEnabled())) {
    return items;
  }
  try {
    return await translateListTitles(items);
  } catch {
    return items;
  }
}

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

const KEY_TRANSLATE_EMAIL = "translate.email";
const KEY_DEFAULT_SITE = "source.defaultSite";

const DEFAULT_SITE_ID = "toonkor";

async function readSetting(key: string, fallback: string): Promise<string> {
  try {
    const value = await authConfig.load(key, fallback);
    return cleanText(value) || fallback;
  } catch {
    return fallback;
  }
}

async function writeSetting(key: string, value: string): Promise<void> {
  try {
    await authConfig.save(key, value);
  } catch {
    // 忽略持久化失败
  }
}

async function defaultSiteId(): Promise<string> {
  const id = await readSetting(KEY_DEFAULT_SITE, DEFAULT_SITE_ID);
  return getSiteById(id) ? id : DEFAULT_SITE_ID;
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// 分类 board 映射
// ---------------------------------------------------------------------------

const BOARD_MAP: Record<string, string> = {
  wtoon: "wtoon",
  manga: "manga",
  novel: "novel",
};

// ---------------------------------------------------------------------------
// 接口实现
// ---------------------------------------------------------------------------

async function init(): Promise<{ source: string; data: { ok: boolean } }> {
  console.log("[korsite] init");
  return { source: PLUGIN_ID, data: { ok: true } };
}

async function getInfo(): Promise<InfoContract> {
  return buildPluginInfo();
}

/** 搜索：中文关键词自动翻译成韩文再搜站内 */
async function searchComic(payload: SearchComicPayload): Promise<SearchResultContract> {
  const keyword = cleanText(payload.keyword);
  const siteId = await defaultSiteId();
  const empty = { page: 1, pages: 1, total: 0, hasReachedMax: true };

  if (!keyword) {
    return {
      source: PLUGIN_ID,
      extern: null,
      scheme: { version: "1.0.0", type: "searchResult", source: PLUGIN_ID, list: "grid" },
      data: { paging: empty, items: [] },
      paging: empty,
      items: [],
    };
  }

  // 中文 → 韩文
  const translation = await translateToKorean(keyword);
  const query = translation.query;

  const origin = getOrigin(siteId);
  const searchPath = `/bbs/search.php?sfl=wr_subject%7C%7Cwr_content&stx=${encodeURIComponent(query)}`;
  const pageHtml = await fetchSitePath(siteId, searchPath);

  const hits = parseSearchResults(pageHtml, origin);
  const rawItems = hits.map((hit) =>
    toComicListItem({
      id: `${siteId}:${hit.path}`,
      title: hit.title,
      subtitle: getSiteById(siteId)?.nameZh ?? siteId,
      coverUrl: hit.coverUrl,
      raw: { siteId, path: hit.path },
    }),
  );
  const items = await maybeTranslateTitles(rawItems);

  const total = items.length;
  const paging = { page: 1, pages: 1, total, hasReachedMax: true };
  const note = translation.translated ? `已翻译为韩文「${translation.korean}」` : translation.note;

  return {
    source: PLUGIN_ID,
    extern: note ? { note } : null,
    scheme: { version: "1.0.0", type: "searchResult", source: PLUGIN_ID, list: "grid" },
    data: { paging, items },
    paging,
    items,
  };
}

/** 排行榜/分类列表：按 board 抓作品列表 */
async function getRankingData(payload: SearchComicPayload): Promise<ComicPagedListContract> {
  const extern = (payload.extern ?? {}) as Record<string, unknown>;
  const record = payload as unknown as Record<string, unknown>;
  const page = toNumber(payload.page, 1);
  const board = pickString(extern.board, record.board) || "wtoon";
  const siteId = pickString(extern.siteId, record.siteId) || (await defaultSiteId());
  const boardTable = BOARD_MAP[board] ?? "wtoon";

  const origin = getOrigin(siteId);
  const listPath = `/bbs/board.php?bo_table=${boardTable}${page > 1 ? `&page=${page}` : ""}`;
  const pageHtml = await fetchSitePath(siteId, listPath);

  // 列表页也是静态作品短链接
  const hits = parseSearchResults(pageHtml, origin);
  const rawItems = hits.map((hit) =>
    toComicListItem({
      id: `${siteId}:${hit.path}`,
      title: hit.title,
      subtitle: getSiteById(siteId)?.nameZh ?? siteId,
      coverUrl: hit.coverUrl,
      raw: { siteId, path: hit.path },
    }),
  );
  const items = await maybeTranslateTitles(rawItems);

  return {
    source: PLUGIN_ID,
    extern: null,
    data: {
      items,
      hasReachedMax: items.length === 0 || page >= 50,
    },
  };
}

async function getRankingFilterBundle(): Promise<FilterBundleContract> {
  const siteOptions = defaultSites().map((site) => ({
    label: `${site.nameZh} (${site.nameKo})`,
    value: site.id,
    result: { extern: { siteId: site.id } },
  }));

  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "rankingFilter",
      title: "筛选",
      fields: [
        {
          key: "site",
          kind: "choice",
          label: "漫画站",
          options: [
            { label: "默认站", value: "", result: { extern: { siteId: "" } } },
            ...siteOptions,
          ],
        },
        {
          key: "board",
          kind: "choice",
          label: "分类",
          options: [
            { label: "网页漫画", value: "wtoon", result: { extern: { board: "wtoon" } } },
            { label: "日漫", value: "manga", result: { extern: { board: "manga" } } },
            { label: "小说", value: "novel", result: { extern: { board: "novel" } } },
          ],
        },
      ],
    },
    data: {
      values: {
        site: "",
        board: "wtoon",
      },
    },
  };
}

async function getComicDetail(payload: ComicDetailPayload): Promise<ComicDetailContract> {
  const comicId = cleanText(payload.comicId);
  if (!comicId) {
    throw new Error("缺少漫画 ID");
  }

  // comicId 形如 "siteId:/path"
  const [siteId, pathPart] = comicId.split(":");
  const path = pathPart?.startsWith("/") ? pathPart : `/${pathPart ?? ""}`;
  const site = getSiteById(siteId);
  if (!site || !path || path === "/") {
    throw new Error("无效的漫画 ID");
  }

  const origin = getOrigin(siteId);
  const pageHtml = await fetchSitePath(siteId, path);
  const detail = parseComicDetail(pageHtml, origin, path);

  const chapters: ChapterSummary[] = detail.chapters.map((chapter, index) => ({
    id: `${comicId}|${chapter.path}`,
    requestId: `${comicId}|${chapter.path}`,
    logicalKey: `${comicId}-${chapter.path}`,
    storageChapterId: `${comicId}|${chapter.path}`,
    name: chapter.name,
    order: index + 1,
    extern: { siteId, path: chapter.path },
  }));

  // 详情页翻译始终开启：标题/简介/章节名自动译成中文（列表标题翻译由设置开关控制）
  let displayTitle = detail.title || cleanText(path.replace(/^\//, ""));
  let displayDescription = detail.description || "";
  try {
    const [titleZh, descZh, nameMap] = await Promise.all([
      translateToChinese(displayTitle),
      translateToChinese(displayDescription),
      translateChapterNames(chapters.map((chapter) => chapter.name)),
    ]);
    if (titleZh && titleZh !== displayTitle) {
      displayTitle = `${titleZh}（${displayTitle}）`;
    }
    if (descZh) {
      displayDescription = descZh;
    }
    if (nameMap.size > 0) {
      for (const chapter of chapters) {
        const translated = nameMap.get(chapter.name);
        if (translated) {
          chapter.name = translated;
        }
      }
    }
  } catch {
    // 翻译失败保留原文
  }

  return {
    source: PLUGIN_ID,
    comicId,
    extern: null,
    scheme: { version: "1.0.0", type: "comicDetail", source: PLUGIN_ID },
    data: {
      normal: {
        comicInfo: {
          id: comicId,
          title: displayTitle,
          titleMeta: [],
          creator: {
            id: "",
            name: detail.author || "",
            avatar: { id: "", url: "", name: "", path: "", extern: {} },
            onTap: null,
            extern: {},
          },
          description: displayDescription,
          cover: createImage({
            id: comicId,
            url: detail.coverUrl,
            name: detail.title,
            path: `comic/${safePathSegment(comicId)}/cover.jpg`,
            extern: {},
          }),
          metadata: [
            createMetadata("author", "作者", detail.author ? [detail.author] : []),
            createMetadata("source", "来源站", [site.nameZh]),
            createMetadata(
              "info",
              "信息",
              [detail.totalChapters > 0 ? `共 ${detail.totalChapters} 话` : ""].filter(Boolean),
            ),
          ],
          extern: { siteId, path },
        },
        preview: { enabled: false },
        eps: chapters,
        recommend: [],
        totalViews: 0,
        totalLikes: 0,
        totalComments: 0,
        isFavourite: false,
        isLiked: false,
        allowComments: false,
        allowLike: false,
        allowCollected: true,
        allowDownload: true,
        allowCommentsReason: "站点评论在网页端，插件未接入",
        allowLikeReason: "站点未提供点赞接口",
        extern: {},
      },
      raw: {
        id: comicId,
        title: detail.title,
        siteId,
        path,
      },
    },
  };
}

/** 构建某章节的完整阅读数据 */
async function buildChapterData(comicId: string, chapterId: string) {
  // chapterId 形如 "siteId:/path|siteId:/chapterPath.html"
  const [comicRef, chapterPath] = chapterId.split("|");
  const siteId = comicRef.split(":")[0];
  const site = getSiteById(siteId);
  if (!site) {
    throw new Error("无效的站点");
  }

  const origin = getOrigin(siteId);

  // 章节页 → 图片列表
  const chapterPageHtml = await fetchSitePath(siteId, chapterPath);
  const imageUrls = parseChapterImages(chapterPageHtml);

  // 同时抓详情页拿完整章节列表（用于前后导航）
  const comicPath = comicRef.split(":")[1] ?? "";
  let chapters: ChapterSummary[] = [];
  let comicTitle = site.nameZh;
  try {
    const detailPageHtml = await fetchSitePath(siteId, comicPath);
    const detail = parseComicDetail(detailPageHtml, origin, comicPath);
    comicTitle = detail.title || comicTitle;
    chapters = detail.chapters.map((chapter, index) => ({
      id: `${comicId}|${chapter.path}`,
      requestId: `${comicId}|${chapter.path}`,
      logicalKey: `${comicId}-${chapter.path}`,
      storageChapterId: `${comicId}|${chapter.path}`,
      name: chapter.name,
      order: index + 1,
      extern: { siteId, path: chapter.path },
    }));
  } catch (error) {
    console.log("[korsite] 章节列表加载失败:", error instanceof Error ? error.message : error);
  }

  const pages = imageUrls.map((url, index) => {
    const pageNo = String(index + 1).padStart(3, "0");
    return {
      id: `${chapterId}-${pageNo}`,
      name: `page-${index + 1}`,
      path: `comic/${safePathSegment(comicId)}/${safePathSegment(chapterId)}/${pageNo}.jpg`,
      url: url.startsWith("http") ? url : absoluteUrlFallback(url, origin),
      extern: { index: index + 1 },
    };
  });

  // 章节页 URL 可能是带空格的 "_169화 .html"，正则兼容空白与小数话
  const chapterName = chapterPath.match(/(\d+(?:\.\d+)?)화\s*\.html$/i)?.[1] ?? "章节";
  const current = chapters.find((item) => item.requestId === chapterId) ?? {
    id: chapterId,
    requestId: chapterId,
    logicalKey: `${comicId}-${chapterId}`,
    storageChapterId: chapterId,
    name: `${chapterName}화`,
    order: 1,
    extern: { siteId, path: chapterPath },
  };

  return { comicTitle, chapters, chapter: { ...current, pages }, siteId };
}

function absoluteUrlFallback(url: string, origin: string): string {
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (url.startsWith("//")) {
    return `https:${url}`;
  }
  return `${origin}/${url.replace(/^\//, "")}`;
}

async function getReadSnapshot(payload: ReadSnapshotPayload): Promise<ReadSnapshotContract> {
  const comicId = cleanText(payload.comicId);
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) {
    throw new Error("缺少章节 ID");
  }
  const { comicTitle, chapters, chapter, siteId } = await buildChapterData(comicId, chapterId);

  return {
    source: PLUGIN_ID,
    extern: null,
    data: {
      comic: { id: comicId, source: PLUGIN_ID, title: comicTitle, extern: { siteId } },
      chapter,
      chapters,
    },
  };
}

async function getChapter(payload: ChapterPayload): Promise<ChapterContentContract> {
  const comicId = cleanText(payload.comicId);
  const chapterId = String(payload.chapterId ?? "").trim();
  if (!chapterId) {
    throw new Error("缺少章节 ID");
  }
  const { comicTitle, chapters, chapter, siteId } = await buildChapterData(comicId, chapterId);

  return {
    source: PLUGIN_ID,
    comicId,
    chapterId,
    extern: null,
    scheme: { version: "1.0.0", type: "chapterContent", source: PLUGIN_ID },
    data: {
      comic: { id: comicId, source: PLUGIN_ID, title: comicTitle, extern: { siteId } },
      chapter,
      chapters,
    },
  };
}

async function fetchImageBytes(payload: FetchImageBytesPayload): Promise<Uint8Array> {
  const url = cleanText(payload.url);
  if (!url) {
    throw new Error("图片地址为空");
  }
  return fetchImage(url, payload.timeoutMs ?? 30000);
}

async function getDownloadConcurrency(): Promise<DownloadConcurrencyResult> {
  return { concurrency: 3 };
}

async function getSettingsBundle(): Promise<SettingsBundleContract> {
  const email = getTranslateEmail() || (await readSetting(KEY_TRANSLATE_EMAIL, ""));
  const defaultSite = await defaultSiteId();
  setTranslateEmail(email);

  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "settings",
      sections: [
        {
          id: "translate",
          title: "翻译",
          fields: [
            {
              key: "translate.display",
              kind: "switch",
              label: "列表标题也翻译成中文（详情页的标题/简介/章节名始终自动翻译）",
            },
            {
              key: KEY_TRANSLATE_EMAIL,
              kind: "text",
              label: "MyMemory 邮箱（可选，填了可解锁更高翻译配额）",
            },
          ],
        },
        {
          id: "source",
          title: "漫画站",
          fields: [
            {
              key: KEY_DEFAULT_SITE,
              kind: "choice",
              label: "默认漫画站",
              options: defaultSites().map((site) => ({ label: site.nameZh, value: site.id })),
            },
          ],
        },
      ],
    },
    data: {
      canShowUserInfo: false,
      canLogin: false,
      values: {
        [KEY_TRANSLATE_EMAIL]: email,
        [KEY_DEFAULT_SITE]: defaultSite,
        "translate.display": (await isDisplayTranslateEnabled()) ? "true" : "false",
      },
    },
  };
}

async function onSettingChanged(payload?: Record<string, unknown>) {
  const key = pickString(payload?.key);
  const raw = payload?.value;
  const value = typeof raw === "boolean" ? (raw ? "true" : "false") : pickString(raw);
  if (key) {
    await writeSetting(key, value);
    // 同步翻译模块内存态（显示翻译 + 搜索输入翻译的邮箱）
    applyTranslateSettings({ [key]: value });
    if (key === KEY_TRANSLATE_EMAIL) {
      setTranslateEmail(value);
    }
  }
  return { source: PLUGIN_ID, data: { ok: true } };
}

async function getCapabilitiesBundle(): Promise<CapabilitiesBundleContract> {
  return {
    source: PLUGIN_ID,
    scheme: {
      version: "1.0.0",
      type: "capabilities",
      actions: [
        {
          key: "refresh-domains",
          title: "刷新各站域名",
          fnPath: "refreshDomains",
        },
      ],
    },
    data: {},
  };
}

async function refreshDomains(): Promise<{ source: string; data: Record<string, unknown> }> {
  const origins = await refreshOrigins();
  return { source: PLUGIN_ID, data: { origins } };
}

export default {
  init,
  getInfo,
  searchComic,
  getRankingData,
  getRankingFilterBundle,
  getComicDetail,
  getReadSnapshot,
  getChapter,
  fetchImageBytes,
  getDownloadConcurrency,
  getSettingsBundle,
  onSettingChanged,
  getCapabilitiesBundle,
  refreshDomains,
};
