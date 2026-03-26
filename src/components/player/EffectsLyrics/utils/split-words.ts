import type { LyricWord } from "@/types/lyric";

const CJK_RE = /^[\p{Unified_Ideograph}\u0800-\u9FFC]+$/u;

/**
 * 判断字符串是否全部为 CJK（中日韩统一表意文字）
 */
export const isCJK = (char: string): boolean => CJK_RE.test(char);

const hasSegmenter =
	typeof Intl !== "undefined" && typeof Intl.Segmenter !== "undefined";

/**
 * 根据时间比例创建一个歌词原子
 * @param word - 文字内容
 * @param romanWord - 罗马音/拼音
 * @param obscene - 是否为脏话
 * @param startTime - 起始时间
 * @param endTime - 结束时间
 */
const makeAtom = (
	word: string,
	romanWord: string,
	obscene: boolean,
	startTime: number,
	endTime: number,
): LyricWord => ({ word, romanWord, startTime, endTime, obscene });

/**
 * 将歌词单词列表重新分组：CJK 字符逐字拆分，并通过 Intl.Segmenter 进行多语言分词。
 *
 * 处理流程：
 * 1. 按空格拆分每个单词，CJK 多字词再逐字拆开，按比例分配时间
 * 2. 若浏览器支持 Intl.Segmenter，将原子按词边界重新分组
 *
 * @param words - 原始歌词单词数组
 * @returns 分组后的单词/单词组数组，单元素为 LyricWord，多元素组为 LyricWord[]
 */
export const chunkAndSplitLyricWords = (
	words: LyricWord[],
): (LyricWord | LyricWord[])[] => {
	const atoms: LyricWord[] = [];

	for (const w of words) {
		const content = w.word.trim();
		const romanWord = w.romanWord ?? "";
		const obscene = w.obscene ?? false;

		// 空白或含 ruby 注音的单词直接保留
		if (content.length === 0 || (w.ruby?.length ?? 0) > 0) {
			atoms.push({ ...w });
			continue;
		}

		const parts = w.word.split(/(\s+)/).filter((p) => p.length > 0);
		const totalLen = w.word.replace(/\s/g, "").length || 1;
		const duration = w.endTime - w.startTime;
		let offset = 0;

		for (const part of parts) {
			if (!part.trim()) {
				const t = w.startTime + (offset / totalLen) * duration;
				atoms.push(makeAtom(part, "", obscene, t, t));
				continue;
			}

			if (isCJK(part) && part.length > 1 && romanWord.trim().length === 0) {
				// CJK 多字词逐字拆分，均分时间
				const charDur = duration / totalLen;
				for (const char of part) {
					const t = w.startTime + (offset / totalLen) * duration;
					atoms.push(makeAtom(char, "", obscene, t, t + charDur));
					offset++;
				}
			} else {
				const t = w.startTime + (offset / totalLen) * duration;
				const partDur = (part.length / totalLen) * duration;
				atoms.push(makeAtom(part, romanWord, obscene, t, t + partDur));
				offset += part.length;
			}
		}
	}

	if (!hasSegmenter) return atoms;

	// 利用 Intl.Segmenter 按词边界重新分组
	const fullText = atoms.map((a) => a.word).join("");
	const segments = new Intl.Segmenter(undefined, { granularity: "word" });
	const result: (LyricWord | LyricWord[])[] = [];
	let atomIdx = 0;
	let actual = 0;
	let expected = 0;
	let group: LyricWord[] = [];

	for (const seg of segments.segment(fullText)) {
		expected += seg.segment.length;

		while (actual < expected && atomIdx < atoms.length) {
			const atom = atoms[atomIdx++];
			group.push(atom);
			actual += atom.word.length;
		}

		if (actual === expected) {
			// 将前导空白从分组中提出
			while (group.length > 1 && !group[0].word.trim()) {
				result.push(group.shift()!);
			}
			result.push(group.length === 1 ? group[0] : group);
			group = [];
		}
	}

	// 处理剩余原子
	while (atomIdx < atoms.length) {
		result.push(atoms[atomIdx++]);
	}
	if (group.length > 0) {
		result.push(group.length === 1 ? group[0] : group);
	}

	return result;
};

/** 匹配字母或数字字符（Unicode 全语言支持） */
const LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

/**
 * 判断两个相邻文本之间是否需要插入空格
 *
 * CJK 字符之间不需要空格，非 CJK 的字母/数字之间需要空格。
 *
 * @param prevText - 前一个文本
 * @param nextText - 后一个文本
 * @returns 是否需要空格
 */
export const needsSpaceBetween = (prevText: string, nextText: string): boolean => {
	if (!prevText || !nextText) return false;
	const lastChar = prevText[prevText.length - 1];
	const firstChar = nextText[0];
	if (isCJK(lastChar) || isCJK(firstChar)) return false;
	return LETTER_OR_DIGIT_RE.test(lastChar) && LETTER_OR_DIGIT_RE.test(firstChar);
};
