<script setup lang="ts">
import { marked } from "marked";
import agreementRaw from "@root/USER_AGREEMENT.md?raw";
import IconFileText from "~icons/lucide/file-text";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();
const props = withDefaults(
  defineProps<{ variant?: "onboarding" | "update"; loading?: boolean }>(),
  {
    variant: "onboarding",
    loading: false,
  },
);

const isUpdate = computed(() => props.variant === "update");
const titleKey = computed(() =>
  isUpdate.value ? "agreementUpdate.title" : "onboarding.agreement.title",
);
const subtitleKey = computed(() =>
  isUpdate.value ? "agreementUpdate.subtitle" : "onboarding.agreement.subtitle",
);
const acceptKey = computed(() =>
  isUpdate.value ? "agreementUpdate.accept" : "onboarding.agreement.accept",
);

const agreementHtml = marked.parse(agreementRaw, { async: false }) as string;

const scrollArea = ref<HTMLElement | null>(null);
const readToEnd = ref(false);
const agreed = ref(false);

const canContinue = computed(() => readToEnd.value && agreed.value);

/** 滚动至底部后解锁同意勾选 */
const checkScroll = (): void => {
  const element = scrollArea.value;
  if (!element) return;
  if (element.scrollTop + element.clientHeight >= element.scrollHeight - 8) {
    readToEnd.value = true;
  }
};

onMounted(() => {
  nextTick(checkScroll);
});

const handleContinue = (): void => {
  if (!canContinue.value) return;
  emit("next");
};
</script>

<template>
  <div class="flex flex-col h-full w-full">
    <div class="flex items-center gap-3 mb-2 shrink-0">
      <IconFileText class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t(titleKey) }}</h2>
    </div>
    <p class="text-on-surface-variant/70 mb-4 leading-relaxed shrink-0">
      {{ t(subtitleKey) }}
    </p>
    <!-- eslint-disable vue/no-v-html -->
    <div
      ref="scrollArea"
      class="markdown-body flex-1 min-h-0 overflow-y-auto px-5 py-4 bg-on-surface/4 border border-solid border-primary/10 rounded-xl"
      @scroll="checkScroll"
      v-html="agreementHtml"
    />
    <!-- eslint-enable vue/no-v-html -->
    <div class="shrink-0 flex items-center gap-2.5 my-4">
      <SCheckbox v-model:checked="agreed" :disabled="!readToEnd" size="small">
        <span class="text-xs">{{ t("onboarding.agreement.agree") }}</span>
      </SCheckbox>
      <span
        class="text-xs text-on-surface-variant/40 transition-opacity"
        :class="readToEnd ? 'opacity-0' : 'opacity-100'"
      >
        {{ t("onboarding.agreement.scrollHint") }}
      </span>
    </div>
    <div class="flex items-center gap-3 shrink-0">
      <SButton v-if="!isUpdate" variant="ghost" round :disabled="loading" @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton
        type="primary"
        round
        :disabled="!canContinue"
        :loading="loading"
        @click="handleContinue"
      >
        {{ t(acceptKey) }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>
  </div>
</template>
