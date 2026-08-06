<script setup lang="ts">
import type { AiModelConfig, AiModelProtocol, AiModelSaveInput } from "@shared/types/ai";
import { toast } from "@/composables/useToast";
import IconLucideBot from "~icons/lucide/bot";
import IconLucidePlus from "~icons/lucide/plus";
import IconLucideEdit from "~icons/lucide/pencil";
import IconLucideTrash from "~icons/lucide/trash-2";
import IconLucideCheck from "~icons/lucide/check";

defineOptions({ inheritAttrs: false });

const { t } = useI18n();
const models = ref<AiModelConfig[]>([]);
const activeModelId = ref<string | null>(null);
const loading = ref(true);
const saving = ref(false);
const switchingId = ref<string | null>(null);

const dialogOpen = ref(false);
const editingId = ref<string | null>(null);
const formError = ref<string | null>(null);
const EMPTY_FORM: AiModelSaveInput = {
  name: "",
  protocol: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
};
const form = ref<AiModelSaveInput>({ ...EMPTY_FORM });

const confirmOpen = ref(false);
const pendingRemoveId = ref<string | null>(null);
const pendingRemoveName = computed(
  () => models.value.find((model) => model.id === pendingRemoveId.value)?.name ?? "",
);

const protocolOptions: { value: AiModelProtocol; label: string }[] = [
  { value: "openai-compatible", label: "OpenAI Compatible" },
  { value: "anthropic", label: "Anthropic" },
];

const protocolLabels: Record<AiModelProtocol, string> = {
  "openai-compatible": "OpenAI Compatible",
  anthropic: "Anthropic",
};

const handleProtocolChange = (protocol: AiModelProtocol): void => {
  const previousDefault =
    form.value.protocol === "anthropic"
      ? "https://api.anthropic.com/v1"
      : "https://api.openai.com/v1";
  form.value.protocol = protocol;
  if (form.value.baseUrl === previousDefault) {
    form.value.baseUrl =
      protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1";
  }
};

const applyState = (state: Awaited<ReturnType<typeof window.api.aiModel.list>>): void => {
  models.value = state.models;
  activeModelId.value = state.activeModelId;
};

const load = async (): Promise<void> => {
  loading.value = true;
  try {
    applyState(await window.api.aiModel.list());
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
};

const openAdd = (): void => {
  editingId.value = null;
  form.value = { ...EMPTY_FORM };
  formError.value = null;
  dialogOpen.value = true;
};

const openEdit = (model: AiModelConfig): void => {
  editingId.value = model.id;
  form.value = {
    id: model.id,
    name: model.name,
    protocol: model.protocol,
    baseUrl: model.baseUrl,
    model: model.model,
    apiKey: "",
  };
  formError.value = null;
  dialogOpen.value = true;
};

const validate = (): string | null => {
  if (!form.value.name.trim()) return t("settings.aiModel.errors.nameEmpty");
  if (!/^https?:\/\//i.test(form.value.baseUrl.trim())) {
    return t("settings.aiModel.errors.urlInvalid");
  }
  if (!form.value.model.trim()) return t("settings.aiModel.errors.modelEmpty");
  if (!editingId.value && !form.value.apiKey?.trim()) {
    return t("settings.aiModel.errors.apiKeyEmpty");
  }
  return null;
};

const handleSubmit = async (): Promise<void> => {
  const invalid = validate();
  if (invalid) {
    formError.value = invalid;
    return;
  }
  saving.value = true;
  formError.value = null;
  try {
    applyState(await window.api.aiModel.save(toRaw(form.value)));
    toast.success(t(editingId.value ? "settings.aiModel.updated" : "settings.aiModel.added"));
    dialogOpen.value = false;
  } catch (error) {
    formError.value = error instanceof Error ? error.message : String(error);
  } finally {
    saving.value = false;
  }
};

const handleActivate = async (id: string): Promise<void> => {
  if (activeModelId.value === id || switchingId.value) return;
  switchingId.value = id;
  try {
    applyState(await window.api.aiModel.setActive(id));
    toast.success(t("settings.aiModel.activated"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  } finally {
    switchingId.value = null;
  }
};

const openRemoveConfirm = (id: string): void => {
  pendingRemoveId.value = id;
  confirmOpen.value = true;
};

const handleConfirmRemove = async (): Promise<void> => {
  const id = pendingRemoveId.value;
  confirmOpen.value = false;
  pendingRemoveId.value = null;
  if (!id) return;
  try {
    applyState(await window.api.aiModel.remove(id));
    toast.success(t("settings.aiModel.removed"));
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
};

onMounted(load);
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      class="flex items-center justify-between gap-4 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <div class="text-sm text-on-surface">{{ t("settings.aiModel.hint") }}</div>
        <div class="mt-0.5 text-xs text-on-surface-variant/60">
          {{ t("settings.aiModel.hintDetail") }}
        </div>
      </div>
      <SButton variant="secondary" size="small" @click="openAdd">
        <template #icon><IconLucidePlus class="size-4" /></template>
        {{ t("settings.aiModel.add") }}
      </SButton>
    </div>

    <div
      v-if="!loading && models.length === 0"
      class="flex flex-col items-center gap-3 rounded-xl border border-solid border-outline-variant/15 bg-surface-panel py-10"
    >
      <div
        class="flex size-12 items-center justify-center rounded-xl bg-on-surface/6 text-on-surface-variant"
      >
        <IconLucideBot class="size-6" />
      </div>
      <div class="text-sm text-on-surface-variant">{{ t("settings.aiModel.empty") }}</div>
      <div class="text-xs text-on-surface-variant/60">{{ t("settings.aiModel.emptyHint") }}</div>
    </div>

    <ul v-else-if="models.length" class="m-0 flex list-none flex-col gap-2.5 p-0">
      <li
        v-for="item in models"
        :key="item.id"
        class="rounded-xl border border-solid border-outline-variant/15 bg-surface-panel px-4 py-3.5"
      >
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="truncate text-sm font-medium text-on-surface">{{ item.name }}</span>
              <STag size="tiny" type="default" variant="soft">
                {{ protocolLabels[item.protocol] }}
              </STag>
              <STag v-if="activeModelId === item.id" size="tiny" type="success" variant="soft">
                {{ t("common.active") }}
              </STag>
            </div>
            <div class="mt-1.5 break-all text-xs text-on-surface-variant/70">
              {{ item.model }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <SButton
              v-if="activeModelId !== item.id"
              variant="secondary"
              size="small"
              type="primary"
              :loading="switchingId === item.id"
              :disabled="switchingId !== null"
              @click="handleActivate(item.id)"
            >
              <template #icon><IconLucideCheck class="size-4" /></template>
              {{ t("common.enable") }}
            </SButton>
            <SButton v-else variant="secondary" size="small" type="primary" disabled>
              <template #icon><IconLucideCheck class="size-4" /></template>
              {{ t("common.active") }}
            </SButton>
            <SButton variant="secondary" size="small" @click="openEdit(item)">
              <template #icon><IconLucideEdit class="size-4" /></template>
              {{ t("common.edit") }}
            </SButton>
            <SButton
              variant="secondary"
              size="small"
              type="error"
              @click="openRemoveConfirm(item.id)"
            >
              <template #icon><IconLucideTrash class="size-4" /></template>
              {{ t("common.delete") }}
            </SButton>
          </div>
        </div>
      </li>
    </ul>

    <SDialog
      v-model:open="dialogOpen"
      :title="t(editingId ? 'settings.aiModel.editModel' : 'settings.aiModel.add')"
      width="520px"
    >
      <div class="flex flex-col gap-3">
        <SFormItem :label="t('settings.aiModel.protocol')">
          <SSelect
            :model-value="form.protocol"
            :options="protocolOptions"
            @update:model-value="handleProtocolChange($event as AiModelProtocol)"
          />
        </SFormItem>
        <SFormItem :label="t('settings.aiModel.name')">
          <SInput v-model="form.name" :placeholder="t('settings.aiModel.namePlaceholder')" />
        </SFormItem>
        <SFormItem :label="t('settings.aiModel.baseUrl')">
          <SInput
            v-model="form.baseUrl"
            placeholder="https://api.openai.com/v1"
            spellcheck="false"
          />
        </SFormItem>
        <SFormItem :label="t('settings.aiModel.apiKey')">
          <SInput
            v-model="form.apiKey"
            type="password"
            autocomplete="new-password"
            :placeholder="
              editingId
                ? t('settings.aiModel.apiKeySavedPlaceholder')
                : t('settings.aiModel.apiKeyPlaceholder')
            "
          />
        </SFormItem>
        <SFormItem :label="t('settings.aiModel.model')">
          <SInput
            v-model="form.model"
            :placeholder="form.protocol === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-5.6'"
            spellcheck="false"
          />
        </SFormItem>
        <div
          v-if="formError"
          class="break-all rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-500"
        >
          {{ formError }}
        </div>
      </div>
      <template #footer="{ close }">
        <SButton variant="secondary" :disabled="saving" @click="close">
          {{ t("common.cancel") }}
        </SButton>
        <SButton variant="secondary" type="primary" :loading="saving" @click="handleSubmit">
          {{ t("common.save") }}
        </SButton>
      </template>
    </SDialog>

    <SDialog
      v-model:open="confirmOpen"
      :title="t('settings.aiModel.deleteConfirmTitle')"
      width="400px"
    >
      <p class="text-sm text-on-surface-variant">
        {{ t("settings.aiModel.deleteConfirm", { name: pendingRemoveName }) }}
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
