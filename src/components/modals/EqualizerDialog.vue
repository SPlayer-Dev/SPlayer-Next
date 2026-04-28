<script setup lang="ts">
import type { EqualizerPreset } from "@shared/types/settings";
import { useSettingsStore } from "@/stores/settings";

const EQ_PRESETS: Record<Exclude<EqualizerPreset, "custom">, number[]> = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  pop: [-1, 2, 4, 5, 3, 1, -1, -1, 0, 1],
  rock: [4, 3, -2, -3, -1, 2, 4, 5, 5, 5],
  classical: [4, 3, 2, 1, -1, -1, 0, 2, 3, 4],
  electronic: [4, 3, 1, -2, -2, 1, 2, 3, 4, 5],
  bass: [6, 5, 4, 2, 0, -1, -2, -3, -3, -3],
  vocal: [-2, -1, -1, 1, 3, 3, 2, 1, 0, -1],
  dance: [4, 5, 3, 0, 1, 3, 4, 4, 3, 0],
  soft: [3, 1, 0, 2, 3, 2, 1, 2, 3, 4],
};

const EQ_PRESET_ORDER: EqualizerPreset[] = [
  "flat",
  "pop",
  "rock",
  "classical",
  "electronic",
  "bass",
  "vocal",
  "dance",
  "soft",
  "custom",
];

const matchPreset = (bands: number[]): EqualizerPreset => {
  for (const [name, preset] of Object.entries(EQ_PRESETS)) {
    if (preset.length === bands.length && preset.every((v, i) => Math.abs(v - bands[i]) < 0.01)) {
      return name as EqualizerPreset;
    }
  }
  return "custom";
};

defineProps<{ open: boolean }>();

const emit = defineEmits<{ "update:open": [value: boolean] }>();

const { t } = useI18n();
const settings = useSettingsStore();

const presetOptions = computed(() =>
  EQ_PRESET_ORDER.map((key) => ({
    value: key,
    label: t(`equalizer.preset.${key}`),
  })),
);

const FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FREQ_LABELS = FREQUENCIES.map((f) => (f >= 1000 ? `${f / 1000}k` : `${f}`));

const BAND_MIN = -15;
const BAND_MAX = 15;
const PREAMP_MIN = -12;
const PREAMP_MAX = 12;

const localBands = ref<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const localPreamp = ref(0);

watchEffect(() => {
  const eq = settings.system.player.equalizer;
  if (!eq) return;
  localBands.value = [...eq.bands];
  localPreamp.value = eq.preamp ?? 0;
});

const enabled = computed({
  get: () => settings.system.player.equalizer?.enabled ?? false,
  set: (value: boolean) => settings.setSystem("player.equalizer.enabled", value),
});

const currentPreset = computed(
  () => (settings.system.player.equalizer?.preset ?? "flat") as EqualizerPreset,
);

const applyPreset = (key: EqualizerPreset): void => {
  if (!enabled.value) return;
  if (key === "custom") {
    settings.setSystem("player.equalizer.preset", "custom");
    return;
  }
  const bands = [...EQ_PRESETS[key]];
  localBands.value = bands;
  settings.setSystem("player.equalizer.bands", bands);
  settings.setSystem("player.equalizer.preset", key);
};

const onBandChange = (index: number, value: number): void => {
  localBands.value[index] = value;
};

const onBandCommit = (): void => {
  const bands = [...localBands.value];
  const matched = matchPreset(bands);
  settings.setSystem("player.equalizer.bands", bands);
  settings.setSystem("player.equalizer.preset", matched);
};

const onPreampChange = (value: number): void => {
  localPreamp.value = value;
};

const onPreampCommit = (): void => {
  settings.setSystem("player.equalizer.preamp", localPreamp.value);
};

const formatDb = (value: number): string => `${value > 0 ? "+" : ""}${value}dB`;

const handleReset = (): void => {
  applyPreset("flat");
  localPreamp.value = 0;
  settings.setSystem("player.equalizer.preamp", 0);
};
</script>

<template>
  <SDialog
    :open="open"
    :title="t('equalizer.title')"
    width="540px"
    @update:open="emit('update:open', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <span class="text-sm text-on-surface-variant">
          {{ t("equalizer.preset.label") }}
        </span>
        <div class="w-38">
          <SSelect
            :model-value="currentPreset"
            :options="presetOptions"
            :disabled="!enabled"
            @update:model-value="applyPreset($event as EqualizerPreset)"
          />
        </div>
        <div class="flex-1" />
        <SSwitch :model-value="enabled" @update:model-value="enabled = $event" />
      </div>
      <SCard
        class="flex items-stretch gap-1 transition-opacity"
        :class="enabled ? '' : 'opacity-50 pointer-events-none'"
      >
        <div class="flex-1 flex flex-col items-center gap-2 min-w-0">
          <div class="text-xs text-on-surface-variant/70 tabular-nums h-4">
            {{ formatDb(localPreamp) }}
          </div>
          <div class="h-40 w-full flex justify-center">
            <SSlider
              :model-value="localPreamp"
              :min="PREAMP_MIN"
              :max="PREAMP_MAX"
              :step="1"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="16"
              :track-height="5"
              @change="onPreampChange"
              @drag-end="onPreampCommit"
            >
              <template #popover="{ value }">{{ formatDb(value) }}</template>
            </SSlider>
          </div>
          <div class="text-xs text-on-surface-variant whitespace-nowrap">
            {{ t("equalizer.preamp") }}
          </div>
        </div>
        <SDivider vertical class="!h-auto self-stretch mx-1.5" />
        <div
          v-for="(label, index) in FREQ_LABELS"
          :key="label"
          class="flex-1 flex flex-col items-center gap-2 min-w-0"
        >
          <div class="text-xs text-on-surface-variant/70 tabular-nums h-4">
            {{ formatDb(localBands[index]) }}
          </div>
          <div class="h-40 w-full flex justify-center">
            <SSlider
              :model-value="localBands[index]"
              :min="BAND_MIN"
              :max="BAND_MAX"
              :step="1"
              :show-popover="false"
              vertical
              center-fill
              :thumb-size="16"
              :track-height="5"
              @change="onBandChange(index, $event)"
              @drag-end="onBandCommit"
            >
              <template #popover="{ value }">{{ formatDb(value) }}</template>
            </SSlider>
          </div>
          <div class="text-xs text-on-surface-variant tabular-nums">{{ label }}</div>
        </div>
      </SCard>
    </div>

    <template #footer="{ close }">
      <SButton variant="secondary" :disabled="!enabled" @click="handleReset">
        {{ t("equalizer.reset") }}
      </SButton>
      <SButton type="primary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
