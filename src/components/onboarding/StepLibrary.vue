<script setup lang="ts">
import IconFolder from "~icons/lucide/folder";
import IconChevronLeft from "~icons/lucide/chevron-left";

const { t } = useI18n();
defineEmits<{ (e: "next"): void; (e: "back"): void }>();
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0 max-w-2xl w-full mx-auto">
    <div class="flex items-center gap-3 mb-2 shrink-0">
      <IconFolder class="size-6 text-primary" />
      <h2 class="text-2xl font-bold">{{ t("onboarding.library.title") }}</h2>
    </div>
    <p class="text-on-surface-variant/70 mb-6 leading-relaxed shrink-0">
      {{ t("onboarding.library.subtitle") }}
    </p>

    <div
      class="flex-1 min-h-0 overflow-y-auto bg-on-surface/4 border border-solid border-primary/10 rounded-xl p-4 mb-6"
    >
      <FolderManager />
    </div>

    <div class="flex items-center gap-3 shrink-0">
      <SButton variant="ghost" round @click="$emit('back')">
        <template #icon><IconChevronLeft /></template>
        {{ t("onboarding.back") }}
      </SButton>
      <div class="flex-1" />
      <SButton type="primary" round @click="$emit('next')">
        {{ t("onboarding.next") }}
      </SButton>
    </div>
  </div>
</template>
