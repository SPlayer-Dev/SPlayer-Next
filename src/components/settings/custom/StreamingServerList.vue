<script setup lang="ts">
import type {
  StreamingPingResult,
  StreamingServerConfig,
  StreamingServerInput,
  StreamingServerType,
} from "@shared/types/streaming";
import { useStreamingStore } from "@/stores/streaming";
import { toast } from "@/composables/useToast";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const streaming = useStreamingStore();
const { servers, activeServerId } = storeToRefs(streaming);

const TYPE_OPTIONS: { value: StreamingServerType; label: string }[] = [
  { value: "navidrome", label: "Navidrome" },
  { value: "jellyfin", label: "Jellyfin" },
  { value: "emby", label: "Emby" },
  { value: "opensubsonic", label: "OpenSubsonic" },
  { value: "airsonic", label: "Airsonic" },
  { value: "gonic", label: "Gonic" },
  { value: "lms", label: "LMS" },
  { value: "subsonic", label: "Subsonic" },
];

/** 表单 / 编辑状态 */
const dialogOpen = ref(false);
const editingId = ref<string | null>(null);

const EMPTY_FORM: StreamingServerInput = {
  name: "",
  type: "navidrome",
  url: "",
  username: "",
  password: "",
};
const form = ref<StreamingServerInput>({ ...EMPTY_FORM });

const submitting = ref(false);
const testing = ref(false);
const testResult = ref<StreamingPingResult | null>(null);
const formError = ref<string | null>(null);

/** 删除确认 */
const confirmOpen = ref(false);
const pendingRemoveId = ref<string | null>(null);
const pendingRemoveName = computed(
  () => servers.value.find((s) => s.id === pendingRemoveId.value)?.name ?? "",
);

/** 切换激活服务器的 loading */
const switchingId = ref<string | null>(null);

const openAdd = (): void => {
  editingId.value = null;
  form.value = { ...EMPTY_FORM };
  testResult.value = null;
  formError.value = null;
  dialogOpen.value = true;
};

const openEdit = (cfg: StreamingServerConfig): void => {
  editingId.value = cfg.id;
  testResult.value = null;
  formError.value = null;
  form.value = {
    name: cfg.name,
    type: cfg.type,
    url: cfg.url,
    username: cfg.username,
    password: "",
  };
  dialogOpen.value = true;
};

/**
 * 表单通用验证
 * @param inputData - 填写的表单数据
 * @returns 错误信息，若通过验证则返回 null
 */
const validate = (inputData: StreamingServerInput): string | null => {
  if (!inputData.name.trim()) return t("streaming.server.errors.nameEmpty");
  if (!/^https?:\/\//i.test(inputData.url.trim())) return t("streaming.server.errors.urlInvalid");

  if (!inputData.username) return t("streaming.server.errors.usernameEmpty");
  const editingServer = servers.value.find((server) => server.id === editingId.value);
  if (!inputData.password && !editingServer?.hasPassword) {
    return t("streaming.server.errors.passwordEmpty");
  }
  return null;
};

/**
 * 测试服务器连通性
 * @param inputData - 当前表单数据
 */
const handleTest = async (inputData: StreamingServerInput): Promise<void> => {
  const invalid = validate(inputData);
  if (invalid) {
    formError.value = invalid;
    return;
  }
  formError.value = null;
  testing.value = true;
  try {
    const res = await streaming.testConnection(inputData, editingId.value ?? undefined);
    testResult.value = res;
  } finally {
    testing.value = false;
  }
};

/**
 * 提交表单保存服务器配置
 * @param inputData - 当前表单数据
 */
const handleSubmit = async (inputData: StreamingServerInput): Promise<void> => {
  const invalid = validate(inputData);
  if (invalid) {
    formError.value = invalid;
    return;
  }
  formError.value = null;
  submitting.value = true;
  try {
    if (editingId.value) {
      await streaming.updateServer(editingId.value, inputData);
      // 编辑后如果是当前激活服务器，重新连接刷新 token
      if (activeServerId.value === editingId.value) {
        await streaming.connectToServer(editingId.value);
      }
      toast.success(t("streaming.server.updated"));
    } else {
      const cfg = await streaming.addServer(inputData);
      // 第一台服务器自动设为激活
      if (!activeServerId.value) await streaming.setActiveServer(cfg.id);
      toast.success(t("streaming.server.added"));
    }
    dialogOpen.value = false;
  } finally {
    submitting.value = false;
  }
};

const openRemoveConfirm = (id: string): void => {
  pendingRemoveId.value = id;
  confirmOpen.value = true;
};

const handleConfirmRemove = (): void => {
  const id = pendingRemoveId.value;
  confirmOpen.value = false;
  pendingRemoveId.value = null;
  if (!id) return;
  void streaming.removeServer(id);
  toast.success(t("streaming.server.removed"));
};

const handleConnect = async (cfg: StreamingServerConfig): Promise<void> => {
  switchingId.value = cfg.id;
  try {
    await streaming.setActiveServer(cfg.id);
    if (streaming.connectionStatus.connected) {
      toast.success(t("streaming.server.connected"));
    } else {
      const err = streaming.connectionStatus.error ?? t("streaming.server.connectFailed");
      toast.error(err);
    }
  } finally {
    switchingId.value = null;
  }
};

const handleDisconnect = (): void => {
  streaming.disconnect();
  toast.success(t("streaming.server.disconnected"));
};

const isActive = (cfg: StreamingServerConfig): boolean => activeServerId.value === cfg.id;
const formatTime = (t?: number): string => (t ? new Date(t).toLocaleString() : "-");
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- 顶部说明 + 添加按钮 -->
    <div
      class="flex items-center justify-between gap-4 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="text-base text-on-surface">{{ t("streaming.hint") }}</div>
        <div class="text-sm text-on-surface-variant/70 mt-0.5">
          {{ t("streaming.hintDetail") }}
        </div>
      </div>
      <SButton variant="secondary" size="small" @click="openAdd">
        <template #icon>
          <IconLucidePlus class="size-4" />
        </template>
        {{ t("streaming.server.add") }}
      </SButton>
    </div>

    <!-- 空态 -->
    <div
      v-if="servers.length === 0"
      class="flex flex-col items-center gap-3 rounded-xl bg-surface-panel border border-solid border-outline-variant/15 py-10"
    >
      <div
        class="size-12 rounded-xl bg-on-surface/6 flex items-center justify-center text-on-surface-variant"
      >
        <IconLucideServer class="size-6" />
      </div>
      <div class="text-sm text-on-surface-variant">{{ t("streaming.empty.noServer") }}</div>
      <div class="text-xs text-on-surface-variant/60">{{ t("streaming.empty.addHint") }}</div>
    </div>

    <!-- 服务器列表 -->
    <ul v-else class="flex flex-col gap-2.5 list-none p-0 m-0">
      <li
        v-for="cfg in servers"
        :key="cfg.id"
        class="rounded-xl bg-surface-panel border border-solid border-outline-variant/15 px-4 py-3.5"
      >
        <div class="flex items-start gap-3">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-on-surface truncate">{{ cfg.name }}</span>
              <STag size="tiny" type="default" variant="soft">{{ cfg.type }}</STag>
              <STag
                v-if="isActive(cfg)"
                size="tiny"
                :type="streaming.isConnected ? 'success' : 'warning'"
                variant="soft"
              >
                {{
                  streaming.isConnected
                    ? t("streaming.server.active")
                    : t("streaming.server.disconnected")
                }}
              </STag>
            </div>
            <div class="mt-1.5 text-xs text-on-surface-variant/70 break-all">
              {{ cfg.username }}@{{ cfg.url }}
            </div>
            <div v-if="cfg.lastConnected" class="mt-1 text-xs text-on-surface-variant/50">
              {{ t("streaming.server.lastConnected") }}: {{ formatTime(cfg.lastConnected) }}
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-2">
            <SButton
              v-if="isActive(cfg) && streaming.isConnected"
              variant="secondary"
              size="small"
              @click="handleDisconnect"
            >
              <template #icon>
                <IconLucideUnplug class="size-4" />
              </template>
              {{ t("streaming.server.disconnect") }}
            </SButton>
            <SButton
              v-else
              variant="secondary"
              size="small"
              type="primary"
              :loading="switchingId === cfg.id"
              @click="handleConnect(cfg)"
            >
              <template #icon>
                <IconLucidePlugZap class="size-4" />
              </template>
              {{ t("streaming.server.connect") }}
            </SButton>
            <SButton variant="secondary" size="small" @click="openEdit(cfg)">
              <template #icon>
                <IconLucideEdit class="size-4" />
              </template>
              {{ t("common.edit") }}
            </SButton>
            <SButton
              variant="secondary"
              size="small"
              type="error"
              @click="openRemoveConfirm(cfg.id)"
            >
              <template #icon>
                <IconLucideTrash class="size-4" />
              </template>
              {{ t("common.delete") }}
            </SButton>
          </div>
        </div>
      </li>
    </ul>

    <!-- 添加 / 编辑弹窗 -->
    <SDialog
      v-model:open="dialogOpen"
      :title="editingId ? t('streaming.server.edit') : t('streaming.server.add')"
      width="520px"
    >
      <div class="flex flex-col gap-3">
        <SFormItem :label="t('streaming.server.type')">
          <SSelect v-model="form.type" :options="TYPE_OPTIONS" />
        </SFormItem>
        <SFormItem :label="t('streaming.server.name')">
          <SInput v-model="form.name" :placeholder="t('streaming.server.namePlaceholder')" />
        </SFormItem>
        <SFormItem :label="t('streaming.server.url')">
          <SInput v-model="form.url" placeholder="https://music.example.com" spellcheck="false" />
        </SFormItem>
        <SFormItem :label="t('streaming.server.username')">
          <SInput v-model="form.username" autocomplete="off" />
        </SFormItem>
        <SFormItem :label="t('streaming.server.password')">
          <SInput v-model="form.password" type="password" autocomplete="new-password" />
        </SFormItem>

        <!-- 测试结果展示 -->
        <div
          v-if="formError"
          class="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500 break-all"
        >
          {{ formError }}
        </div>
        <div
          v-if="testResult"
          class="rounded-md px-3 py-2 text-xs break-all"
          :class="testResult.ok ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'"
        >
          <div class="flex items-center gap-2">
            <IconLucideCheck v-if="testResult.ok" class="size-3.5" />
            <span>
              {{ testResult.ok ? t("streaming.server.testOk") : t("streaming.server.testFail") }}
            </span>
            <span v-if="testResult.version" class="opacity-70">
              <template v-if="/^[0-9]/.test(testResult.version)">v</template>
              {{ testResult.version }}
            </span>
          </div>
          <div v-if="testResult.error" class="mt-1 opacity-80">{{ testResult.error }}</div>
        </div>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="submitting || testing" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton
          variant="secondary"
          :loading="testing"
          :disabled="submitting"
          @click="handleTest(form)"
        >
          {{ t("streaming.server.test") }}
        </SButton>
        <SButton
          variant="secondary"
          type="primary"
          :loading="submitting"
          :disabled="testing"
          @click="handleSubmit(form)"
        >
          {{ t("common.save") }}
        </SButton>
      </template>
    </SDialog>

    <!-- 删除确认 -->
    <SDialog
      v-model:open="confirmOpen"
      :title="t('streaming.server.deleteConfirmTitle')"
      width="400px"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("streaming.server.deleteConfirm", { name: pendingRemoveName }) }}
      </p>
      <template #footer="{ close }">
        <SButton variant="secondary" @click="close">{{ t("common.cancel") }}</SButton>
        <SButton variant="secondary" type="error" @click="handleConfirmRemove">
          {{ t("common.confirm") }}
        </SButton>
      </template>
    </SDialog>
  </div>
</template>
