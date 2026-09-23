<script setup lang="ts">
import { getContributors, type Contributor } from "@/apis/github";
import { useCopyText } from "@/composables/useCopyText";
import { useUpdateStore } from "@/stores/update";
import { openExternal } from "@/utils/url";
import {
  APP_VERSION,
  REPO_URL,
  REPO_NAME,
  HOMEPAGE_URL,
  COPYRIGHT_HOLDER,
  IS_APPX,
  COMMIT_HASH,
  COMMIT_DATE,
} from "@/utils/config";
import IconLucideRefreshCw from "~icons/lucide/refresh-cw";
import IconLucideGithub from "~icons/lucide/github";
import IconLucideRss from "~icons/lucide/rss";
import IconLucideArrowUpRight from "~icons/lucide/arrow-up-right";
import IconLucideChevronDown from "~icons/lucide/chevron-down";

const { t } = useI18n();
const { copy } = useCopyText();
const update = useUpdateStore();

/** 提交时间 */
const commitTimeAgo = useTimeAgo(new Date(COMMIT_DATE));
/** 当前版本 */
const versions = window.electron.process.versions;
/** 操作系统信息 */
const osInfo = window.api.system.osInfo;

/** 检查更新中 */
const checking = computed(() => update.phase === "checking");

/** 触发更新检查 */
const handleCheckUpdate = (): void => {
  if (update.hasUpdate) {
    update.openDialog();
    return;
  }
  update.checkManually();
};

/** 打开日志目录 */
const handleOpenLogs = (): void => void window.api.system.openLogsDir();

interface EnvItem {
  label: string;
  value?: string;
  url?: string;
}

/** 环境信息列表 */
const envItems = computed<EnvItem[]>(() => [
  {
    label: t("settings.about.commit"),
    value: COMMIT_HASH,
    url: `${REPO_URL}/commit/${COMMIT_HASH}`,
  },
  {
    label: t("settings.about.date"),
    value: `${COMMIT_DATE} (${commitTimeAgo.value})`,
  },
  { label: "Electron", value: versions.electron },
  { label: "Chromium", value: versions.chrome },
  { label: "Node.js", value: versions.node },
  { label: "V8", value: versions.v8 },
  { label: "OS", value: `${osInfo.type} ${osInfo.arch} ${osInfo.release}` },
]);

/** 复制环境信息 */
const handleCopyEnvInfo = (): void => {
  const info = envItems.value.map((item) => `${item.label}: ${item.value}`).join("\n");
  copy(info);
};

interface Dependency {
  name: string;
  description: string;
  url: string;
}

/** 依赖的开源项目 */
const dependencies: Dependency[] = [
  {
    name: "applemusic-like-lyrics",
    description: "类 Apple Music 歌词显示组件库",
    url: "https://github.com/Steve-xmh/applemusic-like-lyrics",
  },
  {
    name: "NeteaseCloudMusicApiEnhanced",
    description: "网易云音乐 API 备份 + 增强",
    url: "https://github.com/neteasecloudmusicapienhanced/api-enhanced",
  },
];

/** 社区与资讯入口 */
const community = computed(() => [
  { name: REPO_NAME, url: REPO_URL, icon: IconLucideGithub },
  { name: t("settings.about.officialSite"), url: HOMEPAGE_URL, icon: IconLucideRss },
]);

const developers = ref<Contributor[]>([]);
const showAllDevelopers = ref(false);

/** 默认仅展示前 6 位，其余折叠 */
const visibleDevelopers = computed(() =>
  showAllDevelopers.value ? developers.value : developers.value.slice(0, 6),
);
const hasMoreDevelopers = computed(() => developers.value.length > 6);

onMounted(async () => {
  try {
    developers.value = await getContributors();
  } catch (error) {
    console.error("获取贡献者失败:", error);
  }
});
</script>

<template>
  <div class="flex flex-col gap-8">
    <!-- 关于软件 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.aboutApp") }}
      </h3>
      <SCard
        variant="settings"
        :bordered="false"
        radius="xl"
        class="flex flex-wrap items-center gap-4"
      >
        <SLogo :size="34" />
        <div class="flex items-center gap-2 mr-auto">
          <span class="text-lg font-logo text-on-surface">{{ REPO_NAME }}</span>
          <STag type="primary" size="small" round>v{{ APP_VERSION }}</STag>
          <STag v-if="IS_APPX" type="primary" size="small" round>
            {{ t("settings.storeVersion") }}
          </STag>
        </div>
        <div class="flex items-center gap-2">
          <SButton variant="secondary" :loading="checking" @click="handleCheckUpdate">
            <template #icon><IconLucideRefreshCw /></template>
            {{
              update.hasUpdate
                ? t("settings.about.newVersion")
                : checking
                  ? t("settings.about.checking")
                  : t("settings.about.checkUpdate")
            }}
          </SButton>
          <SButton variant="secondary" @click="handleOpenLogs">
            {{ t("settings.about.openLogs") }}
          </SButton>
        </div>
      </SCard>
    </section>

    <!-- 特别致谢 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.specialThanks") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <SCard
          v-for="dep in dependencies"
          :key="dep.name"
          variant="settings"
          hoverable
          :bordered="false"
          class="group text-left"
          @click="openExternal(dep.url)"
        >
          <div class="flex items-center gap-1.5">
            <span class="text-sm font-medium text-on-surface truncate">{{ dep.name }}</span>
            <IconLucideArrowUpRight
              class="size-3.5 text-on-surface-variant/40 group-hover:text-primary transition-colors"
            />
          </div>
          <div class="text-xs text-on-surface-variant/70 mt-0.5 line-clamp-1">
            {{ dep.description }}
          </div>
        </SCard>
      </div>
    </section>

    <!-- 开发人员 -->
    <section v-if="developers.length > 0">
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.developers") }}
      </h3>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        <SCard
          v-for="dev in visibleDevelopers"
          :key="dev.login"
          variant="settings"
          hoverable
          :bordered="false"
          size="small"
          class="flex items-center gap-2.5"
          @click="openExternal(dev.htmlUrl)"
        >
          <SImg
            :src="dev.avatar"
            fallback="./images/avatar.jpg"
            class="size-9 rounded-full shrink-0"
          />
          <div class="min-w-0">
            <div class="text-sm font-medium text-on-surface truncate">{{ dev.login }}</div>
            <div class="text-xs text-on-surface-variant/60 truncate">
              {{ dev.login === COPYRIGHT_HOLDER ? "Author" : "Contributor" }}
            </div>
          </div>
        </SCard>
      </div>
      <SButton
        v-if="hasMoreDevelopers"
        variant="text"
        size="small"
        class="mt-3"
        @click="showAllDevelopers = !showAllDevelopers"
      >
        {{ showAllDevelopers ? t("settings.about.collapse") : t("settings.about.showMore") }}
        <template #icon>
          <IconLucideChevronDown
            class="transition-transform"
            :class="showAllDevelopers && 'rotate-180'"
          />
        </template>
      </SButton>
    </section>

    <!-- 社区与资讯 -->
    <section>
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("settings.section.community") }}
      </h3>
      <div class="grid grid-cols-3 gap-2.5">
        <SCard
          v-for="item in community"
          :key="item.name"
          variant="settings"
          hoverable
          :bordered="false"
          class="flex items-center gap-2.5"
          @click="openExternal(item.url)"
        >
          <component :is="item.icon" class="size-5 text-on-surface-variant shrink-0" />
          <span class="text-sm font-medium text-on-surface truncate">{{ item.name }}</span>
        </SCard>
      </div>
    </section>

    <!-- 环境信息 -->
    <section>
      <div class="flex items-center justify-between mb-3 px-1">
        <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface">
          <span class="w-0.75 h-4 rounded-full bg-primary" />
          {{ t("settings.section.envInfo") }}
        </h3>
        <SButton variant="ghost" circle size="small" @click="handleCopyEnvInfo">
          <template #icon><IconLucideCopy /></template>
        </SButton>
      </div>
      <SCard
        variant="settings"
        :bordered="false"
        radius="xl"
        class="break-all select-text space-y-1.5"
      >
        <div
          v-for="item in envItems"
          :key="item.label"
          class="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2"
        >
          <span class="text-on-surface/60 shrink-0">{{ item.label }}:</span>
          <a
            v-if="item.url"
            class="text-on-surface hover:text-primary cursor-pointer flex items-center gap-1 w-fit transition-colors"
            @click.prevent="openExternal(item.url!)"
          >
            {{ item.value }}
            <IconLucideArrowUpRight class="size-3 shrink-0" />
          </a>
          <span v-else class="text-on-surface break-words">{{ item.value }}</span>
        </div>
      </SCard>
    </section>
  </div>
</template>
