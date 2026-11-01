import type { SettingCategory } from "@/types/settings-schema";
import DownloadDirConfig from "@/components/settings/custom/DownloadDirConfig.vue";
import IconLucideDownload from "~icons/lucide/download";

const downloadCategory: SettingCategory = {
  id: "download",
  icon: IconLucideDownload,
  sections: [
    {
      id: "downloadLocation",
      items: [
        {
          key: "downloadEnabled",
          type: "switch",
          binding: { store: "settings", path: "system.download.enabled" },
          defaultValue: false,
          hideDescription: true,
        },
        {
          key: "downloadDir",
          type: "custom",
          component: DownloadDirConfig,
          fullWidth: true,
        },
      ],
    },
    {
      id: "downloadGeneral",
      items: [
        {
          key: "downloadQuality",
          type: "select",
          binding: { store: "settings", path: "system.download.quality" },
          options: [
            { value: "hi-res", label: "Hi-Res" },
            { value: "lossless", label: "Lossless" },
            { value: "hq", label: "HQ" },
            { value: "sq", label: "SQ" },
            { value: "lq", label: "LQ" },
          ],
          defaultValue: "lossless",
        },
        {
          key: "downloadUsePlayback",
          type: "switch",
          binding: { store: "settings", path: "system.download.usePlaybackForDownload" },
          defaultValue: false,
        },
        {
          key: "downloadFileTemplate",
          type: "select",
          binding: { store: "settings", path: "system.download.fileTemplate" },
          options: [
            { value: "{title}", labelKey: "settings.downloadFileTemplate.titleOnly" },
            { value: "{artist} - {title}", labelKey: "settings.downloadFileTemplate.artistTitle" },
            { value: "{title} - {artist}", labelKey: "settings.downloadFileTemplate.titleArtist" },
          ],
          defaultValue: "{artist} - {title}",
        },
        {
          key: "downloadFolderScheme",
          type: "select",
          binding: { store: "settings", path: "system.download.folderScheme" },
          options: [
            { value: "none", labelKey: "settings.downloadFolderScheme.none" },
            { value: "artist", labelKey: "settings.downloadFolderScheme.artist" },
            { value: "artist-album", labelKey: "settings.downloadFolderScheme.artistAlbum" },
          ],
          defaultValue: "none",
        },
        {
          key: "downloadOverwrite",
          type: "select",
          binding: { store: "settings", path: "system.download.overwritePolicy" },
          options: [
            { value: "rename", labelKey: "settings.downloadOverwrite.rename" },
            { value: "overwrite", labelKey: "settings.downloadOverwrite.overwrite" },
            { value: "skip", labelKey: "settings.downloadOverwrite.skip" },
          ],
          defaultValue: "rename",
        },
      ],
    },
    {
      id: "downloadTags",
      items: [
        {
          key: "downloadLyricFormat",
          type: "select",
          binding: { store: "settings", path: "system.download.lyricFileFormat" },
          options: [
            { value: "lrc", labelKey: "settings.downloadLyricFormat.lrc" },
            { value: "enhanced-lrc", labelKey: "settings.downloadLyricFormat.enhanced" },
          ],
          defaultValue: "enhanced-lrc",
        },
        {
          key: "downloadEmbedCover",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedCover" },
          defaultValue: true,
        },
        {
          key: "downloadEmbedMeta",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedMeta" },
          defaultValue: true,
        },
        {
          key: "downloadEmbedLyric",
          type: "switch",
          binding: { store: "settings", path: "system.download.embedLyric" },
          defaultValue: true,
        },
        {
          key: "downloadWriteLrc",
          type: "switch",
          binding: { store: "settings", path: "system.download.writeLrc" },
          defaultValue: false,
        },
        {
          key: "downloadSaveTtml",
          type: "switch",
          binding: { store: "settings", path: "system.download.saveTtml" },
          defaultValue: false,
        },
      ],
    },
  ],
};

export default downloadCategory;
