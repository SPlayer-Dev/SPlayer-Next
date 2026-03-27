<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useMediaStore } from "@/stores/media";
import { useThemeStore } from "@/stores/theme";
import * as player from "@/core/player";
import { toast } from "@/composables/useToast";
import type { ThemeSource } from "@/types/theme";

const status = useStatusStore();
const media = useMediaStore();
const theme = useThemeStore();

const { state, position, duration, volume, error, isPlaying, isLoading, progress } =
  storeToRefs(status);

/** 网络地址输入 */
const urlInput = ref("");

/** 按钮加载状态演示 */
const btnLoading = ref(false);

/** 从网络地址加载并添加到队列 */
const loadFromUrl = async (): Promise<void> => {
  const url = urlInput.value.trim();
  if (!url) return;
  await player.addAndPlay(url);
};

/** 打开本地文件对话框并添加到队列 */
const loadFromFile = async (): Promise<void> => {
  const result = await window.api.player.openFile();
  if (!result.success || !result.data) return;
  await player.addAndPlay(result.data);
};

/** 是否有可播放的曲目 */
const hasTrack = computed(() => !!media.track);

/** 切换播放/暂停 */
const togglePlay = (): void => {
  if (!hasTrack.value) return;
  if (isPlaying.value) {
    player.pause();
  } else {
    player.play();
  }
};

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

/** 监听颜色变化，同步到主题 */
watch(colorHex, (hex) => {
  theme.setCustomColor(hex);
});

/** 格式化毫秒为 mm:ss */
const formatTime = (ms: number): string => {
  const totalSecs = Math.floor(ms / 1000);
  const min = Math.floor(totalSecs / 60);
  const sec = totalSecs % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
};

/** 进度条拖动 */
const onSeek = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
  player.seek(value);
};

/** 音量条拖动 */
const onVolumeChange = (e: Event): void => {
  const value = Number((e.target as HTMLInputElement).value);
  player.setVolume(value);
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
      <h2 class="text-lg font-semibold flex-1">SPlayer Audio Test</h2>
      <!-- 主题类型 -->
      <select
        class="px-2 py-1.5 rounded-lg text-sm border border-outline-variant bg-surface-alt text-on-surface outline-none"
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
        class="px-3 py-1.5 rounded-lg text-sm border border-outline-variant"
        :class="theme.globalTint ? 'bg-primary text-on-primary' : 'bg-surface-alt text-on-surface-variant'"
        @click="theme.globalTint = !theme.globalTint"
      >
        着色
      </button>
      <!-- 明暗切换 -->
      <button
        class="px-3 py-1.5 rounded-lg bg-surface-alt text-on-surface-variant text-sm border border-outline-variant"
        @click="theme.cycleMode()"
      >
        {{ modeLabel[theme.mode] }}
      </button>
    </div>

    <!-- 网络地址输入 -->
    <div class="flex gap-2 w-full">
      <input
        v-model="urlInput"
        type="text"
        placeholder="输入网络音频地址..."
        class="flex-1 px-3 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm outline-none focus:border-primary"
        @keydown.enter="loadFromUrl"
      />
      <button
        class="px-4 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm whitespace-nowrap hover:bg-secondary-container"
        @click="loadFromUrl"
      >
        加载网络音频
      </button>
    </div>

    <!-- 本地文件选择 -->
    <div class="flex gap-2 w-full">
      <button
        class="px-4 py-2 rounded-lg border border-outline-variant bg-surface-alt text-on-surface text-sm hover:bg-secondary-container"
        @click="loadFromFile"
      >
        选择本地文件
      </button>
    </div>

    <!-- 错误信息 -->
    <div v-if="error" class="text-red-500 text-sm text-center">{{ error }}</div>

    <!-- 播放控制 -->
    <div class="flex gap-3">
      <SButton type="primary" size="large" :disabled="!hasTrack" @click="player.stop()"> Stop </SButton>
      <SButton
        type="primary"
        variant="secondary"
        size="large"
        circle
        ripple
        :loading="isLoading"
        :disabled="!hasTrack && !isLoading"
        @click="togglePlay"
      >
        <template #icon>
          <IconLucidePause v-if="isPlaying" />
          <IconLucidePlay v-else />
        </template>
      </SButton>
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
    <!-- 进度条 -->
    <div class="flex items-center gap-2 w-full">
      <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
        formatTime(position)
      }}</span>
      <input
        type="range"
        min="0"
        :max="duration"
        step="100"
        :value="position"
        class="flex-1 accent-primary"
        @input="onSeek"
      />
      <span class="text-xs text-on-surface-variant min-w-9 text-center">{{
        formatTime(duration)
      }}</span>
    </div>

    <!-- 音量控制 -->
    <div class="flex items-center gap-2 w-full">
      <span class="text-xs text-on-surface-variant min-w-9 text-center">VOL</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        class="flex-1 accent-primary"
        @input="onVolumeChange"
      />
      <span class="text-xs text-on-surface-variant min-w-9 text-center">
        {{ Math.round(volume * 100) }}%
      </span>
    </div>

    <!-- 音频输出设备 -->
    <div class="flex items-center gap-2 w-full">
      <span class="text-xs text-on-surface-variant shrink-0">输出设备</span>
      <select
        class="flex-1 px-2 py-1.5 rounded-lg text-sm border border-outline-variant bg-surface-alt text-on-surface outline-none"
        :value="status.selectedDeviceName ?? ''"
        @change="player.switchDevice(($event.target as HTMLSelectElement).value || null)"
      >
        <option value="">系统默认</option>
        <option
          v-for="device in status.outputDevices"
          :key="device.name"
          :value="device.name"
        >
          {{ device.name }}{{ device.isDefault ? " (默认)" : "" }}
        </option>
      </select>
      <button
        class="px-2 py-1.5 rounded-lg text-xs border border-outline-variant bg-surface-alt text-on-surface-variant hover:bg-secondary-container"
        @click="player.refreshDevices()"
      >
        刷新
      </button>
    </div>

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

    <!-- 状态信息 -->
    <div class="text-xs text-outline">
      状态: {{ state }} | 进度: {{ Math.round(progress * 100) }}%
    </div>

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
  </div>
</template>
