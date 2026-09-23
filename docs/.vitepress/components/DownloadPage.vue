<template>
  <div class="dl">
    <p v-if="loading" class="dl-state">{{ copy.loading }}</p>

    <div v-else-if="error" class="dl-state dl-error">
      {{ copy.fetchFailed }}: {{ error }}
      <br />
      <a :href="releasesUrl" target="_blank" rel="noreferrer">{{ copy.openGitHub }} →</a>
    </div>

    <template v-else>
      <div class="dl-head">
        <div class="dl-release-info">
          <a
            v-if="release"
            class="dl-ver"
            :href="`${releasesUrl}/tag/${release.tag_name}`"
            target="_blank"
            rel="noreferrer"
          >
            {{ release.tag_name }}
          </a>
          <span v-else class="dl-ver dl-ver-empty">{{ copy.noRelease }}</span>
          <p class="dl-channel-note">{{ currentChannel.description }}</p>
        </div>
        <div class="dl-filters">
          <label class="dl-select">
            {{ copy.channelLabel }}
            <select v-model="channel">
              <option v-for="entry in channels" :key="entry.id" :value="entry.id">
                {{ entry.name }}
              </option>
            </select>
          </label>
          <label class="dl-select">
            {{ copy.mirrorLabel }}
            <select v-model="mirror">
              <option v-for="entry in mirrors" :key="entry.id" :value="entry.id">
                {{ entry.name }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <div v-if="!release" class="dl-state dl-empty">
        {{ copy.channelEmpty(currentChannel.name) }}
      </div>

      <template v-else>
        <div v-if="recommended.length" class="dl-rec">
          <div class="dl-rec-label">
            <span class="dl-rec-mark" aria-hidden="true"></span>
            <span>{{ copy.recommended }}</span>
            <strong>
              {{ userPlatform }}
              <template v-if="userArch">· {{ userArch }}</template>
            </strong>
          </div>
          <div class="dl-rec-btns">
            <a
              v-for="(asset, index) in recommended"
              :key="asset.url"
              class="dl-btn"
              :class="index === 0 ? 'dl-btn-primary' : 'dl-btn-secondary'"
              :href="mirrored(asset.url)"
            >
              <span>
                {{ index === 0 ? `${copy.download} ${assetLabel(asset)}` : assetLabel(asset) }}
              </span>
              <span class="dl-size">{{ formatSize(asset.size) }}</span>
            </a>
          </div>
        </div>

        <div v-for="group in grouped" :key="group.platform" class="dl-group">
          <h3>{{ group.platform }}</h3>
          <a
            v-for="asset in group.assets"
            :key="asset.url"
            class="dl-item"
            :href="mirrored(asset.url)"
          >
            <span class="dl-name">{{ asset.fileName }}</span>
            <span class="dl-meta">
              {{ assetLabel(asset) }} · {{ archLabel(asset.arch) }} · {{ formatSize(asset.size) }}
            </span>
          </a>
        </div>

        <p class="dl-foot">
          {{ copy.otherVersions }}
          <a :href="releasesUrl" target="_blank" rel="noreferrer">{{ copy.allReleases }}</a>
        </p>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useData } from "vitepress";
import { DOWNLOAD_PAGE_COPY } from "../locales/downloadPage";
import {
  parseDownloadAsset,
  selectRecommendedAssets,
  sortDownloadAssets,
  type DownloadAsset,
} from "../utils/downloadAssets";

const GITHUB_REPO = "SPlayer-Dev/SPlayer-Next";
const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`;

interface Release {
  tag_name: string;
  prerelease: boolean;
  draft: boolean;
  assets: { name: string; browser_download_url: string; size: number }[];
}

type ReleaseChannel = "stable" | "beta" | "alpha";

const { lang } = useData();
const copy = computed(() => DOWNLOAD_PAGE_COPY[lang.value.startsWith("en") ? "en" : "zh"]);
const channels = computed(() =>
  (["stable", "beta", "alpha"] as const).map((id) => ({
    id,
    ...copy.value.channels[id],
  })),
);

const mirrors = [
  { id: "", name: "GitHub" },
  { id: "https://gh-proxy.org/", name: "Cloudflare" },
  { id: "https://hk.gh-proxy.org/", name: "Sharon CDN" },
  { id: "https://cdn.gh-proxy.org/", name: "Fastly" },
  { id: "https://edgeone.gh-proxy.org/", name: "EdgeOne" },
];

const loading = ref(true);
const error = ref("");
const releases = ref<Release[]>([]);
const channel = ref<ReleaseChannel>("stable");
const mirror = ref("");
const userPlatform = ref("");
const userArch = ref("");

const mirrored = (url: string): string => (mirror.value ? mirror.value + url : url);

const formatSize = (bytes: number): string =>
  bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "";

const PLATFORM_ORDER = ["Windows", "macOS", "Linux"];

const currentChannel = computed(
  () => channels.value.find((entry) => entry.id === channel.value) ?? channels.value[0],
);

const assetLabel = (asset: DownloadAsset): string => {
  return copy.value.formats[asset.format as keyof typeof copy.value.formats] ?? asset.format;
};

const archLabel = (arch: string): string => (arch === "universal" ? copy.value.universal : arch);

/** 当前通道最新版本 */
const release = computed(() => {
  return (
    releases.value.find((entry) => {
      if (entry.draft) return false;
      if (channel.value === "stable") return !entry.prerelease;
      return entry.prerelease && new RegExp(`-${channel.value}(?:\\.|$)`, "i").test(entry.tag_name);
    }) ?? null
  );
});

const assets = computed<DownloadAsset[]>(() =>
  sortDownloadAssets(
    (release.value?.assets ?? [])
      .map((item) => parseDownloadAsset(item.name, item.browser_download_url, item.size))
      .filter((item): item is DownloadAsset => item !== null),
  ),
);

/** 按固定平台顺序分组 */
const grouped = computed(() =>
  PLATFORM_ORDER.map((platform) => ({
    platform,
    assets: assets.value.filter((asset) => asset.platform === platform),
  })).filter((group) => group.assets.length > 0),
);

/** 当前系统的推荐下载：匹配平台，并尽量匹配架构 */
const recommended = computed(() => {
  return selectRecommendedAssets(assets.value, userPlatform.value, userArch.value);
});

const detectEnvironment = (): void => {
  if (typeof navigator === "undefined") return;
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) userPlatform.value = "Windows";
  else if (ua.includes("mac")) userPlatform.value = "macOS";
  else if (ua.includes("linux")) userPlatform.value = "Linux";
  userArch.value = ua.includes("arm64") || ua.includes("aarch64") ? "ARM64" : "x64";
};

const fetchRelease = async (): Promise<void> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=30`,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    releases.value = (await response.json()) as Release[];
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
};

onMounted(() => {
  detectEnvironment();
  fetchRelease();
});
</script>

<style scoped>
.dl {
  margin-top: 24px;
}
.dl-state {
  padding: 40px 0;
  text-align: center;
  color: var(--vp-c-text-2);
}
.dl-error {
  color: var(--vp-c-danger-1);
}
.dl-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
.dl-release-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dl-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.dl-ver {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.dl-ver-empty {
  color: var(--vp-c-text-2);
}
.dl-select {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
.dl-select select {
  min-height: 40px;
  margin-left: 6px;
  padding: 6px 28px 6px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.dl-select select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.dl-channel-note {
  margin: 0;
  color: var(--vp-c-text-2);
  font-size: 0.9rem;
}
.dl-empty {
  padding-top: 24px;
}
.dl-rec {
  margin-bottom: 28px;
}
.dl-rec-label {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 10px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
.dl-rec-label strong {
  color: var(--vp-c-text-1);
  font-weight: 600;
}
.dl-rec-mark {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
}
.dl-rec-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid transparent;
  border-radius: 8px;
  font-weight: 600;
  text-decoration: none;
  transition-property: background-color, border-color, color;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}
.dl-btn-primary {
  background: var(--vp-c-brand-1);
  color: #2b0f0d;
}
.dl-btn-primary:hover {
  background: var(--vp-c-brand-2);
  color: #2b0f0d;
}
.dl-btn-secondary {
  border-color: var(--vp-c-divider);
  background: transparent;
  color: var(--vp-c-text-1);
  font-weight: 500;
}
.dl-btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-text-1);
}
.dl-btn:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.dl-btn .dl-size {
  font-weight: 400;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
}
.dl-group {
  margin-bottom: 20px;
}
.dl-group h3 {
  margin: 0 0 8px;
  font-size: 1.05rem;
}
.dl-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  margin-bottom: 6px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none;
  color: var(--vp-c-text-1);
  transition-property: background-color, border-color, box-shadow;
  transition-duration: 150ms;
  transition-timing-function: ease-out;
}
.dl-item:hover {
  background: var(--vp-c-brand-dimm);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.dl-item:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
.dl-name {
  font-size: 0.9rem;
  word-break: break-all;
}
.dl-meta {
  flex-shrink: 0;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-3);
}
.dl-foot {
  margin-top: 24px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
@media (max-width: 640px) {
  .dl-filters,
  .dl-select,
  .dl-select select {
    width: 100%;
  }
  .dl-select select {
    display: block;
    margin: 6px 0 0;
  }
  .dl-rec-btns,
  .dl-btn {
    width: 100%;
  }
  .dl-btn {
    justify-content: space-between;
  }
  .dl-item {
    align-items: flex-start;
    flex-direction: column;
  }
  .dl-meta {
    flex-shrink: 1;
  }
}
</style>
