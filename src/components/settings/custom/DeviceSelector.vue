<script setup lang="ts">
import { useStatusStore } from "@/stores/status";
import { useSettingsStore } from "@/stores/settings";
import { refreshDevices, switchDevice } from "@/core/player";

const { t } = useI18n();
const status = useStatusStore();
const settings = useSettingsStore();

// 系统默认
const SYSTEM_DEFAULT = "system-default";

const current = computed(() => settings.player.outputDevice ?? SYSTEM_DEFAULT);

const options = computed(() => {
  const defaultName = status.outputDevices.find((d) => d.isDefault)?.name;
  const defaultLabel = defaultName
    ? `${t("settings.outputDevice.default")}（${defaultName}）`
    : t("settings.outputDevice.default");
  return [
    { value: SYSTEM_DEFAULT, label: defaultLabel },
    ...status.outputDevices.map((d) => ({ value: d.name, label: d.name })),
  ];
});

const onChange = (value: string | number | boolean) => {
  switchDevice(value === SYSTEM_DEFAULT ? null : String(value));
};

onMounted(() => {
  if (status.outputDevices.length === 0) refreshDevices();
});
</script>

<template>
  <SSelect
    :model-value="current"
    :options="options"
    :placeholder="t('settings.outputDevice.default')"
    @update:model-value="onChange"
  />
</template>
