import type { ComicListScene, InfoContract, PluginFunctionItem } from "breeze-plugin-kit";

import { PLUGIN_ID } from "./common";

/** 发布仓库：Breeze 只会扫描 GitHub 上以 Breeze-plugin- 开头的公开仓库 */
const GITHUB_OWNER = "k623615746";
const GITHUB_REPO = "Breeze-plugin-korsite";

/** 自动更新通道：GitHub Release API */
const UPDATE_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`;

const ICON_URL = "https://cdn.jsdelivr.net/gh/k623615746/Breeze-plugin-korsite@main/assets/icon.png";

function buildScene(title: string, core: Record<string, unknown> = {}): ComicListScene {
  return {
    title,
    source: PLUGIN_ID,
    body: {
      type: "pluginPagedComicList",
      request: { fnPath: "getRankingData", core, extern: {} },
    },
    filter: { fnPath: "getRankingFilterBundle", core, extern: {} },
  };
}

function buildFunctions(): PluginFunctionItem[] {
  return [
    {
      id: "webtoon",
      title: "网页漫画",
      action: { type: "openComicList", payload: { scene: buildScene("网页漫画", { board: "wtoon" }) } },
    },
    {
      id: "manga",
      title: "日漫",
      action: { type: "openComicList", payload: { scene: buildScene("日漫", { board: "manga" }) } },
    },
    {
      id: "novel",
      title: "小说",
      action: { type: "openComicList", payload: { scene: buildScene("小说", { board: "novel" }) } },
    },
  ];
}

export function buildPluginInfo(): InfoContract {
  return {
    name: "코사이트",
    uuid: PLUGIN_ID,
    iconUrl: ICON_URL,
    describe: [
      "韩漫聚合源，整合 툰코(toonkor)、펀비(funbe)、뉴토끼(newtoki) 等多个韩国漫画站。",
      "",
      "- 域名自动跟随 korsite.net 发布页更新，失效自动切换",
      "- **支持中文检索**：中文关键词自动翻译成韩文再搜索",
      "- **在线翻译**：可把韩文标题/简介翻译成中文显示（设置里开启）",
      "- 网页漫画 / 日漫 / 小说 分类浏览",
      "- 图片走各站 CDN，无需登录即可阅读",
      "",
      "> 站点内容多为未经授权的搬运 / 汉化作品，版权归原作者及出版方所有，请自行判断使用合规性，建议支持正版。",
    ].join("\n"),
    version: "1.2.5",
    home: `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`,
    updateUrl: UPDATE_URL,
    function: buildFunctions(),
  };
}

export function buildManifestInfo() {
  const info = buildPluginInfo();
  return {
    name: info.name,
    uuid: info.uuid,
    iconUrl: info.iconUrl,
    describe: info.describe,
    version: info.version,
    home: info.home,
    updateUrl: info.updateUrl,
    function: info.function,
  };
}
