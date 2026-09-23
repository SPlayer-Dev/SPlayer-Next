<script setup lang="ts">
import { toast } from "@/composables/useToast";
import { useCopyText } from "@/composables/useCopyText";
import { useSettingsStore } from "@/stores/settings";
import type { McpClientConfigParams, McpAgentApp } from "@shared/types/settings";
import IconLucideCopy from "~icons/lucide/copy";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const { copy } = useCopyText();
const settings = useSettingsStore();
const open = ref(false);
const opening = ref(false);
const params = ref<McpClientConfigParams>({
  port: settings.system.mcp.port,
  accessKey: "********************************",
});
const agents = ref<McpAgentApp[]>([]);
const injecting = ref<Record<string, boolean>>({});

const clientConfig = computed(() =>
  JSON.stringify(
    {
      mcpServers: {
        "splayer-next": {
          type: "http",
          url: `http://127.0.0.1:${params.value.port}/mcp`,
          headers: { "X-MCP-Key": params.value.accessKey },
        },
      },
    },
    null,
    2,
  ),
);

/** 加载配置后打开弹窗，避免异步内容改变进入动画期间的高度 */
const handleOpen = async (): Promise<void> => {
  if (opening.value) return;
  opening.value = true;
  try {
    const [nextParams, nextAgents] = await Promise.all([
      window.api.mcp.getClientConfigParams(),
      window.api.mcp.detectAgents(),
    ]);
    params.value = nextParams;
    agents.value = nextAgents;
    open.value = true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    opening.value = false;
  }
};

const handleInject = async (agent: McpAgentApp) => {
  if (agent.configured || !agent.injectable) return;
  injecting.value[agent.id] = true;
  try {
    await window.api.mcp.injectAgentConfig(agent.id, toRaw(params.value));
    agent.configured = true;
    toast.success(t("settings.mcp.injectSuccess"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    injecting.value[agent.id] = false;
  }
};
</script>

<template>
  <SButton type="primary" variant="secondary" size="small" :loading="opening" @click="handleOpen">
    {{ t("common.configure") }}
  </SButton>

  <SDialog v-model:open="open" :title="t('settings.mcpConfigDetails.label')" width="600px">
    <div class="flex flex-col gap-3">
      <div class="relative rounded-lg bg-on-surface/5 overflow-hidden">
        <pre
          class="m-0 px-4 py-3.5 pr-14 overflow-x-auto font-sans text-sm leading-6 text-on-surface-variant tabular-nums"
          >{{ clientConfig }}</pre>
        <SButton class="absolute right-2 top-2" variant="ghost" circle @click="copy(clientConfig)">
          <template #icon><IconLucideCopy /></template>
        </SButton>
      </div>

      <div v-if="agents.length > 0" class="mt-2 flex flex-col gap-2.5 pb-2">
        <p class="font-medium">
          {{ t("settings.mcp.detectHint") }}
        </p>
        <SCard
          v-for="agent in agents"
          :key="agent.id"
          variant="settings"
          size="small"
          class="flex items-center gap-3 pr-2.5"
        >
          <SImg
            class="size-8 shrink-0 rounded-md"
            :src="`./images/ai/${agent.id === 'claudedesktop' ? 'claudecode' : agent.id}.webp`"
            :alt="agent.name"
          />
          <div class="flex-1 min-w-0 flex flex-col">
            <span class="text-sm text-on-surface font-medium truncate">{{ agent.name }}</span>
            <span class="text-xs text-on-surface-variant/70 truncate" :title="agent.configPath">
              {{ agent.configPath }}
            </span>
          </div>
          <SButton
            size="small"
            variant="secondary"
            :type="agent.configured ? 'default' : 'primary'"
            :disabled="agent.configured || !agent.injectable"
            :loading="injecting[agent.id]"
            @click="handleInject(agent)"
          >
            {{
              !agent.injectable
                ? t("settings.mcp.notSupported")
                : agent.configured
                  ? t("settings.mcp.injected")
                  : t("settings.mcp.inject")
            }}
          </SButton>
        </SCard>
      </div>
    </div>

    <template #footer="{ close }">
      <SButton type="primary" @click="close">{{ t("common.close") }}</SButton>
    </template>
  </SDialog>
</template>
