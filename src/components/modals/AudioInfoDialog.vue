<script setup lang="ts">
import type { AudioStreamInfo } from "@shared/types/player";
import { useMediaStore } from "@/stores/media";
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";

const { t } = useI18n();
const media = useMediaStore();
const status = useStatusStore();
const settings = useSettingsStore();

/** 从原生音频引擎读取的真实流与硬件参数 */
const streamInfo = ref<AudioStreamInfo | null>(null);

/** 获取底层真实流信息 */
const fetchStreamInfo = async () => {
  try {
    const res = await window.api.player.getStreamInfo();
    if (res?.success && res.data) {
      streamInfo.value = res.data;
    }
  } catch {
    streamInfo.value = null;
  }
};

// 弹窗打开或播放状态变化时刷新真实底层数据
watch(
  () => [status.audioInfoOpen, status.state, media.track?.id],
  ([open]) => {
    if (open) {
      void fetchStreamInfo();
    }
  },
  { immediate: true },
);

/** 音频元数据规格 */
const quality = computed(() => media.detail?.quality ?? media.track?.quality);

/** 编码格式 */
const codecText = computed(() => quality.value?.codec?.toUpperCase() || "--");

/**
 * 格式化采样率显示文本
 * @param sampleRateHz - 采样率（Hz）
 * @returns 格式化后的采样率文本
 */
const formatSampleRate = (sampleRateHz?: number): string => {
  if (!sampleRateHz) {
    return "--";
  }
  return `${(sampleRateHz / 1000).toFixed(1)} kHz`;
};

/**
 * 格式化位深显示文本
 * @param bits - 位深
 * @returns 格式化后的位深文本
 */
const formatBitDepth = (bits?: number): string => {
  if (!bits || bits <= 0) {
    return "--";
  }
  return `${bits} bit`;
};

/**
 * 格式化比特率显示文本
 * @param rawBitRate - 原始比特率数值
 * @returns 格式化后的比特率文本
 */
const formatBitRate = (rawBitRate?: number): string => {
  if (!rawBitRate) {
    return "--";
  }
  const bitRateKbps = rawBitRate > 10000 ? Math.round(rawBitRate / 1000) : Math.round(rawBitRate);
  return `${bitRateKbps} kbps`;
};

/**
 * 格式化声道数显示文本
 * @param channelCount - 声道数量
 * @returns 格式化后的声道文本
 */
const formatChannels = (channelCount?: number): string => {
  if (!channelCount) {
    return "--";
  }
  if (channelCount === 1) {
    return `${t("quality.mono")} · 1`;
  }
  if (channelCount === 2) {
    return `${t("quality.stereo")} · 2`;
  }
  return `${t("quality.multiChannel")} · ${channelCount}`;
};

/** 核心参数小卡片数据 */
const coreCards = computed(() => {
  const currentQuality = quality.value;
  const currentStream = streamInfo.value;

  const outputSampleRate = currentStream?.outputSampleRate || currentQuality?.sampleRate;
  const outputBitDepth =
    currentStream?.outputBits ||
    (currentQuality?.bitsPerSample && currentQuality.bitsPerSample > 0
      ? currentQuality.bitsPerSample
      : 0);
  const outputChannels = currentStream?.outputChannels || currentQuality?.channels;

  return [
    { label: t("quality.sampleRate"), value: formatSampleRate(outputSampleRate) },
    { label: t("quality.bitDepth"), value: formatBitDepth(outputBitDepth) },
    { label: t("quality.bitRate"), value: formatBitRate(currentQuality?.bitRate) },
    { label: t("quality.channels"), value: formatChannels(outputChannels) },
  ];
});

/** 当前生效的物理输出设备名称 */
const currentDeviceName = computed(() => {
  if (streamInfo.value?.deviceName) {
    return streamInfo.value.deviceName;
  }
  const selectedDeviceId = settings.system.player.outputDevice;
  if (!selectedDeviceId) {
    const defaultDevice = status.outputDevices.find((device) => device.isDefault);
    return defaultDevice?.name
      ? `${t("settings.outputDevice.default")} (${defaultDevice.name})`
      : t("settings.outputDevice.default");
  }
  const matchedDevice = status.outputDevices.find((device) => device.id === selectedDeviceId);
  return matchedDevice?.name || t("settings.outputDevice.default");
});

/** 当前音频输出模式 */
const isExclusive = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isExclusive;
  }
  return settings.system.player.audioOutputMode === "exclusive";
});
const outputModeText = computed(() => {
  return isExclusive.value
    ? t("settings.audioOutputMode.exclusive")
    : t("settings.audioOutputMode.shared");
});

/** 重采样状态 */
const isResampling = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isResampling;
  }
  return !isExclusive.value;
});
const resamplingStatusText = computed(() => {
  return isResampling.value ? t("common.enabled") : t("common.disabled");
});

/** 均衡器状态 */
const isEqualizerEnabled = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isEqualizerActive;
  }
  return settings.system.player.equalizer?.enabled ?? false;
});
const equalizerStatusText = computed(() => {
  return isEqualizerEnabled.value ? t("common.enabled") : t("common.disabled");
});

/** 变速变调状态 */
const isTempoActive = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isTempoActive;
  }
  return (status.speed ?? 1.0) !== 1.0;
});
const tempoPitchStatusText = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isTempoActive ? `${streamInfo.value.speed}x` : t("common.disabled");
  }
  return isTempoActive.value ? `${status.speed}x` : t("common.disabled");
});

/** 音量均衡状态 */
const isNormalizationEnabled = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isNormalizationActive;
  }
  return settings.system.player.loudnessNormalization ?? false;
});
const loudnessNormalizationText = computed(() => {
  return isNormalizationEnabled.value ? t("common.enabled") : t("common.disabled");
});

/** 输出限幅器状态 */
const isLimiterActive = computed(() => {
  if (streamInfo.value != null) {
    return streamInfo.value.isLimiterActive;
  }
  return isEqualizerEnabled.value || isTempoActive.value || isNormalizationEnabled.value;
});
const limiterStatusText = computed(() => {
  return isLimiterActive.value ? t("common.enabled") : t("common.disabled");
});

interface InfoItem {
  label: string;
  value: string;
  colSpan?: boolean;
}

interface InfoSection {
  title: string;
  items: InfoItem[];
}

/** 分类参数列表 */
const sections = computed<InfoSection[]>(() => [
  {
    title: t("quality.outputSection"),
    items: [
      { label: t("quality.codec"), value: codecText.value },
      { label: t("quality.outputMode"), value: outputModeText.value },
      { label: t("quality.resampling"), value: resamplingStatusText.value },
      { label: t("settings.outputDevice.label"), value: currentDeviceName.value, colSpan: true },
    ],
  },
  {
    title: t("quality.dspSection"),
    items: [
      { label: t("equalizer.title"), value: equalizerStatusText.value },
      { label: t("quality.tempoPitch"), value: tempoPitchStatusText.value },
      { label: t("settings.loudnessNormalization.label"), value: loudnessNormalizationText.value },
      { label: t("quality.limiter"), value: limiterStatusText.value },
    ],
  },
]);
</script>

<template>
  <SDialog
    v-model:open="status.audioInfoOpen"
    :title="t('quality.outputInfo')"
    width="460px"
    destroy-on-close
  >
    <div class="flex flex-col gap-4">
      <div class="grid grid-cols-4 gap-2">
        <SCard
          v-for="card in coreCards"
          :key="card.label"
          size="small"
          radius="lg"
          variant="settings"
          class="flex flex-col items-center justify-center text-center"
        >
          <span class="text-xs text-on-surface-variant truncate w-full">
            {{ card.label }}
          </span>
          <span class="text-sm font-semibold text-on-surface tabular-nums mt-0.5 truncate w-full">
            {{ card.value }}
          </span>
        </SCard>
      </div>
      <!-- 分组参数信息 -->
      <section v-for="section in sections" :key="section.title" class="flex flex-col gap-2">
        <div class="flex items-center gap-1.5">
          <span class="w-1 h-3 rounded-full bg-primary" />
          <h4 class="text-sm font-semibold text-on-surface tracking-wide">
            {{ section.title }}
          </h4>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-on-surface-variant">
          <div
            v-for="item in section.items"
            :key="item.label"
            class="flex items-center gap-2 min-w-0"
            :class="item.colSpan && 'col-span-2'"
          >
            <span class="shrink-0 text-on-surface-variant">{{ item.label }}</span>
            <span class="text-on-surface font-medium truncate" :title="item.value">
              {{ item.value }}
            </span>
          </div>
        </div>
      </section>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
