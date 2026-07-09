<script setup lang="ts">
import type { DropdownMenuItem } from "@/components/ui/SDropdownMenu.vue";
import { useCopyText } from "@/composables/useCopyText";
import IconLucideCopy from "~icons/lucide/copy";
import IconLucideClipboardPaste from "~icons/lucide/clipboard-paste";
import IconLucideSearch from "~icons/lucide/search";

const props = defineProps<{
  /** 输入值 */
  modelValue: string;
  /** 占位文案 */
  placeholder: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  keydown: [event: KeyboardEvent];
  search: [value: string];
}>();

const { t } = useI18n();
const { copy } = useCopyText();

type SearchInputMenuKey = "copy" | "paste" | "pasteSearch";

/** 右键时的输入选区 */
const inputSelection = ref({ start: 0, end: 0 });
/** 触发右键菜单的输入框 */
const inputEl = ref<HTMLInputElement | null>(null);

const selectedText = computed(() =>
  props.modelValue.slice(inputSelection.value.start, inputSelection.value.end),
);

const menuItems = computed<DropdownMenuItem[]>(() => [
  {
    key: "copy",
    label: t("nav.searchMenu.copy"),
    icon: markRaw(IconLucideCopy),
    disabled: selectedText.value.length === 0,
  },
  {
    key: "paste",
    label: t("nav.searchMenu.paste"),
    icon: markRaw(IconLucideClipboardPaste),
  },
  {
    key: "pasteSearch",
    label: t("nav.searchMenu.pasteSearch"),
    icon: markRaw(IconLucideSearch),
  },
]);

const readClipboardText = async (): Promise<string> => {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return "";
  }
};

/**
 * 把文本插入当前输入选区
 * @param text - 剪贴板文本
 * @param restoreFocus - 是否恢复输入焦点
 * @returns 插入后的完整输入值
 */
const applyPaste = (text: string, restoreFocus = true): string => {
  const { start, end } = inputSelection.value;
  const value = props.modelValue;
  const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
  emit("update:modelValue", next);
  if (!restoreFocus) return next;
  nextTick(() => {
    const caret = start + text.length;
    inputEl.value?.focus();
    inputEl.value?.setSelectionRange(caret, caret);
  });
  return next;
};

const onContextMenu = (event: MouseEvent): void => {
  const target =
    event.target instanceof HTMLInputElement
      ? event.target
      : event.currentTarget instanceof HTMLElement
        ? event.currentTarget.querySelector("input")
        : null;
  if (!target) return;
  inputEl.value = target;
  inputSelection.value = {
    start: target.selectionStart ?? 0,
    end: target.selectionEnd ?? 0,
  };
};

const onMenuSelect = async (key: string): Promise<void> => {
  switch (key as SearchInputMenuKey) {
    case "copy":
      await copy(selectedText.value);
      break;
    case "paste": {
      const text = await readClipboardText();
      if (text) applyPaste(text);
      break;
    }
    case "pasteSearch": {
      const text = await readClipboardText();
      if (!text) return;
      emit("search", applyPaste(text, false));
      break;
    }
  }
};
</script>

<template>
  <SContextMenu :items="menuItems" @select="onMenuSelect">
    <SInput
      :model-value="modelValue"
      :placeholder="placeholder"
      size="large"
      clearable
      @update:model-value="emit('update:modelValue', $event)"
      @contextmenu="onContextMenu"
      @keydown="emit('keydown', $event)"
    >
      <template #prefix>
        <IconLucideSearch class="size-4 text-on-surface-variant/50 shrink-0" />
      </template>
    </SInput>
  </SContextMenu>
</template>
