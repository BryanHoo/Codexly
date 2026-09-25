import { i18n } from "./i18n.js";

// 壁纸图库仅随设置页加载，避免增加工作台首屏的语言资源。
i18n.addResourceBundle("zh-CN", "settings", { wallpaper: {
  source: "壁纸来源", close: "关闭预览",
  description: "使用每日风景或自己的图片装点工作台。", bingMode: "Bing",
  choose: "选择图片", pickerDescription: "选择喜欢的图片，即时应用到工作台。", closePicker: "关闭图片选择", done: "完成",
  addFavorite: "添加喜欢的图片", customSelected: "自定义背景", customFormats: "支持 JPG、PNG、WebP 和 GIF",
  collection: "Bing 每日壁纸", recent: "最近九天", daily: "每日自动更新", selected: "当前使用",
  download: "下载原图", downloading: "正在下载", downloaded: "已保存 {{name}}",
  loading: "正在加载壁纸", loadError: "壁纸加载失败", retry: "重新加载",
  custom: "我的壁纸", empty: "还没有添加壁纸", upload: "添加图片",
  adjustments: "显示效果", reset: "重置显示效果", imageError: "图片无法预览",
  select: "使用 {{name}}", view: "预览 {{name}}", downloadImage: "下载 {{name}}",
} }, true);
i18n.addResourceBundle("en", "settings", { wallpaper: {
  source: "Wallpaper source", close: "Close preview",
  description: "Personalize your workspace with daily scenery or your own images.", bingMode: "Bing",
  choose: "Choose image", pickerDescription: "Choose an image to apply it to your workspace.", closePicker: "Close image picker", done: "Done",
  addFavorite: "Add a favorite image", customSelected: "Custom background", customFormats: "Supports JPG, PNG, WebP and GIF",
  collection: "Bing daily wallpapers", recent: "Last nine days", daily: "Update daily", selected: "In use",
  download: "Download original", downloading: "Downloading", downloaded: "Saved {{name}}",
  loading: "Loading wallpapers", loadError: "Unable to load wallpapers", retry: "Reload",
  custom: "My wallpapers", empty: "No wallpapers yet", upload: "Add images",
  adjustments: "Appearance", reset: "Reset appearance", imageError: "Unable to preview image",
  select: "Use {{name}}", view: "Preview {{name}}", downloadImage: "Download {{name}}",
} }, true);
