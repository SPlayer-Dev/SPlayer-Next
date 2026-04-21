<script setup lang="ts">
import { useThemeStore } from "@/stores/theme";
import { toast } from "@/composables/useToast";
import { netease } from "@/apis/netease";
import type { ThemeSource } from "@/types/theme";

const theme = useThemeStore();

/** Netease 搜索测试 */
interface NeteaseSearchSong {
  id: number;
  name: string;
  artists?: { name: string }[];
  album?: { name: string };
  duration?: number;
}
interface NeteaseSearchBody {
  code: number;
  result?: { songs?: NeteaseSearchSong[]; songCount?: number };
  message?: string;
}
const searchKeyword = ref("告白气球");
const searchLoading = ref(false);
const searchError = ref("");
const searchSongs = ref<NeteaseSearchSong[]>([]);
const searchCount = ref(0);

const handleSearch = async (): Promise<void> => {
  const kw = searchKeyword.value.trim();
  if (!kw) return;
  searchLoading.value = true;
  searchError.value = "";
  try {
    const body = await netease.search<NeteaseSearchBody>({ keywords: kw, limit: 10 });
    if (body.code !== 200) {
      searchError.value = body.message ?? `code=${body.code}`;
      searchSongs.value = [];
      searchCount.value = 0;
      return;
    }
    searchSongs.value = body.result?.songs ?? [];
    searchCount.value = body.result?.songCount ?? 0;
  } catch (err) {
    searchError.value = err instanceof Error ? err.message : String(err);
    searchSongs.value = [];
    searchCount.value = 0;
  } finally {
    searchLoading.value = false;
  }
};

const formatArtists = (song: NeteaseSearchSong): string =>
  song.artists?.map((a) => a.name).join(" / ") ?? "";

/** 按钮加载状态演示 */
const btnLoading = ref(false);

/** 主题模式显示 */
const modeLabel: Record<string, string> = { light: "浅色", dark: "深色", system: "系统" };

/** 主题类型选项 */
const sourceOptions: { value: ThemeSource; label: string }[] = [
  { value: "default", label: "默认" },
  { value: "custom", label: "自定义" },
  { value: "cover", label: "跟随封面" },
  { value: "solid", label: "纯色" },
];

/** v-model 绑定的颜色字符串 */
const colorHex = ref(theme.customColor);

/** Radio 示例值 */
const sortField = ref<"title" | "artist" | "album">("title");
const radioGroupValue = ref("Shanghai");
const radioSongs = [
  { value: "Beijing", label: "北京" },
  { value: "Shanghai", label: "上海" },
  { value: "Guangzhou", label: "广州" },
  { value: "Shenzhen", label: "深圳" },
];

/** Checkbox 示例值 */
const onlyLossless = ref(false);
const onlyLocal = ref(true);
const withLyric = ref(false);
const checkAll = ref(false);
const cities = ref<string[]>(["Shanghai"]);
const activeTabLine = ref("recommend");
const activeTabBar = ref("幸福");
const activeTabSegment = ref("recommend");

/** 监听颜色变化，同步到主题 */
watch(colorHex, (hex) => {
  theme.setCustomColor(hex);
});

/** 全选半选状态（示例） */
const checkAllIndeterminate = computed(() => {
  const values = [onlyLossless.value, onlyLocal.value, withLyric.value];
  const checkedCount = values.filter(Boolean).length;
  return checkedCount > 0 && checkedCount < values.length;
});

watch([onlyLossless, onlyLocal, withLyric], ([a, b, c]) => {
  checkAll.value = a && b && c;
});

const handleToggleAll = (checked: boolean): void => {
  onlyLossless.value = checked;
  onlyLocal.value = checked;
  withLyric.value = checked;
};

const handleSortFieldChange = (value: string | number | boolean): void => {
  if (value === "title" || value === "artist" || value === "album") {
    sortField.value = value;
  }
};

/** 测试 loading → success 的 toast 流程 */
const testLoadingToast = (): void => {
  const t = toast.loading("加载中...");
  setTimeout(() => {
    t.close();
    toast.success("加载完成");
  }, 2000);
};
</script>

<template>
  <div class="flex flex-col items-center gap-4 p-8 max-w-xl mx-auto">
    <div class="flex items-center gap-3 w-full">
      <h2 class="text-lg font-semibold flex-1">SPlayer UI Test</h2>
      <!-- 主题类型 -->
      <select
        class="px-2 py-1.5 rounded-lg text-sm border border-solid border-outline-variant bg-surface-alt text-on-surface outline-none"
        :value="theme.source"
        @change="theme.source = ($event.target as HTMLSelectElement).value as ThemeSource"
      >
        <option v-for="opt in sourceOptions" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <!-- 主色预览 -->
      <span
        class="block w-6 h-6 rounded-full border-2 border-outline-variant shrink-0"
        :style="{ backgroundColor: theme.activeColor }"
      />
      <!-- 全局着色 -->
      <button
        class="px-3 py-1.5 rounded-lg text-sm border border-solid border-outline-variant"
        :class="
          theme.globalTint ? 'bg-primary text-on-primary' : 'bg-surface-alt text-on-surface-variant'
        "
        @click="theme.globalTint = !theme.globalTint"
      >
        着色
      </button>
      <!-- 明暗切换 -->
      <button
        class="px-3 py-1.5 rounded-lg bg-surface-alt text-on-surface-variant text-sm border border-solid border-outline-variant"
        @click="theme.cycleMode()"
      >
        {{ modeLabel[theme.mode] }}
      </button>
    </div>

    <!-- 默认按钮 -->
    <SButton ripple>默认按钮</SButton>
    <SButton disabled>取消</SButton>
    <!-- 实底彩色 -->
    <SButton type="primary">确认</SButton>
    <SButton type="success" :loading="btnLoading" @click="btnLoading = !btnLoading">
      <template #icon><IconLucideSave /></template>
      保存
    </SButton>
    <SButton
      type="error"
      variant="secondary"
      round
      :loading="btnLoading"
      @click="btnLoading = !btnLoading"
    >
      <template #icon><IconLucideTrash /></template>
      删除
    </SButton>
    <SButton :loading="btnLoading" @click="btnLoading = !btnLoading">加载测试</SButton>
    <SButton type="cover" variant="ghost">封面色</SButton>
    <!-- 描边 -->
    <SButton type="primary" variant="outline">描边</SButton>
    <SButton type="info" variant="outline" dashed>描边虚线</SButton>
    <!-- 次要/三级 -->
    <SButton type="primary" variant="secondary" ripple>次要</SButton>
    <SButton type="info" variant="secondary">次要</SButton>
    <SButton type="info" variant="tertiary">三级</SButton>
    <!-- 幽灵 -->
    <SButton type="warning" variant="ghost">幽灵</SButton>
    <SButton type="error" variant="ghost">幽灵</SButton>
    <SButton type="error" variant="text">纯文字</SButton>
    <!-- bordered -->
    <SButton variant="bordered">边框</SButton>
    <SButton type="info" variant="bordered">边框</SButton>
    <SButton type="info" variant="bordered" dashed>边框虚线</SButton>

    <!-- Toast 测试 -->
    <div class="flex gap-2 w-full flex-wrap">
      <SButton size="small" @click="toast.show('这是一条普通消息')">Default</SButton>
      <SButton type="info" size="small" @click="toast.info('这是一条信息')">Info</SButton>
      <SButton type="success" size="small" @click="toast.success('操作成功')">Success</SButton>
      <SButton type="warning" size="small" @click="toast.warning('请注意')">Warning</SButton>
      <SButton type="error" size="small" @click="toast.error('出错了')">Error</SButton>
      <SButton size="small" @click="toast.loading('加载中...')">Loading</SButton>
      <SButton size="small" @click="testLoadingToast">Loading→Success</SButton>
      <SButton size="small" @click="toast.info('5秒后关闭', { duration: 5000 })">5s</SButton>
      <SButton size="small" @click="toast.success('可关闭', { closable: true })">可关闭</SButton>
      <SButton size="small" @click="toast.show('无图标', { icon: false })">无图标</SButton>
    </div>

    <!-- click 触发（默认） -->
    <SPopover>
      <template #trigger>
        <SButton>点我</SButton>
      </template>
      弹出内容
    </SPopover>

    <!-- hover 触发 -->
    <SPopover trigger="hover" side="top" arrow>
      <template #trigger>
        <span>悬停查看</span>
      </template>
      提示信息
    </SPopover>

    <!-- focus 触发 -->
    <SPopover trigger="focus" side="right">
      <template #trigger>
        <input placeholder="聚焦显示" />
      </template>
      输入帮助
    </SPopover>

    <!-- Dialog 测试 -->
    <SDialog title="确认操作" description="此操作不可撤销，确定继续吗？">
      <template #trigger>
        <SButton type="primary">打开对话框</SButton>
      </template>
      <p class="text-sm">这是对话框的主体内容区域。</p>
      <template #footer="{ close }">
        <SButton variant="ghost" @click="close">取消</SButton>
        <SButton type="primary" @click="close">确认</SButton>
      </template>
    </SDialog>

    <!-- Dialog cover 模式 -->
    <SDialog title="音质详情" cover>
      <template #trigger>
        <SButton type="cover" variant="secondary">Cover 对话框</SButton>
      </template>
      <p class="text-sm text-cover/70">这是 cover 主题模式的对话框，适合在播放器内使用。</p>
      <template #footer="{ close }">
        <SButton type="cover" variant="ghost" @click="close">关闭</SButton>
      </template>
    </SDialog>

    <!-- Drawer 测试 -->
    <SDrawer title="播放列表">
      <template #trigger>
        <SButton>右侧抽屉</SButton>
      </template>
      <div class="flex flex-col gap-2 p-4">
        <div
          v-for="index in 20"
          :key="index"
          class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-primary/8 cursor-pointer"
        >
          <span class="text-xs text-on-surface-variant min-w-5 text-right">{{ index }}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm truncate">示例歌曲 {{ index }}</div>
            <div class="text-xs text-on-surface-variant truncate">未知艺术家</div>
          </div>
          <span class="text-xs text-on-surface-variant">3:30</span>
        </div>
      </div>
    </SDrawer>

    <!-- Drawer 左侧 -->
    <SDrawer title="导航" side="left" width="280px">
      <template #trigger>
        <SButton>左侧抽屉</SButton>
      </template>
      <div class="p-4 text-sm">左侧抽屉内容</div>
    </SDrawer>

    <!-- Drawer 非模态 -->
    <SDrawer title="非模态抽屉" :modal="false">
      <template #trigger>
        <SButton variant="outline">非模态抽屉</SButton>
      </template>
      <div class="p-4 text-sm">无遮罩，可以操作背后的内容</div>
    </SDrawer>

    <!-- 颜色选择器（仅自定义时显示） -->
    <div v-if="theme.source === 'custom'" class="w-full mt-4 flex items-center gap-3">
      <span class="text-xs text-on-surface-variant shrink-0">主题色</span>
      <ColorSliderRoot
        v-model="colorHex"
        channel="hue"
        class="relative flex items-center flex-1 h-5 select-none touch-none"
      >
        <ColorSliderTrack class="relative flex-1 rounded-full h-3" />
        <ColorSliderThumb
          class="block w-5 h-5 rounded-full bg-white border-2 border-outline-variant shadow cursor-pointer"
        />
      </ColorSliderRoot>
      <span class="text-xs text-on-surface-variant font-mono shrink-0">{{
        theme.activeColor
      }}</span>
    </div>

    <!-- Radio / Checkbox 示例 -->
    <div class="w-full mt-2 rounded-xl border border-solid border-outline-variant/40 p-4 space-y-4">
      <h3 class="text-sm font-semibold text-on-surface">SRadio / SCheckbox 示例</h3>

      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">Radio（排序字段）</div>
        <div class="flex items-center flex-wrap gap-4">
          <SRadio
            :checked="sortField === 'title'"
            value="title"
            label="标题"
            @change="handleSortFieldChange"
          />
          <SRadio
            :checked="sortField === 'artist'"
            value="artist"
            label="歌手"
            @change="handleSortFieldChange"
          />
          <SRadio
            :checked="sortField === 'album'"
            value="album"
            label="专辑"
            @change="handleSortFieldChange"
          />
          <SRadio
            :checked="false"
            value="album"
            label="禁用"
            disabled
            @change="handleSortFieldChange"
          />
        </div>
        <div class="text-xs text-on-surface-variant">当前值：{{ sortField }}</div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">Radio Group</div>
        <SRadioGroup v-model:value="radioGroupValue" name="radiogroup-demo">
          <SRadio
            v-for="song in radioSongs"
            :key="song.value"
            :value="song.value"
            :label="song.label"
          />
        </SRadioGroup>
        <div class="text-xs text-on-surface-variant">当前值：{{ radioGroupValue }}</div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">Checkbox（筛选条件）</div>
        <div class="flex items-center flex-wrap gap-4">
          <SCheckbox
            :checked="checkAll"
            :indeterminate="checkAllIndeterminate"
            label="全选"
            @update:checked="handleToggleAll"
          />
          <SCheckbox
            :checked="onlyLossless"
            label="仅无损"
            @update:checked="onlyLossless = $event"
          />
          <SCheckbox :checked="onlyLocal" label="仅本地" @update:checked="onlyLocal = $event" />
          <SCheckbox :checked="withLyric" label="含歌词" @update:checked="withLyric = $event" />
          <SCheckbox
            :checked="onlyLossless"
            label="禁用"
            disabled
            @update:checked="onlyLossless = $event"
          />
        </div>
        <div class="text-xs text-on-surface-variant">
          当前值：{ onlyLossless: {{ onlyLossless }}, onlyLocal: {{ onlyLocal }}, withLyric:
          {{ withLyric }} }
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">Checkbox Group</div>
        <SCheckboxGroup v-model:value="cities">
          <SCheckbox value="Beijing" label="北京" />
          <SCheckbox value="Shanghai" label="上海" />
          <SCheckbox value="Guangzhou" label="广州" />
          <SCheckbox value="Shenzhen" label="深圳" />
        </SCheckboxGroup>
        <div class="text-xs text-on-surface-variant">
          当前值：{{ cities.join(" / ") || "（空）" }}
        </div>
      </div>

      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">尺寸</div>
        <div class="flex items-center flex-wrap gap-5">
          <SRadio
            :checked="sortField === 'title'"
            value="title"
            size="small"
            label="Radio small"
            @change="handleSortFieldChange"
          />
          <SRadio
            :checked="sortField === 'artist'"
            value="artist"
            size="medium"
            label="Radio medium"
            @change="handleSortFieldChange"
          />
          <SRadio
            :checked="sortField === 'album'"
            value="album"
            size="large"
            label="Radio large"
            @change="handleSortFieldChange"
          />
          <SCheckbox
            :checked="onlyLocal"
            size="small"
            label="Check small"
            @update:checked="onlyLocal = $event"
          />
          <SCheckbox
            :checked="onlyLocal"
            size="medium"
            label="Check medium"
            @update:checked="onlyLocal = $event"
          />
          <SCheckbox
            :checked="onlyLocal"
            size="large"
            label="Check large"
            @update:checked="onlyLocal = $event"
          />
        </div>
      </div>
    </div>

    <!-- Tabs 示例 -->
    <div class="w-full rounded-xl border border-solid border-outline-variant/40 p-4 space-y-3">
      <h3 class="text-sm font-semibold text-on-surface">STabs 示例</h3>
      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">line</div>
        <STabs
          v-model="activeTabLine"
          type="line"
          animated
          :tabs="[
            { key: 'recommend', label: '推荐' },
            { key: 'playlist', label: '歌单' },
            { key: 'radio', label: '电台', disabled: true },
          ]"
        >
          <template #recommend>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              这里是推荐内容面板
            </div>
          </template>
          <template #playlist>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              这里是歌单内容面板，这里故意放一段更长的文本用于演示 animated 高度过渡效果。
            </div>
          </template>
          <template #radio>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              这里是电台内容面板
            </div>
          </template>
        </STabs>
      </div>
      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">bar</div>
        <STabs
          v-model="activeTabBar"
          type="bar"
          animated
          :tabs="[{ key: '幸福' }, { key: '的' }, { key: '旁边' }]"
        >
          <template #幸福>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              寂寞围绕着电视
            </div>
          </template>
          <template #的>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              垂死坚持
            </div>
          </template>
          <template #旁边>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              在两点半消失
            </div>
          </template>
        </STabs>
      </div>
      <div class="space-y-2">
        <div class="text-xs text-on-surface-variant">segment</div>
        <STabs
          v-model="activeTabSegment"
          type="segment"
          animated
          :tabs="[
            { key: 'recommend', label: '第一章' },
            { key: 'playlist', label: '第二章' },
            { key: 'radio', label: '第三章' },
          ]"
        >
          <template #recommend>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              第一章内容
            </div>
          </template>
          <template #playlist>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              第二章内容
            </div>
          </template>
          <template #radio>
            <div class="rounded-lg bg-surface-alt/60 px-3 py-2 text-sm text-on-surface-variant">
              第三章内容
            </div>
          </template>
        </STabs>
      </div>
    </div>

    <!-- Netease 搜索测试 -->
    <div class="w-full rounded-xl border border-solid border-outline-variant/40 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-on-surface">Netease 搜索测试</h3>
        <span v-if="searchCount > 0" class="text-xs text-on-surface-variant">
          共 {{ searchCount }} 条
        </span>
      </div>
      <div class="flex gap-2">
        <SInput
          v-model="searchKeyword"
          placeholder="输入关键词"
          clearable
          class="flex-1"
          @keydown.enter="handleSearch"
        />
        <SButton type="primary" :loading="searchLoading" @click="handleSearch">
          <template #icon>
            <IconLucideSearch class="size-4" />
          </template>
          搜索
        </SButton>
      </div>
      <div v-if="searchError" class="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-500">
        {{ searchError }}
      </div>
      <ul v-if="searchSongs.length > 0" class="flex flex-col gap-1.5 list-none p-0 m-0">
        <li
          v-for="song in searchSongs"
          :key="song.id"
          class="flex items-center gap-3 rounded-lg bg-on-surface/5 px-3 py-2"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm text-on-surface truncate">{{ song.name }}</div>
            <div class="text-xs text-on-surface-variant truncate">
              {{ formatArtists(song) }}
              <template v-if="song.album?.name"> · {{ song.album.name }}</template>
            </div>
          </div>
          <span class="text-xs text-on-surface-variant/60 font-mono">{{ song.id }}</span>
        </li>
      </ul>
      <div
        v-else-if="!searchLoading && !searchError"
        class="py-4 text-center text-xs text-on-surface-variant/50"
      >
        输入关键词并点击搜索
      </div>
    </div>
  </div>
</template>
