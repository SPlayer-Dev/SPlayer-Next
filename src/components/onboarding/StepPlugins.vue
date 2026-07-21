<script setup lang="ts">
import PluginImport from "@/components/settings/custom/PluginImport.vue";
import PluginMarket from "@/components/settings/custom/PluginMarket.vue";
import IconPuzzle from "~icons/lucide/puzzle";
import IconCheck from "~icons/lucide/check";
import IconChevronLeft from "~icons/lucide/chevron-left";
import IconArrowRight from "~icons/lucide/arrow-right";

const { t } = useI18n();
defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ (e: "next"): void; (e: "back"): void }>();

/** 插件功能介绍要点 */
const FEATURES = ["extend", "market", "safe"] as const;
</script>

<template>
  <div class="flex flex-col h-full max-w-2xl w-full mx-auto">
    <div class="shrink-0 flex items-center gap-3 mb-2">
      <IconPuzzle class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.plugins.title") }}</h2>
    </div>
    <p class="shrink-0 text-on-surface-variant/70 mb-4 leading-relaxed">
      {{ t("onboarding.plugins.subtitle") }}
    </p>

    <div class="flex-1 min-h-0 overflow-y-auto pr-1 -mr-1">
      <!-- 功能介绍 -->
      <div class="bg-on-surface/4 border border-solid border-primary/10 rounded-xl p-5 mb-5">
        <div class="flex flex-col gap-3">
          <div v-for="feat in FEATURES" :key="feat" class="flex items-start gap-3">
            <IconCheck class="size-4 text-primary shrink-0 mt-0.5" />
            <div class="flex-1">
              <div class="text-sm font-medium">
                {{ t(`onboarding.plugins.features.${feat}.title`) }}
              </div>
              <div class="text-xs text-on-surface-variant/60 mt-0.5 leading-relaxed">
                {{ t(`onboarding.plugins.features.${feat}.desc`) }}
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 导入插件 -->
      <PluginImport class="mb-5" />

      <!-- 插件市场 -->
      <h3 class="flex items-center gap-2 text-lg font-semibold text-on-surface mb-3 px-1">
        <span class="w-0.75 h-4 rounded-full bg-primary" />
        {{ t("onboarding.plugins.marketLabel") }}
      </h3>
      <PluginMarket />
    </div>

    <div class="shrink-0 flex items-center gap-3 mt-4">
      <SButton variant="ghost" round :disabled="loading" @click="emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round :loading="loading" @click="emit('next')">
        {{ t("onboarding.next") }}
        <template #icon><IconArrowRight /></template>
      </SButton>
    </div>
  </div>
</template>
