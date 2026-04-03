<script setup lang="ts">
import type { SMenuItem } from "@/components/ui/SMenu.vue";
import { useStatusStore } from "@/stores/status";
import IconLucideHome from "~icons/lucide/home";
import IconLucideMusic from "~icons/lucide/music";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const status = useStatusStore();

const { sidebarCollapsed } = storeToRefs(status);

const menuItems = computed<SMenuItem[]>(() => [
  { key: "/", label: t("nav.home"), icon: markRaw(IconLucideHome) },
  { key: "/library", label: t("nav.library"), icon: markRaw(IconLucideMusic) },
]);

const activeKey = computed(() => {
  return menuItems.value.find((item) => route.path === item.key || route.path.startsWith(item.key + "/"))?.key ?? "/";
});

const onSelect = (key: string) => {
  router.push(key);
};
</script>

<template>
  <div class="flex flex-col h-full">
    <SideBarLogo :collapsed="sidebarCollapsed" />
    <div class="pb-3 transition-[padding] duration-300" :class="sidebarCollapsed ? 'px-2' : 'px-3'">
      <SMenu :items="menuItems" :model-value="activeKey" :collapsed="sidebarCollapsed" @select="onSelect" />
    </div>
    <!-- 底部折叠按钮 -->
    <div
      class="mt-auto px-3 pb-3 flex"
      :class="sidebarCollapsed ? 'justify-center' : 'justify-end'"
    >
      <SButton variant="tertiary" circle :size="32" @click="sidebarCollapsed = !sidebarCollapsed">
        <template #icon>
          <IconLucidePanelLeftClose v-if="!sidebarCollapsed" class="size-4" />
          <IconLucidePanelLeftOpen v-else class="size-4" />
        </template>
      </SButton>
    </div>
  </div>
</template>
