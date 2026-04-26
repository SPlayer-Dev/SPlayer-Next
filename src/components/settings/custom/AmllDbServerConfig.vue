<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { isExternalUrl, openExternal } from "@/utils/url";

defineOptions({ inheritAttrs: false });

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const { t } = useI18n();

const open = ref(false);
const serverUrl = ref("");

const isValidServer = (url: string): boolean =>
  isExternalUrl(url) && url.includes("%p") && url.includes("%s");

watch(open, (val) => {
  if (val) serverUrl.value = props.modelValue;
});

const handleConfirm = () => {
  const url = serverUrl.value.trim();
  if (!isValidServer(url)) {
    toast.error(t("settings.amllDbServer.invalid"));
    return;
  }
  emit("update:modelValue", url);
  open.value = false;
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" @click="open = true">
    {{ t("settings.amllDbServer.button") }}
  </SButton>
  <SDialog v-model:open="open" :title="t('settings.amllDbServer.label')" width="500px">
    <div class="flex flex-col gap-3 text-sm">
      <p class="text-amber-500">{{ t("settings.amllDbServer.warning") }}</p>
      <p>{{ t("settings.amllDbServer.hint") }}</p>
      <p class="text-on-surface-variant text-xs">
        {{ t("settings.amllDbServer.placeholders") }}
      </p>
      <SInput v-model="serverUrl" :placeholder="t('settings.amllDbServer.placeholder')" clearable />
      <p class="text-on-surface-variant">
        {{ t("settings.amllDbServer.docsHint") }}
        <a
          class="text-primary cursor-pointer hover:underline"
          @click="openExternal('https://github.com/amll-dev/amll-ttml-db')"
          >AMLL TTML DB</a
        >
      </p>
    </div>
    <template #footer="{ close }">
      <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
      <SButton type="primary" @click="handleConfirm">{{ t("common.confirm") }}</SButton>
    </template>
  </SDialog>
</template>
