<template>
  <div class="dl">
    <p v-if="loading" class="dl-state">正在获取最新版本…</p>

    <div v-else-if="error" class="dl-state dl-error">
      获取版本信息失败：{{ error }}
      <br />
      <a :href="releasesUrl" target="_blank">前往 GitHub 下载 →</a>
    </div>

    <template v-else-if="release">
      <div class="dl-head">
        <a class="dl-ver" :href="`${releasesUrl}/tag/${release.tag_name}`" target="_blank">
          {{ release.tag_name }}
        </a>
        <label class="dl-mirror">
          下载线路
          <select v-model="mirror">
            <option v-for="entry in mirrors" :key="entry.id" :value="entry.id">
              {{ entry.name }}
            </option>
          </select>
        </label>
      </div>

      <div v-if="recommended.length" class="dl-rec">
        <span class="dl-rec-label">
          推荐用于 {{ userPlatform }}
          <template v-if="userArch">· {{ userArch }}</template>
        </span>
        <div class="dl-rec-btns">
          <a
            v-for="asset in recommended"
            :key="asset.url"
            class="dl-btn"
            :href="mirrored(asset.url)"
          >
            <span>{{ asset.label }}</span>
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
            {{ asset.label }} · {{ asset.arch }} · {{ formatSize(asset.size) }}
          </span>
        </a>
      </div>

      <p class="dl-foot">
        需要其他版本？
        <a :href="releasesUrl" target="_blank">查看全部 Releases</a>
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  parseDownloadAsset,
  selectRecommendedAssets,
  type DownloadAsset,
} from "../utils/downloadAssets";

const GITHUB_REPO = "SPlayer-Dev/SPlayer-Next";
const releasesUrl = `https://github.com/${GITHUB_REPO}/releases`;

interface Release {
  tag_name: string;
  assets: { name: string; browser_download_url: string; size: number }[];
}

const mirrors = [
  { id: "", name: "GitHub" },
  { id: "https://gh-proxy.org/", name: "Cloudflare" },
  { id: "https://hk.gh-proxy.org/", name: "Sharon CDN" },
  { id: "https://cdn.gh-proxy.org/", name: "Fastly" },
  { id: "https://edgeone.gh-proxy.org/", name: "EdgeOne" },
];

const loading = ref(true);
const error = ref("");
const release = ref<Release | null>(null);
const assets = ref<DownloadAsset[]>([]);
const mirror = ref("");
const userPlatform = ref("");
const userArch = ref("");

const mirrored = (url: string): string => (mirror.value ? mirror.value + url : url);

const formatSize = (bytes: number): string =>
  bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "";

const PLATFORM_ORDER = ["Windows", "macOS", "Linux"];

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
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as Release;
    release.value = data;
    assets.value = data.assets
      .map((item) => parseDownloadAsset(item.name, item.browser_download_url, item.size))
      .filter((item): item is DownloadAsset => item !== null);
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
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
}
.dl-ver {
  font-size: 1.3rem;
  font-weight: 700;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}
.dl-mirror {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
.dl-mirror select {
  margin-left: 6px;
  padding: 4px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  cursor: pointer;
}
.dl-rec {
  margin-bottom: 28px;
}
.dl-rec-label {
  display: block;
  margin-bottom: 8px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
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
  padding: 10px 16px;
  border-radius: 8px;
  background: var(--vp-c-brand-1);
  color: var(--vp-c-bg);
  font-weight: 600;
  text-decoration: none;
}
.dl-btn:hover {
  background: var(--vp-c-brand-2);
}
.dl-btn .dl-size {
  font-weight: 400;
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
}
.dl-item:hover {
  border-color: var(--vp-c-brand-1);
}
.dl-name {
  font-size: 0.9rem;
  word-break: break-all;
}
.dl-meta {
  flex-shrink: 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-3);
}
.dl-foot {
  margin-top: 24px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}
</style>
