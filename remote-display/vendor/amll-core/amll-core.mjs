import { sampleMask } from "./mask-runtime.mjs";
import { t as __exportAll } from "./rolldown-runtime-D7D4PA-g.mjs";
import structuredClone from "@ungap/structured-clone";
import bezier from "bezier-easing";
//#region src/utils/clamp.ts
function clamp(x, min, max) {
	return Math.min(Math.max(x, min), max);
}
function clamp01(x) {
	return clamp(x, 0, 1);
}
function clampPositive(x) {
	return Math.max(0, x);
}

//#region src/utils/time.ts
const toD = (ms) => ms;
const toM = (ms) => ms;
const toNum = (t) => t;
const Duration = {
	ZERO: toD(0),
	fromMillis: (ms) => toD(ms),
	fromSecs: (s) => toD(s * 1e3),
	asMillis: (d) => toNum(d),
	asSecsF64: (d) => toNum(d) / 1e3,
	add: (a, b) => toD(toNum(a) + toNum(b)),
	sub: (a, b) => toD(toNum(a) - toNum(b)),
	saturatingSub: (a, b) => toD(Math.max(0, toNum(a) - toNum(b))),
	mulF64: (d, factor) => toD(toNum(d) * factor),
	divDuration: (a, b) => toNum(a) / toNum(b),
	min: (a, b) => a < b ? a : b,
	max: (a, b) => a > b ? a : b,
	clampPositive: (d) => toD(Math.max(0, toNum(d))),
	isZero: (d) => toNum(d) === 0,
	isFinite: (d) => Number.isFinite(toNum(d))
};
const MediaTime = {
	ZERO: toM(0),
	fromMillis: (ms) => toM(ms),
	asMillis: (t) => toNum(t),
	since: (a, b) => toD(toNum(a) - toNum(b)),
	saturatingSince: (a, b) => toD(Math.max(0, toNum(a) - toNum(b))),
	add: (t, d) => toM(toNum(t) + toNum(d)),
	sub: (t, d) => toM(toNum(t) - toNum(d)),
	min: (a, b) => a < b ? a : b,
	max: (a, b) => a > b ? a : b,
	cmp: (a, b) => toNum(a) - toNum(b),
	round: (t) => toM(Math.round(toNum(t)))
};
//#endregion
//#region src/lyric-player/base/consts.ts
/** 歌词中不雅用语的掩码模式 */
const MaskObsceneWordsMode = {
	/** 禁用任何不雅用语掩码 */
	Disabled: "",
	/** 完全掩码所有不雅用语 */
	FullMask: "full-mask",
	/** 保留首尾字符，屏蔽中间字符 */
	PartialMask: "partial-mask"
};
/**
* 歌词行的渲染模式
* @internal
*/
const LyricLineRenderMode = {
	SOLID: 0,
	GRADIENT: 1
};
/** 布局对齐锚点 */
const LayoutAlignAnchor = {
	Top: "top",
	Center: "center",
	Bottom: "bottom"
};
/**
* 触发排版布局更新的原因场景
*/
const LayoutReason = {
	/** 正常播放时间推进 */
	PlaybackTick: "playback-tick",
	/** 容器或窗口尺寸调整 */
	Resize: "resize",
	/** 用户交互挂起开始（触摸/滚轮触发） */
	InteractionStart: "interaction-start",
	/** 连续高频滚动（手指触摸滑动或松手后的 RAF 惯性滑动） */
	ContinuousScroll: "continuous-scroll",
	/** 离散单步滚动（鼠标滚轮单次滚动） */
	DiscreteScroll: "discrete-scroll",
	/** 跳转播放进度 */
	Seek: "seek",
	/** 重新构建歌词视图 */
	RebuildView: "rebuild-view",
	/** 视图结构或样式配置改变 */
	ConfigChange: "config-change"
};
/**
* 排版原因到排版执行策略的映射字典
*/
const LayoutReasonStrategyMap = {
	[LayoutReason.PlaybackTick]: {
		disableStagger: false,
		resetInterlude: false,
		snapPosY: false
	},
	[LayoutReason.ContinuousScroll]: {
		disableStagger: true,
		resetInterlude: false,
		snapPosY: true
	},
	[LayoutReason.DiscreteScroll]: {
		disableStagger: true,
		resetInterlude: false,
		snapPosY: false
	},
	[LayoutReason.InteractionStart]: {
		disableStagger: true,
		resetInterlude: false,
		snapPosY: false
	},
	[LayoutReason.Seek]: {
		disableStagger: true,
		resetInterlude: true,
		snapPosY: false
	},
	[LayoutReason.RebuildView]: {
		disableStagger: true,
		resetInterlude: true,
		snapPosY: false
	},
	[LayoutReason.Resize]: {
		disableStagger: true,
		resetInterlude: false,
		snapPosY: false
	},
	[LayoutReason.ConfigChange]: {
		disableStagger: true,
		resetInterlude: false,
		snapPosY: false
	}
};
/**
* 单帧动画时长的钳制上限，用于页面挂起等场景
*
* 此时首帧 update 的 delta 携带整个挂起时长，直接透传会导致动画以数秒的时长过冲
*/
const MAX_FRAME_DELTA = Duration.fromMillis(100);
//#endregion
//#region src/styles/lyric-player.module.css
var lyric_player_module_default = {
	"active": "FmKaba_active",
	"bgWrapper": "FmKaba_bgWrapper",
	"bgWrapperActive": "FmKaba_bgWrapperActive",
	"bgWrapperHidden": "FmKaba_bgWrapperHidden",
	"bgWrapperTop": "FmKaba_bgWrapperTop",
	"bottomLine": "FmKaba_bottomLine",
	"bottomLineWrapper": "FmKaba_bottomLineWrapper",
	"disableSpring": "FmKaba_disableSpring",
	"emphasize": "FmKaba_emphasize",
	"emphasizeWrapper": "FmKaba_emphasizeWrapper",
	"gradientMask": "FmKaba_gradientMask",
	"hasDuetLine": "FmKaba_hasDuetLine",
	"interludeDots": "FmKaba_interludeDots",
	"isDuetWrapper": "FmKaba_isDuetWrapper",
	"lyricBgLine": "FmKaba_lyricBgLine",
	"lyricDuetLine": "FmKaba_lyricDuetLine",
	"lyricLine": "FmKaba_lyricLine",
	"lyricLineWrapper": "FmKaba_lyricLineWrapper",
	"lyricMainLine": "FmKaba_lyricMainLine",
	"lyricSubLine": "FmKaba_lyricSubLine",
	"playing": "FmKaba_playing",
	"romanWord": "FmKaba_romanWord",
	"rubyBaseWord": "FmKaba_rubyBaseWord",
	"rubyWord": "FmKaba_rubyWord",
	"tmpDisableTransition": "FmKaba_tmpDisableTransition",
	"wordBody": "FmKaba_wordBody",
	"wordWithRuby": "FmKaba_wordWithRuby"
};
//#endregion
//#region src/utils/optimize-lyric.ts
const DEFAULT_OPTIMIZE_OPTIONS = {
	normalizeSpaces: true,
	resetLineTimestamps: true,
	syncMainAndBackgroundLines: true,
	cleanUnintentionalOverlaps: true,
	tryAdvanceStartTime: true
};
/**
* 规范化歌词中的空格，将多个连续空格替换为一个空格
*/
function normalizeSpaces(lines) {
	for (const line of lines) for (const word of line.words) word.word = word.word.replace(/\s+/g, " ");
}
/**
* 将行级时间戳强行设为字级时间戳
*/
function resetLineTimestamps(lines) {
	for (const line of lines) if (line.words.length === 1 && line.words[0].startTime === 0 && line.words[0].endTime === 0 && (line.startTime !== 0 || line.endTime !== 0)) {
		line.words[0].startTime = line.startTime;
		line.words[0].endTime = line.endTime;
	} else if (line.words.length > 0) {
		const firstWord = line.words[0];
		const lastWord = line.words[line.words.length - 1];
		line.startTime = firstWord.startTime;
		line.endTime = lastWord.endTime;
	}
}
/**
* 确保背景人声前存在主歌词，并把多行背景人声转换为单行背景人声 + 主歌词行的形式
*/
function convertExcessiveBackgroundLines(lines) {
	let consecutiveBgCount = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.isBG) {
			consecutiveBgCount++;
			if (i === 0 || consecutiveBgCount > 1) line.isBG = false;
		} else consecutiveBgCount = 0;
	}
}
/**
* 同步主歌词与背景人声的时间
*
* 取两者中最早的开始时间和最晚的结束时间，应用给双方
*/
function syncMainAndBackgroundLines(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i];
		if (line.isBG) continue;
		const nextLine = lines[i + 1];
		if (nextLine?.isBG) {
			const allWords = [...line.words, ...nextLine.words].filter((w) => w.word.trim().length > 0);
			const finalStart = Math.min(line.startTime, nextLine.startTime, ...allWords.map((w) => w.startTime));
			const finalEnd = Math.max(line.endTime, nextLine.endTime, ...allWords.map((w) => w.endTime));
			line.startTime = finalStart;
			line.endTime = finalEnd;
			nextLine.startTime = finalStart;
			nextLine.endTime = finalEnd;
		}
	}
}
/**
* 按主歌词的开始时间稳定排序，并保持主歌词与其背景人声的相对顺序
*/
function sortLyricLines(lines) {
	const groups = [];
	for (let i = 0; i < lines.length; i++) {
		const mainLine = lines[i];
		const groupLines = [mainLine];
		if (!mainLine.isBG && lines[i + 1]?.isBG) groupLines.push(lines[++i]);
		groups.push({
			lines: groupLines,
			startTime: mainLine.startTime,
			originalIndex: groups.length
		});
	}
	groups.sort((a, b) => {
		return a.startTime - b.startTime || a.originalIndex - b.originalIndex;
	});
	let lineIndex = 0;
	for (const group of groups) for (const line of group.lines) lines[lineIndex++] = line;
}
/**
* 清洗非刻意的重叠
*
* | 重叠情况                                   | 判定 |
* | :------------------------------------------ | ---- |
* | 重叠 ≥ 500ms                               | 有意 |
* | 100ms < 重叠 < 500ms 且 > 下一行时长的 10% | 有意 |
* | 重叠 ≤ 100ms 或 ≤ 下一行时长的 10%         | 无意 |
*
*/
function cleanUnintentionalOverlaps(lines, syncBackgroundLines) {
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i];
		if (line.isBG) continue;
		for (let j = i + 1; j < lines.length; j++) {
			const nextLine = lines[j];
			if (nextLine.isBG) continue;
			const overlap = line.endTime - nextLine.startTime;
			if (overlap <= 0) break;
			const percentageThreshold = (nextLine.endTime - nextLine.startTime) * .1;
			if (!(overlap >= 500 || overlap > 100 && overlap > percentageThreshold)) {
				line.endTime = nextLine.startTime;
				const attachedBgLine = lines[i + 1];
				if (syncBackgroundLines && attachedBgLine?.isBG) attachedBgLine.endTime = nextLine.startTime;
				break;
			}
		}
	}
}
/**
* 尝试让歌词提前最多 600ms 开始，如果有重叠则尝试提前 400ms，不够 400ms 的提前重叠时长的 70%
*/
function tryAdvanceStartTime(lines, syncBackgroundLines) {
	/**
	* 适用于第一行歌词或与上一行歌词存在充足间隔的提前量
	*/
	const defaultAdvanceAmount = 600;
	/**
	* 适用于与上一行存在重叠的提前量
	*/
	const fallbackAdvanceAmount = 400;
	/**
	* 与上一行重叠但重叠时长不够 400ms 时，按重叠时长提前的比率
	*/
	const fallbackAdvanceRatio = .7;
	let prevLineStartTime = 0;
	let prevLineEndTime = 0;
	let prevMainGroupStartTime = 0;
	let prevMainGroupEndTime = 0;
	let hasPrevLine = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.isBG) continue;
		const originalStartTime = line.startTime;
		const originalEndTime = line.endTime;
		let targetAdvanceAmount = 0;
		let safeBoundary = 0;
		if (hasPrevLine) {
			if (originalStartTime >= prevLineEndTime) {
				targetAdvanceAmount = defaultAdvanceAmount;
				safeBoundary = prevMainGroupEndTime;
			} else {
				const overlapDuration = prevLineEndTime - originalStartTime;
				if (overlapDuration < fallbackAdvanceAmount) targetAdvanceAmount = overlapDuration * fallbackAdvanceRatio;
				else targetAdvanceAmount = fallbackAdvanceAmount;
				safeBoundary = prevLineStartTime;
			}
		} else {
			targetAdvanceAmount = defaultAdvanceAmount;
			safeBoundary = 0;
		}
		const targetTime = line.startTime - targetAdvanceAmount;
		const newStartTime = Math.max(safeBoundary, targetTime);
		if (newStartTime < line.startTime) line.startTime = newStartTime;
		const nextLine = lines[i + 1];
		if (syncBackgroundLines && nextLine?.isBG) nextLine.startTime = line.startTime;
		if (hasPrevLine) {
			if (originalStartTime < prevMainGroupEndTime && originalEndTime > prevMainGroupStartTime) {
				prevMainGroupStartTime = Math.min(prevMainGroupStartTime, originalStartTime);
				prevMainGroupEndTime = Math.max(prevMainGroupEndTime, originalEndTime);
			} else {
				prevMainGroupStartTime = originalStartTime;
				prevMainGroupEndTime = originalEndTime;
			}
		} else {
			prevMainGroupStartTime = originalStartTime;
			prevMainGroupEndTime = originalEndTime;
		}
		prevLineStartTime = line.startTime;
		prevLineEndTime = originalEndTime;
		hasPrevLine = true;
	}
}
/**
* 浅比对两个 OptimizeLyricOptions 的属性值是否完全一致
*/
function areOptimizeOptionsEqual(a = {}, b = {}) {
	const keysA = Object.keys(a);
	const keysB = Object.keys(b);
	if (keysA.length !== keysB.length) return false;
	for (const key of keysA) if (a[key] !== b[key]) return false;
	return true;
}
/**
* 优化歌词行的展示效果
*
* 注意会直接原地修改入参，确保你已经提前深克隆了歌词行数组
* @param lines 歌词行数组
* @param options 优化的可选配置，除已弃用选项外默认全部开启
*/
function optimizeLyricLines(lines, options) {
	const config = {
		...DEFAULT_OPTIMIZE_OPTIONS,
		...options
	};
	const syncBackgroundLines = config.syncMainAndBackgroundLines ?? true;
	if (config.normalizeSpaces) normalizeSpaces(lines);
	if (config.resetLineTimestamps) resetLineTimestamps(lines);
	convertExcessiveBackgroundLines(lines);
	if (syncBackgroundLines) syncMainAndBackgroundLines(lines);
	sortLyricLines(lines);
	if (config.cleanUnintentionalOverlaps) cleanUnintentionalOverlaps(lines, syncBackgroundLines);
	if (config.tryAdvanceStartTime) tryAdvanceStartTime(lines, syncBackgroundLines);
}
//#endregion
//#region src/lyric-player/base/focus.ts
/**
* 对齐焦点状态机
*
* 持有跨帧的冻结对齐目标，并在每一帧根据时间线快照与交互状态推导出本帧排版应当对齐的焦点
*
* @remarks
* 规则为：
* - 用户滚动挂起期间冻结上一帧的焦点，不再跟随播放进度
* - 若冻结在间奏点上而间奏已经结束，则自动顺延至间奏后的第一行歌词
* - 未挂起时跟随播放状态：间奏中对齐间奏点，曲末对齐底栏或末行，其余对齐 `scrollToIndex`
* - 任何情况下产出的歌词行索引都被钳制在 `[0, lineCount - 1]` 内
*/
var FocusController = class {
	target = {
		type: "line",
		index: 0
	};
	/**
	* 推导本帧的对齐焦点，并将其记录为新的冻结目标
	* @param snapshot 当前帧的时间线快照
	* @param lineCount 当前歌词行总数
	* @param flags 播放器的交互状态
	*/
	resolve(snapshot, lineCount, flags) {
		const nextTarget = flags.isAutoAlignSuspended ? this.resolveSuspendedTarget(snapshot, lineCount, flags) : this.resolveActiveTarget(snapshot, lineCount, flags);
		this.target = nextTarget;
		return nextTarget;
	}
	/**
	* 用户滚动挂起期间的焦点解析（维持上一帧目标或在间奏结束/不可用时顺延）
	*/
	resolveSuspendedTarget(snapshot, lineCount, flags) {
		const target = this.target;
		switch (target.type) {
			case "line": return {
				type: "line",
				index: this.clampLineIndex(target.index, lineCount)
			};
			case "interlude":
				if (!(snapshot.isFocusOnInterlude && !!snapshot.activeInterlude && flags.canDisplayInterlude)) return {
					type: "line",
					index: this.clampLineIndex(target.anchorIndex + 1, lineCount)
				};
				return target;
			case "bottom": return target;
		}
	}
	/**
	* 正常播放状态下的自动焦点解析
	*/
	resolveActiveTarget(snapshot, lineCount, flags) {
		if (snapshot.isFocusOnInterlude && snapshot.activeInterlude) {
			if (!flags.canDisplayInterlude) return {
				type: "line",
				index: this.clampLineIndex(snapshot.activeInterlude.anchorLineIndex + 1, lineCount)
			};
			return {
				type: "interlude",
				anchorIndex: snapshot.activeInterlude.anchorLineIndex
			};
		}
		if (snapshot.isEndOfSong) {
			if (flags.hasBottomContent) return { type: "bottom" };
			return {
				type: "line",
				index: this.clampLineIndex(lineCount - 1, lineCount)
			};
		}
		return {
			type: "line",
			index: this.clampLineIndex(snapshot.scrollToIndex, lineCount)
		};
	}
	/**
	* 将歌词行索引钳制到当前歌词范围内
	*/
	clampLineIndex(index, lineCount) {
		if (lineCount <= 0) return 0;
		return Math.min(Math.max(0, index), lineCount - 1);
	}
	/**
	* 重置焦点至首行
	*
	* 一般在载入新歌词、重建歌词视图时调用
	*/
	reset() {
		this.target = {
			type: "line",
			index: 0
		};
	}
};
//#endregion
//#region src/lyric-player/base/layout.ts
var LayoutCalculator = class {
	/**
	* 前缀和缓存
	*
	* 长度为歌词行数 + 1
	*
	* prefixSums[i] 存储的是第 0 行到第 i-1 行的总高度，不包含间奏点
	*/
	prefixSums = /* @__PURE__ */ new Float64Array(0);
	heights = /* @__PURE__ */ new Float64Array(0);
	/**
	* 使用 Uint8Array 作为掩码，1 表示该行经历了真实测量，0 表示该行在使用 fallback 高度
	*/
	isMeasured = /* @__PURE__ */ new Uint8Array(0);
	/**
	* 渲染指令对象池
	*
	* 长度永远只会增加不会减少，避免 GC
	*/
	instructionPool = [];
	isPrefixSumDirty = true;
	resolvedMetrics = {
		isValid: false,
		focalTopY: 0,
		anchorOffset: 0,
		interludeTotalHeight: 0,
		activeInterludeAnchor: void 0
	};
	/**
	* 全局唯一复用的返回结果实例
	*/
	layoutResult = {
		lineCount: 0,
		lineInstructions: this.instructionPool,
		bottomLineY: 0,
		isBottomLineInViewport: false,
		hasInterlude: false,
		interludeY: 0
	};
	/**
	* 缓存的歌词行数
	*/
	lyricCount = 0;
	/**
	* 缓存的所有歌词总高度
	*/
	totalLyricHeight = 0;
	/**
	* 初始化排版空间结构与高度缓存
	*
	* 在加载新歌词时调用
	*
	* @param count 歌词总行数
	* @param defaultHeight 尚未渲染/测量的行的默认回退高度
	*/
	initHeights(count, defaultHeight) {
		this.lyricCount = count;
		this.resetLayoutResult();
		if (this.prefixSums.length < count + 1) {
			this.prefixSums = new Float64Array(count + 1);
			this.heights = new Float64Array(count);
			this.isMeasured = new Uint8Array(count);
		} else this.prefixSums.fill(0);
		for (let i = 0; i < count; i++) {
			this.heights[i] = defaultHeight;
			this.isMeasured[i] = 0;
		}
		this.isPrefixSumDirty = true;
		const currentPoolSize = this.instructionPool.length;
		if (count > currentPoolSize) for (let i = currentPoolSize; i < count; i++) this.instructionPool.push({
			y: 0,
			height: 0,
			isInViewport: false
		});
	}
	/**
	* 获取指定索引歌词行的计算高度
	* @remarks 可能为测量值或估算值
	* @param index 歌词行索引
	*/
	getLineHeight(index) {
		if (index < 0 || index >= this.lyricCount) return 0;
		this.ensurePrefixSums();
		return this.prefixSums[index + 1] - this.prefixSums[index];
	}
	/**
	* 设置单行歌词的真实测量高度
	* @param index 歌词行索引
	* @param height 真实测量的高度
	*/
	setLineHeight(index, height) {
		if (index < 0 || index >= this.lyricCount) return;
		if (this.heights[index] !== height || this.isMeasured[index] === 0) {
			this.heights[index] = height;
			this.isMeasured[index] = 1;
			this.isPrefixSumDirty = true;
		}
	}
	/**
	* 批量更新所有未测量行的回退高度
	*
	* 仅在容器 Resize 等会导致回退基准（如 containerHeight / 5）发生变化时调用。
	* 已被真实测量的行不受影响。
	*
	* @param defaultHeight 新的默认回退高度
	*/
	updateUnmeasuredHeights(defaultHeight) {
		let changed = false;
		for (let i = 0; i < this.lyricCount; i++) if (this.isMeasured[i] === 0 && this.heights[i] !== defaultHeight) {
			this.heights[i] = defaultHeight;
			changed = true;
		}
		if (changed) this.isPrefixSumDirty = true;
	}
	/**
	* 解析焦点度量并计算物理滚动边界
	*
	* 返回滚动安全闭区间 `{ min, max }` 以及此帧的生命周期会话句柄 {@link LayoutFrameSession}
	* 供后续使用 `ScrollInteractionEngine.updateBoundary` 钳制 `scrollOffset` 后传给 {@link commit}
	*
	* @param ctx 动态帧上下文，包含当前容器尺寸、焦点目标与底栏高度
	* @param config 布局静态配置，包含对齐锚点、相对位置与 Overscan 容差
	*/
	beginFrame(ctx, config) {
		this.ensurePrefixSums();
		const metrics = this.resolveLayoutMetrics(ctx, config);
		const session = {
			...metrics,
			containerHeight: ctx.containerHeight,
			alignPosition: config.alignPosition,
			overscanPx: config.overscanPx,
			bottomLineHeight: ctx.bottomLineHeight
		};
		if (!metrics.isValid) return {
			bounds: {
				min: 0,
				max: 0
			},
			session
		};
		const { focalTopY, anchorOffset, interludeTotalHeight, activeInterludeAnchor } = metrics;
		const minOffset = Math.min(0, -focalTopY);
		const basePosWithoutScroll = -focalTopY + ctx.containerHeight * config.alignPosition - anchorOffset;
		let totalContentHeight = this.totalLyricHeight;
		if (activeInterludeAnchor !== void 0) totalContentHeight += interludeTotalHeight;
		const rawMaxOffset = basePosWithoutScroll + totalContentHeight - ctx.containerHeight / 2;
		return {
			bounds: {
				min: minOffset,
				max: Math.max(0, rawMaxOffset)
			},
			session
		};
	}
	/**
	* 基于已钳制的 `scrollOffset` 和第一阶段的 {@link LayoutFrameSession} 提交排版并生成指令
	*
	* @param session 由 {@link beginFrame} 生成的单帧排版会话
	* @param scrollOffset 经过边界钳制后的安全滚动偏移量
	*
	* @returns 复用的排版结果实例 {@link LayoutResult}
	*/
	commit(session, scrollOffset) {
		this.ensurePrefixSums();
		if (!session.isValid) return this.resetLayoutResult();
		this.layoutResult.lineCount = this.lyricCount;
		const { focalTopY, anchorOffset, interludeTotalHeight, activeInterludeAnchor, containerHeight, alignPosition, overscanPx, bottomLineHeight } = session;
		const viewportStartY = containerHeight * alignPosition - anchorOffset - scrollOffset - focalTopY;
		const motionBuffer = containerHeight * .4;
		const viewportTopBound = -overscanPx - motionBuffer;
		const viewportBottomBound = containerHeight + overscanPx + motionBuffer;
		for (let i = 0; i < this.lyricCount; i++) {
			const instruction = this.instructionPool[i];
			let lineY = viewportStartY + this.prefixSums[i];
			const lineH = this.prefixSums[i + 1] - this.prefixSums[i];
			if (activeInterludeAnchor !== void 0 && i > activeInterludeAnchor) lineY += interludeTotalHeight;
			instruction.y = lineY;
			instruction.height = lineH;
			instruction.isInViewport = lineY <= viewportBottomBound && lineY + lineH >= viewportTopBound;
		}
		if (activeInterludeAnchor !== void 0) {
			this.layoutResult.hasInterlude = true;
			this.layoutResult.interludeY = viewportStartY + this.prefixSums[activeInterludeAnchor + 1];
		} else {
			this.layoutResult.hasInterlude = false;
			this.layoutResult.interludeY = 0;
		}
		let bottomY = viewportStartY + this.totalLyricHeight;
		if (activeInterludeAnchor !== void 0) bottomY += interludeTotalHeight;
		this.layoutResult.bottomLineY = bottomY;
		this.layoutResult.isBottomLineInViewport = bottomY <= viewportBottomBound && bottomY + bottomLineHeight >= viewportTopBound;
		return this.layoutResult;
	}
	/**
	* 解析当前排版帧所对应的间奏点挂载锚点行索引
	*
	* @param interlude 当前时间线处于激活状态的间奏点信息
	* @param focalTarget 当前帧对齐的物理焦点
	*/
	static resolveInterludeAnchorIndex(interlude, focalTarget) {
		if (interlude) return interlude.anchorLineIndex;
		if (focalTarget.type === "interlude") return focalTarget.anchorIndex;
	}
	/**
	* 如果高度发生过改变，则重新计算前缀和
	*/
	ensurePrefixSums() {
		if (!this.isPrefixSumDirty) return;
		let sum = 0;
		this.prefixSums[0] = 0;
		for (let i = 0; i < this.lyricCount; i++) {
			sum += this.heights[i];
			this.prefixSums[i + 1] = sum;
		}
		this.totalLyricHeight = sum;
		this.isPrefixSumDirty = false;
	}
	/**
	* 公共的焦点度量与范围校验逻辑
	*/
	resolveLayoutMetrics(ctx, config) {
		const interludeTotalHeight = ctx.interlude?.totalHeight ?? 0;
		const activeInterludeAnchor = ctx.interlude?.anchorIndex;
		this.resolvedMetrics.interludeTotalHeight = interludeTotalHeight;
		this.resolvedMetrics.activeInterludeAnchor = activeInterludeAnchor;
		if (this.lyricCount === 0 || ctx.target.type === "line" && (ctx.target.index < 0 || ctx.target.index >= this.lyricCount) || ctx.target.type === "interlude" && (ctx.target.anchorIndex < -1 || ctx.target.anchorIndex >= this.lyricCount - 1)) {
			this.resolvedMetrics.isValid = false;
			this.resolvedMetrics.focalTopY = 0;
			this.resolvedMetrics.anchorOffset = 0;
			return this.resolvedMetrics;
		}
		this.updateFocalMetrics(ctx.target, interludeTotalHeight, activeInterludeAnchor, ctx.bottomLineHeight, config);
		this.resolvedMetrics.isValid = true;
		return this.resolvedMetrics;
	}
	/**
	* 测量对齐目标的几何信息
	*/
	updateFocalMetrics(target, interludeTotalHeight, activeInterludeAnchor, bottomLineHeight, config) {
		let focalTopY = 0;
		let targetHeight = 0;
		if (target.type === "line") {
			focalTopY = this.prefixSums[target.index];
			if (activeInterludeAnchor !== void 0 && target.index > activeInterludeAnchor) focalTopY += interludeTotalHeight;
			targetHeight = this.prefixSums[target.index + 1] - this.prefixSums[target.index];
		} else if (target.type === "interlude") {
			focalTopY = this.prefixSums[target.anchorIndex + 1];
			targetHeight = interludeTotalHeight;
		} else if (target.type === "bottom") {
			focalTopY = this.totalLyricHeight;
			if (activeInterludeAnchor !== void 0) focalTopY += interludeTotalHeight;
			targetHeight = bottomLineHeight;
		}
		this.resolvedMetrics.focalTopY = focalTopY;
		this.resolvedMetrics.anchorOffset = this.calculateAnchorOffset(config.alignAnchor, targetHeight);
	}
	/**
	* 根据锚点与目标高度计算内部相对偏移
	*/
	calculateAnchorOffset(alignAnchor, targetHeight) {
		if (targetHeight <= 0) return 0;
		switch (alignAnchor) {
			case LayoutAlignAnchor.Top: return 0;
			case LayoutAlignAnchor.Center: return targetHeight / 2;
			case LayoutAlignAnchor.Bottom: return targetHeight;
		}
		return alignAnchor;
	}
	/**
	* 重置排版结果为安全干净的状态（全部不可见/无底栏）
	*/
	resetLayoutResult() {
		this.layoutResult.lineCount = 0;
		this.layoutResult.hasInterlude = false;
		this.layoutResult.interludeY = 0;
		this.layoutResult.bottomLineY = 0;
		this.layoutResult.isBottomLineInViewport = false;
		for (let i = 0; i < this.instructionPool.length; i++) {
			this.instructionPool[i].isInViewport = false;
			this.instructionPool[i].y = 0;
			this.instructionPool[i].height = 0;
		}
		return this.layoutResult;
	}
};
//#endregion
//#region src/utils/validate-lyric.ts
function formatValue(value) {
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}
function assertTimestamp(value, path) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`Invalid lyric timestamp at ${path}: ${formatValue(value)}`);
}
function assertTimestampRange(value, path) {
	const startTime = value.startTime;
	const endTime = value.endTime;
	assertTimestamp(startTime, `${path}.startTime`);
	assertTimestamp(endTime, `${path}.endTime`);
	if (startTime > endTime) throw new RangeError(`Invalid lyric timestamp range at ${path}: startTime ${startTime} is greater than endTime ${endTime}`);
}
/**
* 验证歌词数据中的时间戳满足基本数值约束，例如非负、有限等
*/
function assertValidLyricTimestamps(lines) {
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const linePath = `lines[${lineIndex}]`;
		assertTimestampRange(line, linePath);
		for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
			const word = line.words[wordIndex];
			const wordPath = `${linePath}.words[${wordIndex}]`;
			assertTimestampRange(word, wordPath);
			if (word.ruby) for (let rubyIndex = 0; rubyIndex < word.ruby.length; rubyIndex++) assertTimestampRange(word.ruby[rubyIndex], `${wordPath}.ruby[${rubyIndex}]`);
		}
	}
}
//#endregion
//#region src/lyric-player/base/lyric-data-manager.ts
/**
* 歌词数据管理器
*
* 负责：
* 1. 存储原始歌词、进行深拷贝、应用歌词优化、应用歌词掩码
* 2. 计算是否为动态歌词 (逐字歌词) 和是否有对唱歌词
*/
var LyricDataManager = class {
	/**
	* 原始的歌词行数组
	*/
	rawLines = [];
	/**
	* 经过处理后的歌词行数组
	*/
	processedLines = [];
	/**
	* 当前处理好的 processedLines 是否已经失效
	*/
	isDirty = true;
	optimizeOpts = {};
	maskMode = MaskObsceneWordsMode.Disabled;
	maskChar = "*";
	isNonDynamic = false;
	hasDuetLine = false;
	setOriginalLines(lines) {
		assertValidLyricTimestamps(lines);
		this.rawLines = structuredClone(lines);
		this.isDirty = true;
	}
	setConfig(config) {
		if (config.optimizeOptions) this.optimizeOpts = {
			...this.optimizeOpts,
			...config.optimizeOptions
		};
		this.maskMode = config.maskMode ?? this.maskMode;
		this.maskChar = config.maskChar?.charAt(0) ?? this.maskChar;
		this.isDirty = true;
	}
	/**
	* 获取用户设置的原始歌词行数组，未经过优化和掩码
	* @returns 原始歌词行数组
	*/
	getRawLines() {
		return this.rawLines;
	}
	/**
	* 获取对原始歌词行数组处理过的的歌词行数组
	* @returns 经过处理的歌词行数组
	*/
	getProcessedLines() {
		this.ensurePipeline();
		return this.processedLines;
	}
	/**
	* 歌词是否为非动态歌词，又称为逐行歌词
	*/
	getIsNonDynamic() {
		this.ensurePipeline();
		return this.isNonDynamic;
	}
	/**
	* 歌词是否包含对唱歌词
	*/
	getHasDuetLine() {
		this.ensurePipeline();
		return this.hasDuetLine;
	}
	getOptimizeOptions() {
		return this.optimizeOpts;
	}
	getMaskMode() {
		return this.maskMode;
	}
	getMaskChar() {
		return this.maskChar;
	}
	ensurePipeline() {
		if (!this.isDirty) return;
		this.processPipeline();
		this.isDirty = false;
	}
	processPipeline() {
		this.processedLines = structuredClone(this.rawLines);
		optimizeLyricLines(this.processedLines, this.optimizeOpts);
		let checkNonDynamic = true;
		let checkDuet = false;
		for (const line of this.processedLines) {
			if (line.words.length > 1) checkNonDynamic = false;
			if (line.isDuet) checkDuet = true;
			for (const word of line.words) this.applyMask(word);
		}
		this.isNonDynamic = checkNonDynamic && this.processedLines.length > 0;
		this.hasDuetLine = checkDuet;
	}
	applyMask(word) {
		if (!word.obscene || this.maskMode === MaskObsceneWordsMode.Disabled) return;
		const text = word.word;
		const maskChar = this.maskChar;
		if (this.maskMode === MaskObsceneWordsMode.FullMask) word.word = text.replace(/\S/g, maskChar);
		else if (this.maskMode === MaskObsceneWordsMode.PartialMask) {
			const trimmed = text.trim();
			if (trimmed.length <= 2) word.word = text.replace(/\S/g, maskChar);
			else {
				const startPos = text.indexOf(trimmed);
				const endPos = startPos + trimmed.length - 1;
				word.word = text.slice(0, startPos + 1) + text.slice(startPos + 1, endPos).replace(/\S/g, maskChar) + text.slice(endPos);
			}
		}
	}
};
//#endregion
//#region src/lyric-player/base/scroll.ts
/** 滚动静止后允许在歌词焦点切换时恢复自动对齐的等待时间 */
const AUTO_ALIGN_RESUME_DELAY_MS = 500;
/** 滚轮交互结束防抖时间（150毫秒） */
const WHEEL_IDLE_TIMEOUT_MS = 150;
/** 惯性动画基准物理帧时间 */
const BASE_FRAME_DURATION = Duration.fromMillis(1e3 / 60);
/** 惯性单帧最大跨度阈值，超过 100ms 视为掉帧或切换页面丢弃当前步进 */
const MAX_INERTIA_FRAME_DELTA_MS = 100;
var ScrollInteractionEngine = class {
	container;
	hooks;
	offset = 0;
	minOffset = 0;
	maxOffset = 0;
	touchState = {
		startY: 0,
		startX: 0,
		lastY: 0,
		startOffset: 0,
		speed: 0,
		lastTimestamp: 0,
		/**
		* 是否已经突破 10px 意图阈值
		*/
		isIntentConfirmed: false
	};
	/**
	* 记录 Touch 开始时被打断的既有状态
	*/
	interruptedState = {
		hadInertia: false,
		hadTimer: false,
		wasInteracting: false
	};
	inertiaRafId = 0;
	scrollEndTime;
	isInteracting = false;
	wheelEndTimeoutId = 0;
	abortController = new AbortController();
	constructor(container, hooks) {
		this.container = container;
		this.hooks = hooks;
		const signal = this.abortController.signal;
		this.container.addEventListener("touchstart", this.onTouchStart, {
			passive: false,
			signal
		});
		this.container.addEventListener("touchmove", this.onTouchMove, {
			passive: false,
			signal
		});
		this.container.addEventListener("touchend", this.onTouchEnd, {
			passive: false,
			signal
		});
		this.container.addEventListener("touchcancel", this.onTouchCancel, {
			passive: false,
			signal
		});
		this.container.addEventListener("wheel", this.onWheel, {
			passive: false,
			signal
		});
	}
	startInteraction(type) {
		this.scrollEndTime = void 0;
		if (!this.isInteracting) {
			this.isInteracting = true;
			this.hooks.onInteractionStart(type);
		}
	}
	endInteraction() {
		this.isInteracting = false;
		this.clearTimers();
		this.scrollEndTime = performance.now();
	}
	onTouchStart = (evt) => {
		if (evt.touches.length > 1) {
			const touch = evt.touches[0];
			const state = this.touchState;
			state.startY = touch.screenY;
			state.startX = touch.screenX;
			state.lastY = touch.screenY;
			state.startOffset = this.offset;
			state.lastTimestamp = performance.now();
			state.speed = 0;
			return;
		}
		this.interruptedState.hadInertia = this.inertiaRafId !== 0;
		this.interruptedState.hadTimer = this.wheelEndTimeoutId !== 0;
		this.interruptedState.wasInteracting = this.isInteracting;
		this.clearTimers();
		const touch = evt.touches[0];
		const state = this.touchState;
		state.startY = touch.screenY;
		state.startX = touch.screenX;
		state.lastY = touch.screenY;
		state.startOffset = this.offset;
		state.lastTimestamp = performance.now();
		state.speed = 0;
		state.isIntentConfirmed = false;
	};
	onTouchMove = (evt) => {
		const touch = evt.touches[0];
		const state = this.touchState;
		const deltaY = touch.screenY - state.startY;
		const deltaX = touch.screenX - state.startX;
		if (!state.isIntentConfirmed) {
			if (Math.abs(deltaY) > 10 || Math.abs(deltaX) > 10) {
				state.isIntentConfirmed = true;
				this.startInteraction("touch");
			} else return;
		}
		if (evt.cancelable) evt.preventDefault();
		const currentY = touch.screenY;
		this.offset = this.clampOffset(state.startOffset - (currentY - state.startY));
		const now = performance.now();
		const dt = Duration.fromMillis(now - state.lastTimestamp);
		const dtMs = Duration.asMillis(dt);
		if (dtMs > 0) state.speed = (currentY - state.lastY) / dtMs;
		state.lastY = currentY;
		state.lastTimestamp = now;
		this.hooks.onScrollUpdate(true);
	};
	onTouchCancel = (_evt) => {
		const state = this.touchState;
		if (!state.isIntentConfirmed) {
			const { hadInertia, hadTimer, wasInteracting } = this.interruptedState;
			if (hadInertia || hadTimer || wasInteracting) this.endInteraction();
			return;
		}
		state.speed = 0;
		state.startY = 0;
		this.endInteraction();
	};
	onTouchEnd = (evt) => {
		const state = this.touchState;
		if (evt.touches.length > 0) {
			const remainingTouch = evt.touches[0];
			state.startY = remainingTouch.screenY;
			state.startX = remainingTouch.screenX;
			state.lastY = remainingTouch.screenY;
			state.startOffset = this.offset;
			state.lastTimestamp = performance.now();
			state.speed = 0;
			return;
		}
		if (!state.isIntentConfirmed) {
			const { hadInertia, hadTimer, wasInteracting } = this.interruptedState;
			if (hadInertia || hadTimer || wasInteracting) this.endInteraction();
			return;
		}
		state.isIntentConfirmed = false;
		if (evt.cancelable) evt.preventDefault();
		state.startY = 0;
		if (this.inertiaRafId) {
			cancelAnimationFrame(this.inertiaRafId);
			this.inertiaRafId = 0;
		}
		if (Math.abs(state.speed) < .1) state.speed = 0;
		if (Math.abs(state.speed) > .05) {
			let lastFrameTime = performance.now();
			const onScrollFrame = (time) => {
				const dt = Duration.fromMillis(time - lastFrameTime);
				lastFrameTime = time;
				const dtMs = Duration.asMillis(dt);
				if (dtMs <= 0 || dtMs > MAX_INERTIA_FRAME_DELTA_MS) {
					this.inertiaRafId = requestAnimationFrame(onScrollFrame);
					return;
				}
				if (Math.abs(state.speed) > .05) {
					this.offset -= state.speed * dtMs;
					this.offset = this.clampOffset(this.offset);
					const steps = Duration.divDuration(dt, BASE_FRAME_DURATION);
					state.speed *= .95 ** steps;
					this.hooks.onScrollUpdate(true);
					this.inertiaRafId = requestAnimationFrame(onScrollFrame);
				} else {
					this.inertiaRafId = 0;
					this.endInteraction();
				}
			};
			this.inertiaRafId = requestAnimationFrame(onScrollFrame);
		} else this.endInteraction();
	};
	onWheel = (evt) => {
		this.clearTimers();
		this.startInteraction("wheel");
		if (evt.cancelable) evt.preventDefault();
		if (evt.deltaMode === WheelEvent.DOM_DELTA_PIXEL) this.offset += evt.deltaY;
		else this.offset += evt.deltaY * 50;
		this.offset = this.clampOffset(this.offset);
		this.hooks.onScrollUpdate(false);
		this.wheelEndTimeoutId = window.setTimeout(() => {
			this.wheelEndTimeoutId = 0;
			this.endInteraction();
		}, WHEEL_IDLE_TIMEOUT_MS);
	};
	/**
	* 将给定的偏移量限制在当前的 [minOffset, maxOffset] 边界内
	*/
	clampOffset(val) {
		const min = Math.min(this.minOffset, this.maxOffset);
		const max = Math.max(this.minOffset, this.maxOffset);
		return Math.min(Math.max(val, min), max);
	}
	/**
	* 滚动结束是否已超过 {@link AUTO_ALIGN_RESUME_DELAY_MS}
	*/
	get canResumeAutoAlign() {
		return this.scrollEndTime !== void 0 && performance.now() - this.scrollEndTime >= AUTO_ALIGN_RESUME_DELAY_MS;
	}
	/**
	* 更新允许的滚动边界，并返回钳制后的实际 offset
	*
	* @description
	* 在歌词发生排版变化，如页面 `resize`、加载了新歌词、展开背景歌词、歌词行高度改变时，
	* 计算出当前视口内允许滚动的上限与下限，通过此方法传给滚动引擎以确保滚动不会越界
	*/
	updateBoundary(min, max) {
		this.minOffset = Math.min(0, min);
		this.maxOffset = Math.max(0, max);
		this.offset = this.clampOffset(this.offset);
		return this.offset;
	}
	/**
	* 覆盖当前的滚动偏移量并终止正在进行的惯性动画或等待状态
	*
	* @description
	* 当需要清空全部用户手势带来的临时滚动状态时，例如，用户点击了某行歌词触发了
	* Seek、歌曲切歌、或者焦点切换时恢复自动对齐，调用此方法重置滚动引擎
	*/
	resetScroll(targetOffset = 0) {
		this.clearTimers();
		this.scrollEndTime = void 0;
		this.isInteracting = false;
		this.touchState.isIntentConfirmed = false;
		this.touchState.speed = 0;
		this.touchState.startY = 0;
		this.touchState.lastY = 0;
		this.touchState.lastTimestamp = 0;
		this.offset = this.clampOffset(targetOffset);
	}
	clearTimers() {
		if (this.inertiaRafId) {
			cancelAnimationFrame(this.inertiaRafId);
			this.inertiaRafId = 0;
		}
		if (this.wheelEndTimeoutId) {
			window.clearTimeout(this.wheelEndTimeoutId);
			this.wheelEndTimeoutId = 0;
		}
	}
	dispose() {
		this.abortController.abort();
		this.clearTimers();
		this.scrollEndTime = void 0;
	}
};
//#endregion
//#region src/lyric-player/base/seek-detector.ts
/**
* 媒体时钟偏离期望推进量时的固定底限容差
*/
const JITTER_TOLERANCE = Duration.fromMillis(150);
/**
* 媒体时钟相对于物理时钟允许的动态漂移比例
*/
const DRIFT_SLACK = .5;
/**
* 单次判定所信任的最大物理时钟跨度
*/
const MAX_TRUSTED_GAP = Duration.fromMillis(800);
/**
* 跳转状态自动推导器
*
* 让下游使用者只推送播放进度、无需自己判断某次进度变化是否为跳转
*
* 判定的思路是把本次媒体时钟的推进量与当前播放状态下它应有的推进量比较，
* 超出容差的偏离即视为跳转。判定规则为：
* - 进度倒退视为跳转
* - 播放时应有的推进量是物理时钟的推进量，容差随之按比例放宽
* - 暂停时应有的推进量是零，容差只留固定底限
*/
var SeekDetector = class {
	now;
	lastMediaTime = MediaTime.ZERO;
	lastWallTime = 0;
	hasBaseline = false;
	/**
	* @param now 物理时钟读取函数，默认为 `performance.now`
	*/
	constructor(now = () => performance.now()) {
		this.now = now;
	}
	/**
	* 推导本次进度变化是否为跳转
	*
	* @param time 下游推送的当前播放进度
	* @param isPlaying 当前是否在播放，决定本次推送应有的推进量与容差
	* @returns 是否应当按跳转处理
	*/
	detect(time, isPlaying) {
		const wall = this.now();
		if (!this.hasBaseline) {
			this.rebase(time, wall);
			this.hasBaseline = true;
			return false;
		}
		if (time < this.lastMediaTime) {
			this.rebase(time, wall);
			return true;
		}
		const mediaDelta = MediaTime.since(time, this.lastMediaTime);
		const elapsed = Duration.clampPositive(Duration.fromMillis(wall - this.lastWallTime));
		const wallDelta = Duration.min(elapsed, MAX_TRUSTED_GAP);
		this.rebase(time, wall);
		const expected = isPlaying ? wallDelta : Duration.ZERO;
		const tolerance = isPlaying ? Duration.max(JITTER_TOLERANCE, Duration.mulF64(wallDelta, DRIFT_SLACK)) : JITTER_TOLERANCE;
		return Duration.sub(mediaDelta, expected) > tolerance;
	}
	reset() {
		this.hasBaseline = false;
		this.lastMediaTime = MediaTime.ZERO;
		this.lastWallTime = 0;
	}
	rebase(time, wall) {
		this.lastMediaTime = time;
		this.lastWallTime = wall;
	}
};
//#endregion
//#region src/lyric-player/base/spring.ts
const SLOW_STIFFNESS = 90;
const SLOW_DAMPING = 15;
const MEDIUM_STIFFNESS = 140;
const MEDIUM_DAMPING = 22;
const MIN_INTERVAL = 100;
const MAX_INTERVAL = 800;
const MIN_STIFFNESS = 170;
const DAMPING_MULTIPLIER = 2.2;
const INTERVAL_EXPONENT = .2;
/**
* 获取歌词行纵向滚动的弹簧物理参数
* @param isSeeking 当前是否是跳转状态
* @param isInterludeActive 当前是否处于间奏动画状态
* @param intervalMs 当前歌词行与上一行的时间差，若无法提供（如首尾行），传入 undefined
* @param isEndOfSong 歌曲是否播放完毕
* @returns 弹簧参数配置 {@link SpringParams}
*/
function getPosYSpringPolicy(isSeeking, isInterludeActive, intervalMs, isEndOfSong = false) {
	if (isSeeking || isInterludeActive) return {
		stiffness: SLOW_STIFFNESS,
		damping: SLOW_DAMPING
	};
	if (isEndOfSong) return {
		stiffness: MEDIUM_STIFFNESS,
		damping: MEDIUM_DAMPING
	};
	if (intervalMs == null) return {
		stiffness: SLOW_STIFFNESS,
		damping: SLOW_DAMPING
	};
	let ratio = 1 - (Math.min(Math.max(intervalMs, MIN_INTERVAL), MAX_INTERVAL) - MIN_INTERVAL) / 700;
	ratio = ratio ** INTERVAL_EXPONENT;
	const targetStiffness = MIN_STIFFNESS + ratio * 50;
	return {
		stiffness: targetStiffness,
		damping: Math.sqrt(targetStiffness) * DAMPING_MULTIPLIER
	};
}
//#endregion
//#region src/lyric-player/base/timeline.ts
/**
* 判定为间奏所需的最小空隙时长
*/
const MIN_INTERLUDE_GAP = Duration.fromMillis(7e3);
var TimelineController = class {
	lyricBounds = [];
	/**
	* 全部歌词行中最晚的结束时间，用于判定歌曲是否播放完毕
	*/
	maxEndTime = MediaTime.ZERO;
	/**
	* 预先计算的间奏区域
	*/
	precalculatedInterludes = [];
	/**
	* 保存上次顺序扫描停止的位置，用于避免每次都从头遍历所有歌词，提高性能
	*/
	playbackCursor = 0;
	interludeCursor = 0;
	playingGroupsSet = /* @__PURE__ */ new Set();
	highlightedGroupsSet = /* @__PURE__ */ new Set();
	nextPlayingSet = /* @__PURE__ */ new Set();
	nextHighlightedSet = /* @__PURE__ */ new Set();
	addedPlayingIds = [];
	removedPlayingIds = [];
	addedHighlightedIds = [];
	removedHighlightedIds = [];
	expiredHighlightedIds = [];
	snapshot = {
		currentTime: MediaTime.ZERO,
		playingGroups: this.playingGroupsSet,
		highlightedGroups: this.highlightedGroupsSet,
		scrollToIndex: 0,
		latestHighlightedIndex: void 0,
		isEndOfSong: false,
		activeInterlude: void 0,
		isFocusOnInterlude: false
	};
	diff = {
		hasChanged: false,
		isTimeJumped: false,
		addedPlaying: this.addedPlayingIds,
		removedPlaying: this.removedPlayingIds,
		addedHighlighted: this.addedHighlightedIds,
		removedHighlighted: this.removedHighlightedIds,
		isInterludeChanged: false,
		isScrollToChanged: false,
		isEndOfSongChanged: false
	};
	/**
	* 提前设置好歌词的时间数据，内部会根据此数据来进行时间线推导，同时预计算间奏区间
	*
	* @param bounds 歌词行的时间边界，**必须按 `startTime` 升序排列**，不按 `startTime`
	* 排列可能会导致时间推导出现意外情况
	*/
	setTimeBounds(bounds) {
		this.lyricBounds = bounds;
		this.precalculatedInterludes = this.calculateInterludes(bounds);
		let maxEnd = MediaTime.ZERO;
		for (const bound of bounds) maxEnd = MediaTime.max(maxEnd, bound.endTime);
		this.maxEndTime = maxEnd;
		this.reset();
	}
	/**
	* 获取当前播放时间线状态的只读快照
	*
	* 用于给 UI 执行排版和计算各种歌词行的效果
	*
	* @remarks 在获取快照后，必须在同一帧内消费完毕，切勿保留其引用，因为下一帧就会被原地覆写
	* @returns 时间线快照
	*/
	getSnapshot() {
		return this.snapshot;
	}
	/**
	* 将播放进度推进到指定时间，并返回相对上一帧的增量变化
	*
	* @remarks
	* 歌词行的高亮生命周期为：
	* * 命中 `[startTime, endTime)` 时高亮
	* * 唱完后不会自行熄灭，而是继续保持高亮
	*
	* 直到出现下列任一情况：
	*
	* 1. 有新的歌词行开始播放，此时已唱完的行被一起熄灭
	* 2. 进入间奏区间，此时清空全部高亮并把焦点交给间奏点
	* 3. 歌曲播放完毕，此时清空全部高亮并设置 {@link TimelineSnapshot.isEndOfSong} 为 true
	* 4. 发生跳转，此时按跳转后的时间重新推导
	*
	* @param time 当前播放时间
	* @param forceSeek 这次时间变化是否由跳转触发
	* @returns 相对上一帧的增量变化
	*/
	sync(time, forceSeek = false) {
		this.addedPlayingIds.length = 0;
		this.removedPlayingIds.length = 0;
		this.addedHighlightedIds.length = 0;
		this.removedHighlightedIds.length = 0;
		const prevInterlude = this.snapshot.activeInterlude;
		const prevFocusOnInterlude = this.snapshot.isFocusOnInterlude;
		const prevScrollToIndex = this.snapshot.scrollToIndex;
		const prevEndOfSong = this.snapshot.isEndOfSong;
		const isTimeRetreating = time < this.snapshot.currentTime;
		const isJump = forceSeek || isTimeRetreating;
		const activeInterlude = this.resolveActiveInterlude(time, isJump);
		this.snapshot.activeInterlude = activeInterlude;
		const isPastLastLine = this.lyricBounds.length > 0 && time >= this.maxEndTime;
		if (isJump) this.performSeek(time, !!activeInterlude || isPastLastLine);
		else this.performPlayback(time);
		if (activeInterlude && this.playingGroupsSet.size === 0) this.flushAllHighlighted();
		if (isPastLastLine) this.flushAllHighlighted();
		this.updateInterludeFocus(activeInterlude);
		const isInterludeChanged = prevInterlude !== activeInterlude;
		const isFocusChanged = prevFocusOnInterlude !== this.snapshot.isFocusOnInterlude;
		const isScrollToChanged = prevScrollToIndex !== this.snapshot.scrollToIndex;
		const isEndOfSongChanged = isPastLastLine !== prevEndOfSong;
		const hasChanged = isJump || this.addedPlayingIds.length > 0 || this.removedPlayingIds.length > 0 || this.addedHighlightedIds.length > 0 || this.removedHighlightedIds.length > 0 || isInterludeChanged || isFocusChanged || isScrollToChanged || isEndOfSongChanged;
		this.snapshot.currentTime = time;
		if (this.highlightedGroupsSet.size > 0) {
			let maxIndex = -1;
			for (const id of this.highlightedGroupsSet) if (id > maxIndex) maxIndex = id;
			this.snapshot.latestHighlightedIndex = maxIndex;
		} else this.snapshot.latestHighlightedIndex = void 0;
		this.snapshot.isEndOfSong = isPastLastLine;
		this.diff.hasChanged = hasChanged;
		this.diff.isTimeJumped = isJump;
		this.diff.isInterludeChanged = isInterludeChanged;
		this.diff.isScrollToChanged = isScrollToChanged;
		this.diff.isEndOfSongChanged = isEndOfSongChanged;
		return this.diff;
	}
	/**
	* 处理正常播放时的时间线推导
	*/
	performPlayback(time) {
		for (const lastPlayingId of this.playingGroupsSet) {
			const bound = this.lyricBounds[lastPlayingId];
			if (!bound || time < bound.startTime || bound.endTime <= time) {
				this.playingGroupsSet.delete(lastPlayingId);
				this.removedPlayingIds.push(lastPlayingId);
			}
		}
		let cursor = Math.max(0, this.playbackCursor);
		const len = this.lyricBounds.length;
		while (cursor < len) {
			const bound = this.lyricBounds[cursor];
			if (bound.startTime > time) break;
			if (bound.startTime <= time && bound.endTime > time && !this.playingGroupsSet.has(cursor)) {
				this.playingGroupsSet.add(cursor);
				this.addedPlayingIds.push(cursor);
			}
			cursor++;
		}
		this.playbackCursor = cursor;
		this.expiredHighlightedIds.length = 0;
		for (const id of this.highlightedGroupsSet) if (!this.playingGroupsSet.has(id)) this.expiredHighlightedIds.push(id);
		const addedPlayingCount = this.addedPlayingIds.length;
		const expiredCount = this.expiredHighlightedIds.length;
		for (let i = 0; i < addedPlayingCount; i++) {
			const id = this.addedPlayingIds[i];
			this.highlightedGroupsSet.add(id);
			this.addedHighlightedIds.push(id);
		}
		if (addedPlayingCount > 0) {
			for (let i = 0; i < expiredCount; i++) {
				const id = this.expiredHighlightedIds[i];
				this.highlightedGroupsSet.delete(id);
				this.removedHighlightedIds.push(id);
			}
			let minHighlighted = Number.POSITIVE_INFINITY;
			for (const id of this.highlightedGroupsSet) if (id < minHighlighted) minHighlighted = id;
			this.snapshot.scrollToIndex = minHighlighted;
		}
	}
	/**
	* 处理 Seek 时的时间线推导
	*
	* 直接按目标时间重建播放与高亮行集合，结果与正常播放到该时刻时一致
	*
	* @param time 跳转到的时间
	* @param dropLingeringWhenIdle 在没有任何行正在播放时，是否丢弃那些已经唱完、
	* 但在正常播放中仍会保持高亮的行，用于在间奏和播放完时清空高亮行
	*/
	performSeek(time, dropLingeringWhenIdle) {
		const nextPlaying = this.nextPlayingSet;
		const nextHighlighted = this.nextHighlightedSet;
		nextPlaying.clear();
		nextHighlighted.clear();
		let left = 0;
		let right = this.lyricBounds.length - 1;
		let firstGreater = this.lyricBounds.length;
		while (left <= right) {
			const mid = left + right >> 1;
			if (this.lyricBounds[mid].startTime > time) {
				firstGreater = mid;
				right = mid - 1;
			} else left = mid + 1;
		}
		let anchorIndex = -1;
		for (let i = firstGreater - 1; i >= 0; i--) {
			const bound = this.lyricBounds[i];
			if (bound.endTime > bound.startTime) {
				anchorIndex = i;
				break;
			}
		}
		if (anchorIndex === -1) {
			this.playbackCursor = firstGreater;
			this.snapshot.scrollToIndex = 0;
			this.commitSeekDiff();
			return;
		}
		const anchorStart = this.lyricBounds[anchorIndex].startTime;
		let minPlaying = -1;
		let minHighlighted = -1;
		for (let i = anchorIndex; i >= 0; i--) {
			const bound = this.lyricBounds[i];
			if (bound.endTime <= anchorStart) continue;
			if (bound.startTime <= time && bound.endTime > time) {
				nextPlaying.add(i);
				minPlaying = i;
			}
			nextHighlighted.add(i);
			minHighlighted = i;
		}
		if (dropLingeringWhenIdle && nextPlaying.size === 0) nextHighlighted.clear();
		this.playbackCursor = minPlaying === -1 ? firstGreater : minPlaying;
		this.snapshot.scrollToIndex = minHighlighted;
		this.commitSeekDiff();
	}
	/**
	* 把 Seek 重建出的目标集合与上一帧的集合求对称差，输出发生变化的部分
	*/
	commitSeekDiff() {
		for (const id of this.playingGroupsSet) if (!this.nextPlayingSet.has(id)) {
			this.playingGroupsSet.delete(id);
			this.removedPlayingIds.push(id);
		}
		for (const id of this.nextPlayingSet) if (!this.playingGroupsSet.has(id)) {
			this.playingGroupsSet.add(id);
			this.addedPlayingIds.push(id);
		}
		for (const id of this.highlightedGroupsSet) if (!this.nextHighlightedSet.has(id)) {
			this.highlightedGroupsSet.delete(id);
			this.removedHighlightedIds.push(id);
		}
		for (const id of this.nextHighlightedSet) if (!this.highlightedGroupsSet.has(id)) {
			this.highlightedGroupsSet.add(id);
			this.addedHighlightedIds.push(id);
		}
	}
	/**
	* 立即熄灭当前全部高亮歌词行
	*
	* 用于间奏与曲末这两个没有下一行接续、但必须清空高亮的场景
	*/
	flushAllHighlighted() {
		if (this.highlightedGroupsSet.size === 0) return;
		for (const id of this.highlightedGroupsSet) this.removedHighlightedIds.push(id);
		this.highlightedGroupsSet.clear();
	}
	/**
	* 预计算全部间奏区间
	* @param bounds 按 `startTime` 升序排列的歌词时间边界
	* @returns 按时间升序排列、互不重叠的间奏区间，供二分查找与游标推进使用
	*/
	calculateInterludes(bounds) {
		const interludes = [];
		let maxEnd = MediaTime.ZERO;
		for (let i = -1; i < bounds.length - 1; i++) {
			if (i >= 0) maxEnd = MediaTime.max(maxEnd, bounds[i].endTime);
			const gapEnd = MediaTime.max(maxEnd, bounds[i + 1].startTime);
			if (MediaTime.since(gapEnd, maxEnd) >= MIN_INTERLUDE_GAP) interludes.push({
				startTime: maxEnd,
				endTime: gapEnd,
				anchorLineIndex: i
			});
		}
		return interludes;
	}
	/**
	* 查找当前时间命中的间奏区间，并顺带推进或重定位间奏游标
	* @param time 当前播放时间
	* @param isSeek 当前帧是否为跳转
	* @returns 命中的间奏区间，未命中时为 undefined
	*/
	resolveActiveInterlude(time, isSeek) {
		if (this.precalculatedInterludes.length === 0) return void 0;
		if (isSeek) {
			let cursor = this.precalculatedInterludes.length;
			let left = 0;
			let right = this.precalculatedInterludes.length - 1;
			while (left <= right) {
				const mid = left + right >> 1;
				if (this.precalculatedInterludes[mid].endTime > time) {
					cursor = mid;
					right = mid - 1;
				} else left = mid + 1;
			}
			this.interludeCursor = cursor;
			if (cursor < this.precalculatedInterludes.length) {
				const inter = this.precalculatedInterludes[cursor];
				if (time >= inter.startTime && time < inter.endTime) return inter;
			}
			return;
		}
		while (this.interludeCursor < this.precalculatedInterludes.length) {
			const inter = this.precalculatedInterludes[this.interludeCursor];
			if (time >= inter.startTime && time < inter.endTime) return inter;
			if (time >= inter.endTime) this.interludeCursor++;
			else break;
		}
	}
	/**
	* 根据间奏命中情况和当前高亮状态推导是否应当聚焦间奏点
	*
	* 处于间奏区域且没有任何歌词高亮时聚焦间奏点，否则交还给歌词行
	*
	* @param activeInterlude 当前命中的间奏区间
	*/
	updateInterludeFocus(activeInterlude) {
		this.snapshot.isFocusOnInterlude = !!activeInterlude && this.highlightedGroupsSet.size === 0;
	}
	/**
	* 清空全部推导状态，回到时间原点
	*/
	reset() {
		this.playbackCursor = 0;
		this.interludeCursor = 0;
		this.playingGroupsSet.clear();
		this.highlightedGroupsSet.clear();
		this.nextPlayingSet.clear();
		this.nextHighlightedSet.clear();
		this.snapshot.currentTime = MediaTime.ZERO;
		this.snapshot.scrollToIndex = 0;
		this.snapshot.latestHighlightedIndex = void 0;
		this.snapshot.isEndOfSong = false;
		this.snapshot.activeInterlude = void 0;
		this.snapshot.isFocusOnInterlude = false;
	}
};
//#endregion
//#region src/lyric-player/base/index.ts
function getEntrySize(entry) {
	if (entry.borderBoxSize && entry.borderBoxSize.length > 0) {
		const borderBox = entry.borderBoxSize[0];
		return [borderBox.inlineSize, borderBox.blockSize];
	}
	const el = entry.target;
	return [el.offsetWidth || entry.contentRect.width, el.offsetHeight || entry.contentRect.height];
}
/**
* 歌词播放器的基类，已经包含了有关歌词操作和排版的功能，
* 子类需要为其实现对应的显示展示操作
*/
var LyricPlayerBase = class extends EventTarget {
	element = document.createElement("div");
	isPlaying = false;
	timelineController = new TimelineController();
	seekDetector = new SeekDetector();
	enableAutoSeekDetection = true;
	hasBottomContent = false;
	bottomLineObserver;
	/** @internal */
	lyricGroupElementMap = /* @__PURE__ */ new WeakMap();
	lyricLinesIndexes = /* @__PURE__ */ new WeakMap();
	disableSpring = false;
	dataManager = new LyricDataManager();
	get processedLines() {
		return this.dataManager.getProcessedLines();
	}
	get isNonDynamic() {
		return this.dataManager.getIsNonDynamic();
	}
	get hasDuetLine() {
		return this.dataManager.getHasDuetLine();
	}
	layoutState = { interludeDotsSize: [0, 0] };
	layoutConfig = {
		alignAnchor: LayoutAlignAnchor.Center,
		alignPosition: .35,
		overscanPx: 300
	};
	/** LayoutCalculator 所使用的排版上下文状态 */
	frameContext = {
		containerHeight: 0,
		scrollOffset: 0,
		target: {
			index: 0,
			type: "line"
		},
		bottomLineHeight: 0,
		interlude: void 0
	};
	/**
	* 逐帧刷新的视觉推导派生值
	*
	* 存放会在逐行循环内被反复求值的量，避免逐行重算
	*/
	visualFrame = {
		/** 最靠后的高亮行，无高亮时回退到 `scrollToIndex` */
		latestIndex: 0,
		/** 已播放行的分界，`hidePassedLines` 启用时此行之前的歌词被隐藏 */
		passedBoundary: 0,
		/** 是否为窄视口，窄视口下模糊强度打折 */
		isNarrowViewport: false
	};
	interludeDots;
	bottomLine;
	enableBlur = true;
	enableScale = true;
	hidePassedLines = false;
	scrollEngine;
	scrollState = {
		isAutoAlignSuspended: false,
		isTouchScrolled: false
	};
	layoutCalculator = new LayoutCalculator();
	focusController = new FocusController();
	currentLyricGroups = [];
	lyricGroupSize = /* @__PURE__ */ new WeakMap();
	size = [0, 0];
	isPageVisible = true;
	/** 默认/回退单行歌词估算高度基准 (containerHeight / 5) */
	get defaultLineHeight() {
		return this.size[1] / 5;
	}
	/**
	* 获取指定索引歌词行的高度
	* @remarks 可能为测量值或估算值
	*/
	getLineHeight(index) {
		return this.layoutCalculator.getLineHeight(index);
	}
	/** 是否强制让背景人声行始终后置（即始终在主歌词下方显示，不前置背景人声） */
	alwaysPostpositionBackground = false;
	posXSpringParams = {
		mass: 1,
		damping: 10,
		stiffness: 100
	};
	posYSpringParams = {
		mass: .9,
		damping: 15,
		stiffness: 90
	};
	scaleSpringParams = {
		mass: 2,
		damping: 25,
		stiffness: 100
	};
	scaleForBGSpringParams = {
		mass: 1,
		damping: 20,
		stiffness: 50
	};
	lyricGroupIndexMap = /* @__PURE__ */ new WeakMap();
	onPageShow = () => {
		this.isPageVisible = true;
		this.setCurrentTime(this.getCurrentTime(), true);
	};
	onPageHide = () => {
		this.isPageVisible = false;
	};
	onVisibilityChange = () => {
		if (document.visibilityState !== "visible") return;
		this.seekDetector.reset();
	};
	/** @internal */
	resizeObserver = new ResizeObserver(((entries) => {
		let shouldRelayout = false;
		let shouldRebuildPlayerStyle = false;
		let shouldUpdateFallback = false;
		for (const entry of entries) if (entry.target === this.element) {
			const rect = entry.contentRect;
			this.size[0] = rect.width;
			this.size[1] = rect.height;
			shouldRebuildPlayerStyle = true;
			shouldUpdateFallback = true;
		} else if (entry.target === this.interludeDots.getElement()) {
			const size = getEntrySize(entry);
			this.layoutState.interludeDotsSize[0] = size[0];
			this.layoutState.interludeDotsSize[1] = size[1];
			shouldRelayout = true;
		} else if (entry.target === this.bottomLine.getElement()) {
			const newSize = getEntrySize(entry);
			const oldSize = this.bottomLine.lineSize;
			if (newSize[0] !== oldSize[0] || newSize[1] !== oldSize[1]) {
				this.bottomLine.lineSize = newSize;
				shouldRelayout = true;
			}
		} else {
			const groupObj = this.lyricGroupElementMap.get(entry.target);
			if (groupObj) {
				const newSize = getEntrySize(entry);
				if (entry.target === groupObj.getElement()) {
					const oldSize = this.lyricGroupSize.get(groupObj) ?? [0, 0];
					if (newSize[0] !== oldSize[0] || newSize[1] !== oldSize[1]) {
						this.lyricGroupSize.set(groupObj, newSize);
						groupObj.onLineSizeChange(newSize);
						const index = this.lyricGroupIndexMap.get(groupObj) ?? -1;
						if (index !== -1) this.layoutCalculator.setLineHeight(index, newSize[1]);
						shouldRelayout = true;
					}
				} else groupObj.onBgSizeChange?.(newSize);
			}
		}
		if (shouldUpdateFallback) {
			this.layoutCalculator.updateUnmeasuredHeights(this.defaultLineHeight);
			shouldRelayout = true;
		}
		if (shouldRelayout) this.calcLayout(LayoutReason.Resize);
		if (shouldRebuildPlayerStyle) this.onResize();
	}));
	wordFadeWidth = .5;
	constructor(element) {
		super();
		if (element) this.element = element;
		this.element.classList.add("amll-lyric-player");
		this.interludeDots = this.createInterludeDots();
		this.bottomLine = this.createBottomLine();
		this.resizeObserver.observe(this.element);
		this.resizeObserver.observe(this.interludeDots.getElement());
		this.resizeObserver.observe(this.bottomLine.getElement());
		this.element.appendChild(this.interludeDots.getElement());
		this.element.appendChild(this.bottomLine.getElement());
		this.interludeDots.setTransform(0, 200);
		this.bottomLineObserver = new MutationObserver(() => {
			const newHasBottomContent = this.getBottomLineElement().innerHTML.trim().length > 0;
			if (this.hasBottomContent !== newHasBottomContent) {
				if (newHasBottomContent) this.bottomLine.resetPosition();
				this.hasBottomContent = newHasBottomContent;
				this.calcLayout(LayoutReason.ConfigChange);
			}
		});
		this.bottomLineObserver.observe(this.getBottomLineElement(), {
			childList: true,
			characterData: true,
			subtree: true
		});
		window.addEventListener("pageshow", this.onPageShow);
		window.addEventListener("pagehide", this.onPageHide);
		document.addEventListener("visibilitychange", this.onVisibilityChange);
		this.scrollEngine = new ScrollInteractionEngine(this.element, {
			onScrollUpdate: (isContinuous) => {
				this.calcLayout(isContinuous ? LayoutReason.ContinuousScroll : LayoutReason.DiscreteScroll);
			},
			onInteractionStart: (type) => {
				this.scrollState.isAutoAlignSuspended = true;
				this.scrollState.isTouchScrolled = type === "touch";
				this.calcLayout(LayoutReason.InteractionStart);
			}
		});
	}
	/**
	* 设置文字动画的渐变宽度，单位以歌词行的主文字字体大小的倍数为单位，默认为 0.5，即一个全角字符的一半宽度
	*
	* 如果要模拟 Apple Music for Android 的效果，可以设置为 1
	*
	* 如果要模拟 Apple Music for iPad 的效果，可以设置为 0.5
	*
	* 如果想要近乎禁用渐变效果，可以设置成非常接近 0 的小数（例如 `0.0001` ），但是**不可以为 0**
	*
	* @param value 需要设置的渐变宽度，单位以歌词行的主文字字体大小的倍数为单位，默认为 0.5
	*/
	setWordFadeWidth(value = .5) {
		this.wordFadeWidth = Math.max(1e-4, value);
	}
	/**
	* 是否启用歌词行缩放效果，默认启用
	*
	* 如果启用，非选中的歌词行会轻微缩小以凸显当前播放歌词行效果
	*
	* 此效果对性能影响微乎其微，推荐启用
	* @param enable 是否启用歌词行缩放效果
	*/
	setEnableScale(enable = true) {
		this.enableScale = enable;
		this.calcLayout(LayoutReason.ConfigChange);
	}
	/**
	* 获取当前是否启用了歌词行缩放效果
	* @returns 是否启用歌词行缩放效果
	*/
	getEnableScale() {
		return this.enableScale;
	}
	/**
	* 获取当前文字动画的渐变宽度，单位以歌词行的主文字字体大小的倍数为单位
	* @returns 当前文字动画的渐变宽度，单位以歌词行的主文字字体大小的倍数为单位
	*/
	getWordFadeWidth() {
		return this.wordFadeWidth;
	}
	/**
	* 设置持续性的跳转状态
	*
	* @deprecated 此方法已无实际作用，调用它不会产生任何效果，仅为兼容保留，将在未来移除
	*
	* 跳转状态现在由每次进度推送逐帧推导，不再存在需要外部显式解除的持续状态
	*
	* 跳转会通过以下三条途径被识别，三者同时生效：
	*
	* - {@link setCurrentTime} 的 `isSeek` 参数，由调用方明确告知某次进度变化是跳转
	* - 进度倒退，由内部无条件识别，不受任何开关控制
	* - 自动推导，由内部比对进度的实际推进量与它应有的推进量识别超量前进，默认启用，
	*   可通过 {@link setEnableAutoSeekDetection} 关闭
	*/
	setIsSeeking(_isSeeking) {}
	/**
	* 设置是否自动推导跳转状态，默认启用
	*
	* 启用后，即使调用 {@link setCurrentTime} 时没有传入 `isSeek`，
	* 内部也会在进度前进时比较它的实际推进量与应有的推进量，超量前进即视为跳转
	*
	* 应有的推进量取决于当前的播放状态，因此请按 {@link pause} 与 {@link resume}
	* 的文档正确同步播放状态：
	* - 播放时以物理时钟的推进量为准，容差随之按比例放宽，以容纳倍速播放与不均匀的推送节奏
	* - 暂停时进度本不该前进，应有的推进量是零，因此任何超出抖动幅度的前进都会被视为跳转
	*
	* 这意味着进度信息的粒度粗于推送间隔时，粒度跳变的那一帧会因超量前进被视为跳转，
	* 此时应当改善进度来源的精度，或关闭此开关
	*
	* 较小的向前跳转可能无法被识别，但一般影响不大
	*
	* 此开关只控制上述超量前进的判定。进度倒退不受它控制，无论是否启用推导都会被视为跳转；
	* 进度保持不变则既不前进也不后退，不会被推导视为跳转
	*
	* 推导只会额外识别出跳转，不会否决已显式传入的跳转标志，因此如果你已经在正确传入
	* 跳转标志了，则一般无需关心此开关。若你的进度来源精度很差而导致超量前进被频繁误判，
	* 可以选择关闭
	*
	* @param enable 是否启用自动推导
	*/
	setEnableAutoSeekDetection(enable = true) {
		if (this.enableAutoSeekDetection === enable) return;
		this.enableAutoSeekDetection = enable;
		this.seekDetector.reset();
	}
	/**
	* 获取当前是否启用了跳转状态的自动推导
	* @returns 是否启用自动推导
	*/
	getEnableAutoSeekDetection() {
		return this.enableAutoSeekDetection;
	}
	/**
	* 设置是否隐藏已经播放过的歌词行，默认不隐藏
	* @param hide 是否隐藏已经播放过的歌词行，默认不隐藏
	*/
	setHidePassedLines(hide) {
		this.hidePassedLines = hide;
		this.calcLayout(LayoutReason.ConfigChange);
	}
	/**
	* 设置是否启用歌词行的模糊效果
	* @param enable 是否启用
	*/
	setEnableBlur(enable) {
		if (this.enableBlur === enable) return;
		this.enableBlur = enable;
		this.calcLayout(LayoutReason.ConfigChange);
	}
	/**
	* 批量更新歌词处理配置，包括优化和掩码设置
	*
	* @remarks
	* 此方法不会自动重建歌词行和刷新视图，
	* 适用于在渲染前预设配置、批量初始化，或需要手动控制 DOM 刷新时机的场景
	* @param config 需要更新的配置集合
	* @see {@link LyricDataConfig}
	*/
	setLyricProcessConfig(config) {
		this.dataManager.setConfig(config);
	}
	/**
	* 批量更新歌词处理配置，包括优化和掩码设置
	*
	* 可以调用此方法以避免多次单独设置处理配置导致的多次刷新开销
	* @remarks 在设置完成后会自动重建歌词行和刷新视图
	* @param config 需要更新的配置集合
	* @see {@link LyricDataConfig}
	*/
	updateLyricProcessConfig(config) {
		const currentOptimize = this.dataManager.getOptimizeOptions();
		const currentMaskMode = this.dataManager.getMaskMode();
		const currentMaskChar = this.dataManager.getMaskChar();
		const newOptimize = config.optimizeOptions !== void 0 ? config.optimizeOptions : currentOptimize;
		const newMaskMode = config.maskMode !== void 0 ? config.maskMode : currentMaskMode;
		const newMaskChar = config.maskChar !== void 0 ? config.maskChar : currentMaskChar;
		if (newMaskMode === currentMaskMode && newMaskChar === currentMaskChar && areOptimizeOptionsEqual(newOptimize, currentOptimize)) return;
		this.dataManager.setConfig({
			optimizeOptions: newOptimize,
			maskMode: newMaskMode,
			maskChar: newMaskChar
		});
		if (this.dataManager.getRawLines().length > 0) {
			this.rebuildLyricView(this.getCurrentTime());
			this.calcLayout(LayoutReason.ConfigChange);
		}
	}
	/**
	* 设置歌词中不雅用语的掩码模式
	* @remarks 在设置完成后会自动重建歌词行和刷新视图
	* @param mode 掩码模式
	* @see {@link MaskObsceneWordsMode}
	*/
	setMaskObsceneWords(mode) {
		this.updateLyricProcessConfig({ maskMode: mode });
	}
	/**
	* 设置不雅用语掩码使用的字符，默认为 `*`
	* @remarks 在设置完成后会自动重建歌词行和刷新视图
	* @param char 单个字符，用于替换不雅用语中的字符
	*/
	setMaskObsceneWordChar(char) {
		const c = char.charAt(0) || "*";
		this.updateLyricProcessConfig({ maskChar: c });
	}
	/**
	* 设置歌词的优化配置项，这些配置项默认全部开启
	* @remarks 在设置完成后会自动重建歌词行和刷新视图
	* @param options 优化配置选项
	* @see {@link OptimizeLyricOptions}
	*/
	setOptimizeOptions(options) {
		const currentOpts = this.dataManager.getOptimizeOptions();
		this.updateLyricProcessConfig({ optimizeOptions: {
			...currentOpts,
			...options
		} });
	}
	rebuildLyricLines() {
		for (const group of this.currentLyricGroups) group.rebuildAllLines();
	}
	/**
	* 设置目标歌词行的对齐方式，默认为 `center`
	*
	* - 设置成 `top` 的话将会向目标歌词行的顶部对齐
	* - 设置成 `bottom` 的话将会向目标歌词行的底部对齐
	* - 设置成 `center` 的话将会向目标歌词行的垂直中心对齐
	* @param alignAnchor 歌词行对齐方式，详情见函数说明
	*/
	setAlignAnchor(alignAnchor) {
		this.layoutConfig.alignAnchor = alignAnchor;
	}
	/**
	* 设置默认的歌词行对齐位置，相对于整个歌词播放组件的大小位置，默认为 `0.5`
	* @param alignPosition 一个 `[0.0-1.0]` 之间的任意数字，代表组件高度由上到下的比例位置
	*/
	setAlignPosition(alignPosition) {
		this.layoutConfig.alignPosition = alignPosition;
	}
	/**
	* 设置 overscan（视图上下额外缓冲渲染区）距离，单位：像素。
	* @param px 像素值，默认 300
	*/
	setOverscanPx(px) {
		this.layoutConfig.overscanPx = clampPositive(px | 0);
	}
	/** 获取当前 overscan 像素距离 */
	getOverscanPx() {
		return this.layoutConfig.overscanPx;
	}
	/**
	* 设置是否使用物理弹簧算法实现歌词动画效果，默认启用
	*
	* 如果启用，则会通过弹簧算法实时处理歌词位置，但是需要性能足够强劲的电脑方可流畅运行
	*
	* 如果不启用，则会回退到基于 `transition` 的过渡效果，对低性能的机器比较友好，但是效果会比较单一
	*/
	setEnableSpring(enable = true) {
		this.disableSpring = !enable;
		if (enable) this.element.classList.remove(lyric_player_module_default.disableSpring);
		else this.element.classList.add(lyric_player_module_default.disableSpring);
		this.calcLayout(LayoutReason.ConfigChange);
	}
	/**
	* 获取当前是否启用了物理弹簧
	* @returns 是否启用物理弹簧
	*/
	getEnableSpring() {
		return !this.disableSpring;
	}
	/**
	* 设置当前播放歌词，要注意传入后这个数组内的信息不得修改，否则会发生错误
	* @param lines 歌词数组
	* @param initialTime 初始时间，默认为 0
	* @throws {TypeError} 歌词时间戳不是有限的非负数字
	* @throws {RangeError} 任一行、单词或注音的开始时间晚于结束时间
	*/
	setLyricLines(lines, initialTime = 0) {
		if (process.env.NODE_ENV !== "production") console.log("设置歌词行", lines, initialTime);
		this.dataManager.setOriginalLines(lines);
		this.rebuildLyricView(initialTime);
	}
	/**
	* 获取当前是否在播放
	* @returns 当前是否在播放
	*/
	getIsPlaying() {
		return this.isPlaying;
	}
	/**
	* 设置当前播放进度，此时将会更新内部的歌词进度信息。
	*
	* 内部会根据调用间隔和播放进度自动决定应如何滚动和显示歌词，所以此方法的调用频率越快越准确越好。
	* 调用频率较低或进度细度过粗可能会导致歌词显示延迟或导致自动跳转推导错误。
	* 调用完成后，应每帧调用 {@link update} 方法来执行歌词动画效果。此函数本身不会触发动画效果。
	*
	* 当 `isSeek` 为 `true` 时，将强制按跳转处理，并在下次调用 {@link update} 时触发一系列的行为变更，
	* 具体请参考 <https://amll.dev/guides/component/seeking>，因此请只在真正跳转时设为 `true`
	*
	* @param time 当前播放进度，单位为毫秒，非有限值会被静默忽略
	* @param isSeek 是否强制按跳转处理，默认交由内部推导
	* @see {@link setEnableAutoSeekDetection} 自动推导跳转状态的文档
	* @see https://amll.dev/guides/component/sequence#播放进度
	*/
	setCurrentTime(time, isSeek = false) {
		if (!Number.isFinite(time)) return;
		const mediaTime = MediaTime.round(MediaTime.fromMillis(time));
		const isDetectedSeek = this.enableAutoSeekDetection ? this.seekDetector.detect(mediaTime, this.isPlaying) : false;
		this.syncTime(mediaTime, isSeek || isDetectedSeek);
	}
	/**
	* 推进时间线并把增量变化应用到视图上
	* @param mediaTime 当前播放进度
	* @param isSeek 这次进度变化是否为跳转
	*/
	syncTime(mediaTime, isSeek) {
		const wasFocusOnInterlude = this.timelineController.getSnapshot().isFocusOnInterlude;
		const diff = this.timelineController.sync(mediaTime, isSeek);
		this.interludeDots.syncClock(mediaTime);
		if (!diff.hasChanged) return;
		const isTimeJumped = diff.isTimeJumped;
		const snapshot = this.timelineController.getSnapshot();
		for (let i = 0; i < diff.removedHighlighted.length; i++) this.currentLyricGroups[diff.removedHighlighted[i]]?.disable();
		if (isTimeJumped) for (const index of snapshot.highlightedGroups) this.currentLyricGroups[index]?.enable();
		else for (let i = 0; i < diff.addedHighlighted.length; i++) this.currentLyricGroups[diff.addedHighlighted[i]]?.enable();
		if (isTimeJumped) {
			if (!this.scrollState.isTouchScrolled) this.resetScroll();
		} else if ((diff.isScrollToChanged || wasFocusOnInterlude) && !snapshot.isFocusOnInterlude && snapshot.playingGroups.has(snapshot.scrollToIndex) && this.scrollState.isAutoAlignSuspended && this.scrollEngine.canResumeAutoAlign && this.currentLyricGroups[snapshot.scrollToIndex]?.isInRenderRange(false)) this.resetScroll();
		if (diff.isInterludeChanged || diff.isScrollToChanged || diff.isEndOfSongChanged || isTimeJumped) this.updateSpringParams(!!snapshot.activeInterlude, isTimeJumped, snapshot.isEndOfSong);
		this.calcLayout(isTimeJumped ? LayoutReason.Seek : LayoutReason.PlaybackTick);
	}
	/**
	* 重新构建歌词行和时间状态
	*
	* 一般用于在调用 {@link setLyricProcessConfig} 更新配置后手动刷新视图，
	* 或在外部样式/DOM 结构发生改变后重置歌词视图
	*
	* @param initialTime 重建后对齐的初始时间（毫秒），默认使用当前播放进度
	*/
	rebuildLyricView(initialTime = this.getCurrentTime()) {
		this.resetScroll();
		this.focusController.reset();
		if (this.getBottomLineElement().innerHTML.trim().length > 0) this.bottomLine.resetPosition();
		for (const group of this.currentLyricGroups) group.dispose();
		this.currentLyricGroups = [];
		this.interludeDots.clearInterlude(true);
		this.buildLyricGroups();
		this.currentLyricGroups.sort((a, b) => MediaTime.cmp(a.startTime, b.startTime));
		for (let i = 0; i < this.currentLyricGroups.length; i++) this.lyricGroupIndexMap.set(this.currentLyricGroups[i], i);
		const bounds = this.currentLyricGroups.map((group) => ({
			startTime: group.startTime,
			endTime: group.endTime
		}));
		this.timelineController.setTimeBounds(bounds);
		this.layoutCalculator.initHeights(this.currentLyricGroups.length, this.defaultLineHeight);
		this.seekDetector.reset();
		this.setCurrentTime(initialTime, true);
		this.calcLayout(LayoutReason.RebuildView);
		if (process.env.NODE_ENV !== "production") console.log("歌词视图重建完成", this);
	}
	/**
	* 更新歌词纵向滚动动画的弹簧参数。
	*
	* 其策略为：
	* - seeking 或间奏时使用更稳定的固定参数
	* - 普通播放时根据相邻歌词的时间间隔动态调整 stiffness / damping
	* - 播放完毕时使用中速弹簧参数
	*
	* @param isInterludeActive 当前是否命中间奏区间
	* @param isSeeking 本次同步的时间轴是否发生了跳转
	* @param isEndOfSong 歌曲是否播放完毕
	*/
	updateSpringParams(isInterludeActive, isSeeking, isEndOfSong) {
		if (!this.getEnableSpring() || this.currentLyricGroups.length === 0) return;
		const { scrollToIndex } = this.timelineController.getSnapshot();
		const currentGroup = this.currentLyricGroups[scrollToIndex];
		const prevGroup = this.currentLyricGroups[scrollToIndex - 1];
		let interval;
		if (currentGroup && prevGroup) interval = Duration.asMillis(MediaTime.since(currentGroup.startTime, prevGroup.startTime));
		const policy = getPosYSpringPolicy(isSeeking, isInterludeActive, interval, isEndOfSong);
		this.setLinePosYSpringParams(policy);
	}
	/**
	* 重新计算歌词行的几何排版坐标与视觉状态
	*
	* 此方法不会触发 DOM 强制重排
	*
	* 计算完成后，在每一帧调用 `update()` / `commitChanges()` 即可让歌词平滑移动至目标位置
	*
	* @internal 仅供内部和绑定包使用
	* @param reason 触发排版布局更新的原因场景
	*/
	calcLayout(reason) {
		const strategy = LayoutReasonStrategyMap[reason];
		const snapshot = this.timelineController.getSnapshot();
		const interlude = snapshot.activeInterlude;
		let canDisplayInterlude = false;
		if (interlude) canDisplayInterlude = this.interludeDots.setInterlude([interlude.startTime, interlude.endTime], snapshot.currentTime, strategy.resetInterlude, interlude.anchorLineIndex);
		else this.interludeDots.clearInterlude();
		const focalTarget = this.focusController.resolve(snapshot, this.currentLyricGroups.length, {
			isAutoAlignSuspended: this.scrollState.isAutoAlignSuspended,
			hasBottomContent: this.hasBottomContent,
			canDisplayInterlude
		});
		const dotMargin = (this.baseFontSize || 24) * .4;
		const totalInterludeHeight = this.layoutState.interludeDotsSize[1] + dotMargin * 2;
		const ctx = this.frameContext;
		ctx.containerHeight = this.size[1];
		ctx.target = focalTarget;
		ctx.bottomLineHeight = this.bottomLine.lineSize[1] || 0;
		const activeInterludeForLayout = canDisplayInterlude ? interlude : void 0;
		const interludeAnchorIndex = LayoutCalculator.resolveInterludeAnchorIndex(activeInterludeForLayout, focalTarget);
		if (interludeAnchorIndex !== void 0) {
			ctx.interlude = ctx.interlude || {
				totalHeight: 0,
				anchorIndex: 0
			};
			ctx.interlude.totalHeight = totalInterludeHeight;
			ctx.interlude.anchorIndex = interludeAnchorIndex;
		} else ctx.interlude = void 0;
		const { bounds, session } = this.layoutCalculator.beginFrame(ctx, this.layoutConfig);
		ctx.scrollOffset = this.scrollEngine.updateBoundary(bounds.min, bounds.max);
		const result = this.layoutCalculator.commit(session, ctx.scrollOffset);
		if (result.hasInterlude && canDisplayInterlude && interlude) {
			const nextLineIndex = interlude.anchorLineIndex + 1;
			const targetX = this.currentLyricGroups[nextLineIndex]?.mainLine.getLine().isDuet ?? false ? this.size[0] - this.layoutState.interludeDotsSize[0] : 0;
			this.interludeDots.setTransform(targetX, result.interludeY + dotMargin, strategy.snapPosY || !this.getEnableSpring());
		}
		const visual = this.visualFrame;
		visual.latestIndex = snapshot.latestHighlightedIndex ?? snapshot.scrollToIndex;
		visual.passedBoundary = interlude ? interlude.anchorLineIndex + 1 : snapshot.scrollToIndex;
		visual.isNarrowViewport = window.innerWidth <= 1024;
		const activeCount = result.lineCount;
		let delay = Duration.ZERO;
		let baseDelay = strategy.disableStagger ? Duration.ZERO : Duration.fromSecs(.05);
		for (let i = 0; i < activeCount; i++) {
			const group = this.currentLyricGroups[i];
			const instruction = result.lineInstructions[i];
			const curPos = instruction.y;
			const isInViewport = instruction.isInViewport;
			const isActive = this.resolveIsActive(i, snapshot);
			group.setTransform(curPos, strategy.snapPosY, delay, isActive, this.resolveOpacity(i, isInViewport, snapshot), this.resolveBlurLevel(i, isActive, isInViewport, snapshot));
			if (curPos + instruction.height >= 0) {
				delay = Duration.add(delay, baseDelay);
				if (i >= snapshot.scrollToIndex) baseDelay = Duration.mulF64(baseDelay, 1 / 1.05);
			}
		}
		const isBottomFocused = focalTarget.type === "bottom";
		this.bottomLine.setFocused(isBottomFocused);
		this.bottomLine.setTransform(result.bottomLineY, this.resolveBlurLevel(activeCount, isBottomFocused, result.isBottomLineInViewport, snapshot), strategy.snapPosY, delay);
	}
	/**
	* 推导某一行是否处于激活状态
	* @param index 歌词行索引
	* @param snapshot 当前帧的时间线快照
	*/
	resolveIsActive(index, snapshot) {
		return snapshot.highlightedGroups.has(index) || index >= snapshot.scrollToIndex && index < this.visualFrame.latestIndex;
	}
	/**
	* 推导一行的目标透明度
	* @param index 歌词行索引
	* @param isInViewport 该行是否在可视区域内
	* @param snapshot 当前帧的时间线快照
	*/
	resolveOpacity(index, isInViewport, snapshot) {
		if (!isInViewport) return 0;
		if (this.hidePassedLines && this.isPlaying && index < this.visualFrame.passedBoundary) return 1e-4;
		if (snapshot.highlightedGroups.has(index)) return .85;
		return this.isNonDynamic ? .2 : 1;
	}
	/**
	* 按距焦点的行距推导模糊档位
	* @param index 歌词行索引，底栏传入歌词总行数
	* @param isFocused 该目标是否为当前焦点，歌词行传 `isActive`，底栏传是否聚焦底栏
	* @param isInViewport 该目标是否在可视区域内
	* @param snapshot 当前帧的时间线快照
	*/
	resolveBlurLevel(index, isFocused, isInViewport, snapshot) {
		if (!this.enableBlur) return 0;
		if (!isInViewport) return 5;
		if (this.scrollState.isTouchScrolled || isFocused) return 0;
		const scrollToIndex = snapshot.scrollToIndex;
		const level = 1 + (index < scrollToIndex ? Math.abs(scrollToIndex - index) + 1 : Math.abs(index - this.visualFrame.latestIndex));
		return this.visualFrame.isNarrowViewport ? level * .8 : level;
	}
	/**
	* 设置所有歌词行、底栏和间奏点在横坐标上的弹簧属性，包括重量、弹力和阻力。
	*
	* @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
	* @deprecated 考虑到横向弹簧效果并不常见，所以这个函数将会在未来的版本中移除
	*/
	setLinePosXSpringParams(_params = {}) {}
	/**
	* 设置所有歌词行、底栏和间奏点在​纵坐标上的弹簧属性，包括重量、弹力和阻力。
	*
	* @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
	*/
	setLinePosYSpringParams(params = {}) {
		this.posYSpringParams = {
			...this.posYSpringParams,
			...params
		};
		this.bottomLine.lineTransforms.posY.updateParams(this.posYSpringParams);
		this.interludeDots.posY.updateParams(this.posYSpringParams);
		for (const group of this.currentLyricGroups) {
			group.posY.updateParams(this.posYSpringParams);
			group.bgSlideY.updateParams(this.posYSpringParams);
		}
	}
	/**
	* 设置所有歌词行在​缩放大小上的弹簧属性，包括重量、弹力和阻力。
	*
	* @param params 需要设置的弹簧属性，提供的属性将会覆盖原来的属性，未提供的属性将会保持原样
	*/
	setLineScaleSpringParams(params = {}) {
		this.scaleSpringParams = {
			...this.scaleSpringParams,
			...params
		};
		this.scaleForBGSpringParams = {
			...this.scaleForBGSpringParams,
			...params
		};
		for (const group of this.currentLyricGroups) {
			group.mainLine.lineTransforms.scale.updateParams(this.scaleSpringParams);
			group.bgLine?.lineTransforms.scale.updateParams(this.scaleForBGSpringParams);
		}
	}
	/**
	* 暂停部分效果演出，目前会暂停播放间奏点的动画，且将背景歌词显示出来
	*/
	pause() {
		this.interludeDots.pause();
		if (this.isPlaying) {
			this.isPlaying = false;
			this.calcLayout(LayoutReason.ConfigChange);
		}
	}
	/**
	* 恢复部分效果演出，目前会恢复播放间奏点的动画
	*/
	resume() {
		this.interludeDots.resume();
		if (!this.isPlaying) {
			this.isPlaying = true;
			this.calcLayout(LayoutReason.ConfigChange);
		}
	}
	/**
	* 更新动画，这个函数应该被逐帧调用或者在以下情况下调用一次：
	*
	* 1. 刚刚调用完设置歌词函数的时候
	* @param delta 距离上一次被调用到现在的时长，单位为毫秒（可为浮点数）
	*/
	update(delta = 0) {
		const d = Duration.min(Duration.fromMillis(delta), MAX_FRAME_DELTA);
		this.bottomLine.update(d);
		this.interludeDots.update(d);
	}
	onResize() {}
	/**
	* 获取一个特殊的底栏元素，默认是空白的，可以往内部添加任意元素
	*
	* 这个元素始终在歌词的底部，可以用于显示歌曲创作者等信息
	*
	* 但是请勿删除该元素，只能在内部存放元素
	*
	* @returns 一个元素，可以往内部添加任意元素
	*/
	getBottomLineElement() {
		return this.bottomLine.getContentElement?.() ?? this.bottomLine.getElement();
	}
	/**
	* 重置用户滚动状态并恢复自动对齐
	*
	* 一个典型的使用场景是在用户滚动完毕、但歌词未自动归位时立刻归位
	*/
	resetScroll() {
		this.scrollEngine.resetScroll(0);
		this.scrollState.isAutoAlignSuspended = false;
		this.scrollState.isTouchScrolled = false;
	}
	/**
	* 获取当前播放的、未经过优化和掩码处理的歌词数组
	*
	* 一般和最后调用 `setLyricLines` 给予的参数一样
	* @returns 当前歌词数组
	*/
	getLyricLines() {
		return this.dataManager.getRawLines();
	}
	/**
	* 获取当前歌词的播放位置
	*
	* 一般和最后调用 `setCurrentTime` 给予的参数一样
	* @returns 当前播放位置
	*/
	getCurrentTime() {
		return MediaTime.asMillis(this.timelineController.getSnapshot().currentTime);
	}
	/**
	* 设置是否让背景人声行始终后置显示
	*
	* 默认情况下，如果背景歌词开始时间早于主歌词，会在主歌词上方展示；
	* 如果设置为 `true`，则无论时间顺序如何，背景歌词都会始终在主歌词下方展示
	* @param enable 是否启用始终后置
	*/
	setAlwaysPostpositionBackground(enable) {
		if (this.alwaysPostpositionBackground === enable) return;
		this.alwaysPostpositionBackground = enable;
		this.rebuildLyricLines();
		this.calcLayout(LayoutReason.ConfigChange);
	}
	/** 获取当前是否设置了让背景人声行始终后置显示 */
	getAlwaysPostpositionBackground() {
		return this.alwaysPostpositionBackground;
	}
	getElement() {
		return this.element;
	}
	dispose() {
		this.scrollEngine.dispose();
		this.element.remove();
		this.bottomLineObserver.disconnect();
		this.resizeObserver.disconnect();
		this.interludeDots.dispose();
		this.bottomLine.dispose();
		window.removeEventListener("pageshow", this.onPageShow);
		window.removeEventListener("pagehide", this.onPageHide);
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
	}
};
//#endregion
//#region src/utils/derivative.ts
function derivative(f) {
	const h = .001;
	return (x) => (f(x + h) - f(x - h)) / (2 * h);
}
function getVelocity(f) {
	return derivative(f);
}
//#endregion
//#region src/utils/spring.ts
var spring_exports = /* @__PURE__ */ __exportAll({ Spring: () => Spring });
var Spring = class {
	settled = true;
	currentPosition = 0;
	targetPosition = 0;
	currentTime = 0;
	params = {};
	currentSolver;
	getV;
	getV2;
	queueParams;
	queuePosition;
	constructor(currentPosition = 0) {
		this.targetPosition = currentPosition;
		this.currentPosition = this.targetPosition;
		this.currentSolver = () => this.targetPosition;
		this.getV = () => 0;
		this.getV2 = () => 0;
	}
	resetSolver() {
		this.settled = false;
		const curV = this.getV(this.currentTime);
		this.currentTime = 0;
		this.currentSolver = solveSpring(this.currentPosition, curV, this.targetPosition, 0, this.params);
		this.getV = getVelocity(this.currentSolver);
		this.getV2 = getVelocity(this.getV);
	}
	arrived() {
		if (this.settled && !this.queueParams && !this.queuePosition) return true;
		return Math.abs(this.targetPosition - this.currentPosition) < .01 && Math.abs(this.getV(this.currentTime)) < .01 && Math.abs(this.getV2(this.currentTime)) < .01 && this.queueParams === void 0 && this.queuePosition === void 0;
	}
	setPosition(targetPosition) {
		this.settled = true;
		this.targetPosition = targetPosition;
		this.currentPosition = targetPosition;
		this.currentSolver = () => this.targetPosition;
		this.getV = () => 0;
		this.getV2 = () => 0;
	}
	update(delta = Duration.ZERO) {
		if (this.settled && !this.queueParams && !this.queuePosition) return;
		const dt = Duration.asSecsF64(delta);
		this.currentTime += dt;
		this.currentPosition = this.currentSolver(this.currentTime);
		if (this.queueParams) {
			this.queueParams.time -= dt;
			if (this.queueParams.time <= 0) { const params = this.queueParams; this.queueParams = void 0; this.updateParams(params); }
		}
		if (this.queuePosition) {
			this.queuePosition.time -= dt;
			if (this.queuePosition.time <= 0) this.setTargetPosition(this.queuePosition.position);
		}
		if (this.arrived()) this.setPosition(this.targetPosition);
	}
	updateParams(params, delay = Duration.ZERO) {
		const delaySecs = Duration.asSecsF64(delay);
		if (delaySecs > 0) this.queueParams = {
			...this.queuePosition ?? {},
			...params,
			time: delaySecs
		};
		else {
			this.queuePosition = void 0;
			this.params = {
				...this.params,
				...params
			};
			this.resetSolver();
		}
	}
	setTargetPosition(targetPosition, delay = Duration.ZERO) {
		const delaySecs = Duration.asSecsF64(delay);
		if (delaySecs <= 0 && Math.abs(this.targetPosition - targetPosition) < .001) {
			this.queuePosition = void 0;
			return;
		}
		if (delaySecs > 0) this.queuePosition = {
			...this.queuePosition ?? {},
			position: targetPosition,
			time: delaySecs
		};
		else {
			this.queuePosition = void 0;
			this.targetPosition = targetPosition;
			this.resetSolver();
		}
	}
	getCurrentPosition() {
		return this.currentPosition;
	}
};
function solveSpring(from, velocity, to, delay = 0, params) {
	const soft = params?.soft ?? false;
	const stiffness = params?.stiffness ?? 100;
	const damping = params?.damping ?? 10;
	const mass = params?.mass ?? 1;
	const delta = to - from;
	if (soft || 1 <= damping / (2 * Math.sqrt(stiffness * mass))) {
		const angular_frequency = -Math.sqrt(stiffness / mass);
		const leftover = -angular_frequency * delta - velocity;
		return (t) => {
			t -= delay;
			if (t < 0) return from;
			return to - (delta + t * leftover) * Math.E ** (t * angular_frequency);
		};
	}
	const damping_frequency = Math.sqrt(4 * mass * stiffness - damping ** 2);
	const leftover = (damping * delta - 2 * mass * velocity) / damping_frequency;
	const dfm = .5 * damping_frequency / mass;
	const dm = -(.5 * damping) / mass;
	return (t) => {
		t -= delay;
		if (t < 0) return from;
		return to - (Math.cos(t * dfm) * delta + Math.sin(t * dfm) * leftover) * Math.E ** (t * dm);
	};
}
//#endregion
//#region src/lyric-player/dom/bottom-line.ts
/**
* 底栏组件的 DOM 实现
*
* 一个始终位于歌词底部的空白容器元素，外部可经由播放器的
* getBottomLineElement 获取元素并添加歌曲创作者等内容
*/
var BottomLineEl = class {
	lyricPlayer;
	element = document.createElement("div");
	contentElement = document.createElement("div");
	top = 0;
	isFocused = false;
	blur = 0;
	lastTransformStyle = "";
	lastFilterStyle = "";
	lineTransforms = { posY: new Spring(0) };
	/**
	* 底栏当前测量得到的尺寸
	*
	* 由播放器的 ResizeObserver 回调写入
	*/
	lineSize = [0, 0];
	constructor(lyricPlayer) {
		this.lyricPlayer = lyricPlayer;
		this.element.setAttribute("class", `${lyric_player_module_default.lyricLineWrapper} ${lyric_player_module_default.bottomLineWrapper}`);
		this.contentElement.setAttribute("class", `${lyric_player_module_default.lyricLine} ${lyric_player_module_default.bottomLine}`);
		this.contentElement.dataset.bottomLine = "true";
		this.element.appendChild(this.contentElement);
		this.rebuildStyle();
	}
	getElement() {
		return this.element;
	}
	getContentElement() {
		return this.contentElement;
	}
	resetPosition() {
		this.lineTransforms.posY.setPosition(window.innerHeight * 2);
		this.rebuildStyle();
	}
	/**
	* 设置底栏是否处于聚焦状态
	*
	* 一般在歌曲播放完毕且底栏有内容时聚焦到底栏并设为 true
	*/
	setFocused(focused) {
		if (this.isFocused !== focused) {
			this.isFocused = focused;
			this.contentElement.classList.toggle(lyric_player_module_default.gradientMask, focused);
			if (focused) this.element.dataset.focused = "true";
			else delete this.element.dataset.focused;
		}
	}
	setTransform(top = this.top, blur = 0, immediate = false, delay = Duration.ZERO) {
		this.top = top;
		if (immediate || !this.lyricPlayer.getEnableSpring()) {
			this.blur = Math.min(32, blur);
			if (immediate) this.element.classList.add(lyric_player_module_default.tmpDisableTransition);
			this.lineTransforms.posY.setPosition(top);
			this.rebuildStyle();
			if (immediate) requestAnimationFrame(() => {
				this.element.classList.remove(lyric_player_module_default.tmpDisableTransition);
			});
		} else {
			this.blur = Math.min(5, blur);
			this.lineTransforms.posY.setTargetPosition(top, delay);
		}
	}
	/**
	* 逐帧推进弹簧动画并应用样式
	* @param delta 距离上一次调用的时长
	*/
	update(delta = Duration.ZERO) {
		if (!this.lyricPlayer.getEnableSpring()) return;
		this.lineTransforms.posY.update(delta);
		this.rebuildStyle();
	}
	/**
	* 将弹簧当前位置与模糊值写入内联样式
	*/
	rebuildStyle() {
		const style = this.element.style;
		const transformStr = `translate(0px, ${this.lineTransforms.posY.getCurrentPosition().toFixed(2)}px)`;
		if (this.lastTransformStyle !== transformStr) {
			this.lastTransformStyle = transformStr;
			style.transform = transformStr;
		}
		const blurVal = Math.min(5, this.blur);
		const filterStr = blurVal > .01 ? `blur(${blurVal.toFixed(2)}px)` : "none";
		if (this.lastFilterStyle !== filterStr) {
			this.lastFilterStyle = filterStr;
			style.filter = filterStr;
		}
	}
	dispose() {
		this.element.remove();
	}
};
//#endregion
//#region src/lyric-player/base/interlude-dots.ts
const DOT3_TRAILING_MS = 750;
const EXIT_PHASE1_MS = 750;
const EXIT_PHASE2_MS = 250;
const EXIT_TOTAL_MS = 1e3;
const EXIT_FADE_MS = 250;
const DISMISS_FADE_MS = 150;
/**
* 非前奏或 Seek 时的入场延迟
*
* 用于给歌词行上移或跳转排版腾出视觉缓冲时间
*/
const ENTER_HOLD_MS = 500;
const ENTER_FADE_MS = 180;
const DOT_ENTER_FADE_MS = 750;
const DOT_ENTER_STAGGER_MS = 80;
/**
* 三颗圆点错峰完全淡入所需的时长 (80 * 2 + 750 = 910ms)
*/
const DOT_ENTER_TOTAL_MS = 910;
const BREATHE_BASE_PERIOD_MS = 4e3;
const FALLBACK_HOLD_THRESHOLD_MS = 3e3;
const BREATHE_MAX_SCALE = 1.25;
const DOT_INACTIVE_OPACITY = .2;
const DOT_COUNT = 3;
const lightingEasing = bezier(.56, .01, .45, 1);
const enterFadeEasing = bezier(.59, .02, .07, 1);
const exitPhase1Easing = bezier(.14, .06, .25, 1);
const exitPhase2Easing = bezier(.29, .03, 1, .38);
const exitFadeEasing = bezier(.43, .08, .83, .31);
/**
* 间奏消失时派发的合成快照，用于让子类收起渲染物
*/
const HIDDEN_SNAPSHOT = {
	isActive: false,
	dotOpacities: [
		0,
		0,
		0
	],
	scale: 1,
	opacity: 0
};
var InterludeDotsBase = class {
	left = 0;
	top = 0;
	posY = new Spring(0);
	/**
	* 下一次设置变换位置时是否直接吸附到目标位置
	*
	* 演出重建或位置跳变时新旧坐标可能相距很远，走弹簧会看到间奏点从旧位置滑入的残影
	*/
	shouldSnapPosY = true;
	currentTime = MediaTime.ZERO;
	playing = true;
	phase = "idle";
	mode = "breathe";
	fadeElapsedMs = 0;
	fadeInitialOpacity = 0;
	startTime = MediaTime.ZERO;
	endTime = MediaTime.ZERO;
	anchorTime = MediaTime.ZERO;
	delayEndMs = 0;
	bodyEndMs = 0;
	totalEndMs = 0;
	breathePeriodMs = BREATHE_BASE_PERIOD_MS;
	segmentMs = 0;
	dot3DurationMs = 0;
	dot3Target = 0;
	mutDotOpacities = [
		0,
		0,
		0
	];
	snapshot = {
		isActive: true,
		dotOpacities: this.mutDotOpacities,
		scale: 1,
		opacity: 0
	};
	/**
	* 设置间奏区间并锚定演出时间
	*
	* @param interlude 间奏起止时间
	* @param currentTime 当前播放时间，用于把演出重锚到该时刻；未传入时使用间奏起点
	* @param forceReset 是否强制重建演出，如跳转播放进度或重建歌词视图时
	* @param anchorLineIndex 间奏锚定的歌词行索引
	* @returns 本次间奏是否有足够时长显示间奏点
	*/
	setInterlude(interlude, currentTime, forceReset = false, anchorLineIndex = 0) {
		const [startTime, endTime] = interlude;
		const isSameInterlude = this.startTime === startTime && this.endTime === endTime;
		if (!forceReset && isSameInterlude && this.phase !== "fading") return this.phase === "performing";
		this.cancelFadeOut();
		this.startTime = startTime;
		this.endTime = endTime;
		this.currentTime = currentTime ?? startTime;
		if (forceReset) {
			this.anchorTime = this.currentTime;
			this.delayEndMs = ENTER_HOLD_MS;
		} else {
			this.anchorTime = startTime;
			this.delayEndMs = anchorLineIndex === -1 ? 0 : ENTER_HOLD_MS;
		}
		const bodyMs = Math.max(0, Duration.asMillis(MediaTime.since(endTime, this.anchorTime))) - this.delayEndMs - EXIT_TOTAL_MS;
		if (bodyMs < DOT_ENTER_TOTAL_MS) {
			this.hidePerformance();
			return false;
		}
		this.bodyEndMs = this.delayEndMs + bodyMs;
		this.totalEndMs = this.bodyEndMs + EXIT_TOTAL_MS;
		let mode;
		if (bodyMs < FALLBACK_HOLD_THRESHOLD_MS) {
			mode = "fallback-hold";
			this.dot3Target = 1;
		} else {
			mode = "breathe";
			const breatheCycles = Math.max(1, Math.floor(bodyMs / BREATHE_BASE_PERIOD_MS));
			this.breathePeriodMs = bodyMs / breatheCycles;
			this.segmentMs = Math.round((bodyMs + DOT3_TRAILING_MS) / DOT_COUNT);
			this.dot3DurationMs = bodyMs - this.segmentMs * 2;
			this.dot3Target = this.dot3DurationMs / this.segmentMs;
		}
		this.enterPerforming(mode);
		return true;
	}
	/**
	* 清空间奏区间并终止当前演出
	*
	* 与 {@link dismiss} 的区别在于本方法会一并抹去区间状态，
	* 使此后重新进入同一间奏区间时能够重新演出
	*
	* @param immediate 是否立即隐藏而非淡出
	*/
	clearInterlude(immediate = false) {
		this.startTime = MediaTime.ZERO;
		this.endTime = MediaTime.ZERO;
		this.dismiss(immediate);
	}
	/**
	* 结束间奏点演出，默认使用 150ms 淡出
	* @param immediate 是否立即隐藏
	*/
	dismiss(immediate = false) {
		if (this.phase === "idle") return;
		if (immediate || !this.playing) {
			this.cancelFadeOut();
			this.hidePerformance();
			return;
		}
		if (this.phase === "fading") return;
		if (this.snapshot.opacity <= 0) {
			this.hidePerformance();
			return;
		}
		this.enterFading();
	}
	/**
	* 设置间奏点的变换位置并立即刷新一次
	* @param left 横向位置
	* @param top 纵向位置
	* @param immediate 是否绕过弹簧直接跳转到目标位置，用于触摸拖动等需要跟手的场景
	*/
	setTransform(left = this.left, top = this.top, immediate = false) {
		this.left = left;
		this.top = top;
		if (!immediate && this.phase !== "idle" && !this.shouldSnapPosY) this.posY.setTargetPosition(top);
		else {
			this.shouldSnapPosY = false;
			this.posY.setPosition(top);
		}
		this.update();
	}
	pause() {
		this.playing = false;
		if (this.phase === "fading") this.hidePerformance();
	}
	resume() {
		this.playing = true;
	}
	/**
	* 把演出时钟对齐到指定的媒体时间，由宿主每次推送播放进度时调用
	*/
	syncClock(time) {
		this.currentTime = time;
	}
	/**
	* 逐帧推进演出并把当前帧交给子类渲染
	* @param delta 距离上一次调用的物理时长
	*/
	update(delta = Duration.ZERO) {
		if (this.phase === "idle") return;
		if (this.phase === "fading") {
			this.updateFadeOut(delta);
			return;
		}
		if (this.playing) this.currentTime = MediaTime.add(this.currentTime, delta);
		const elapsed = Duration.max(Duration.ZERO, MediaTime.since(this.currentTime, this.anchorTime));
		const snapshot = this.resolveSnapshot(elapsed);
		this.posY.update(delta);
		this.render(snapshot, this.left, this.posY.getCurrentPosition());
		if (!snapshot.isActive) this.enterIdle();
	}
	/**
	* 释放演出状态
	*/
	dispose() {
		this.dismiss(true);
	}
	/**
	* 进入演出阶段并确定编排方式
	*
	* 演出重建后的第一帧位置由外部重新给出，不参与弹簧过渡，
	* 因此一并重置 {@link shouldSnapPosY}
	*/
	enterPerforming(mode) {
		this.mode = mode;
		this.phase = "performing";
		this.shouldSnapPosY = true;
	}
	/**
	* 进入淡出阶段，冻结当前帧的不透明度作为衰减起点
	*/
	enterFading() {
		this.fadeElapsedMs = 0;
		this.fadeInitialOpacity = this.snapshot.opacity;
		this.phase = "fading";
	}
	/**
	* 结束演出，回到既不推进时钟也不渲染的静止状态
	*/
	enterIdle() {
		this.phase = "idle";
	}
	/**
	* 取消正在进行的淡出
	*
	* 只清掉淡出阶段，演出阶段保持原样，随后的收尾仍需据此判断
	* 是否有可见内容要派发隐藏快照
	*/
	cancelFadeOut() {
		if (this.phase === "fading") this.enterIdle();
	}
	/**
	* 演出被取消时立即隐藏渲染物并清空演出状态
	*/
	hidePerformance() {
		const wasActive = this.phase !== "idle";
		this.enterIdle();
		if (wasActive) this.render(HIDDEN_SNAPSHOT, this.left, this.posY.getCurrentPosition());
	}
	/**
	* 写入三颗圆点当前帧的不透明度
	*
	* 最终不透明度由点亮分数映射的透明度与各圆点的错峰入场系数相乘得到
	*
	* @param internalMs 距演出开始的经过时间
	* @param fractions 三颗圆点各自的点亮分数（0~1）
	*/
	writeDotOpacities(internalMs, fractions) {
		this.mutDotOpacities[0] = dotOpacity(fractions[0]) * dotEnterAlpha(0, internalMs);
		this.mutDotOpacities[1] = dotOpacity(fractions[1]) * dotEnterAlpha(1, internalMs);
		this.mutDotOpacities[2] = dotOpacity(fractions[2]) * dotEnterAlpha(2, internalMs);
	}
	/**
	* 物理淡出步进器
	*/
	updateFadeOut(delta) {
		this.fadeElapsedMs += Duration.asMillis(delta);
		const progress = clamp01(this.fadeElapsedMs / DISMISS_FADE_MS);
		if (progress >= 1) {
			this.hidePerformance();
			return;
		}
		this.snapshot.opacity = this.fadeInitialOpacity * (1 - exitFadeEasing(progress));
		this.snapshot.isActive = true;
		this.posY.update(delta);
		this.render(this.snapshot, this.left, this.posY.getCurrentPosition());
	}
	/**
	* 按经过时间求出该时刻的视觉状态
	*
	* @remarks 返回的快照对象是内部复用的同一引用，必须在当前帧内消费完毕
	* @param elapsed 距离本次演出时间锚点的经过时间
	*/
	resolveSnapshot(elapsed) {
		const elapsedMs = Duration.asMillis(elapsed);
		if (elapsedMs >= this.totalEndMs) {
			this.snapshot.isActive = false;
			this.snapshot.scale = 1;
			this.snapshot.opacity = 0;
			this.mutDotOpacities[0] = 0;
			this.mutDotOpacities[1] = 0;
			this.mutDotOpacities[2] = 0;
			return this.snapshot;
		}
		this.snapshot.isActive = true;
		if (elapsedMs < this.delayEndMs) {
			this.snapshot.opacity = 0;
			this.snapshot.scale = 1;
			this.mutDotOpacities[0] = 0;
			this.mutDotOpacities[1] = 0;
			this.mutDotOpacities[2] = 0;
			return this.snapshot;
		}
		const internalMs = elapsedMs - this.delayEndMs;
		const fractionAt = (startDelay, duration, target) => computeDotFraction(startDelay, duration, internalMs, target);
		if (elapsedMs >= this.bodyEndMs) {
			const exitElapsedMs = elapsedMs - this.bodyEndMs;
			const fadeT = clamp01((exitElapsedMs - 750) / EXIT_FADE_MS);
			this.snapshot.opacity = enterOpacity(internalMs) * (1 - exitFadeEasing(fadeT));
			if (exitElapsedMs < EXIT_PHASE1_MS) this.snapshot.scale = 1 + exitPhase1Easing(exitElapsedMs / EXIT_PHASE1_MS) * .25;
			else {
				const phase2T = clamp01((exitElapsedMs - EXIT_PHASE1_MS) / EXIT_PHASE2_MS);
				this.snapshot.scale = BREATHE_MAX_SCALE - exitPhase2Easing(phase2T) * .85;
			}
			const trailing = clamp01(exitElapsedMs / DOT3_TRAILING_MS);
			this.writeDotOpacities(internalMs, [
				1,
				1,
				this.dot3Target + (1 - this.dot3Target) * trailing
			]);
			return this.snapshot;
		}
		this.snapshot.opacity = enterOpacity(internalMs);
		if (this.mode === "fallback-hold") {
			this.snapshot.scale = 1;
			this.writeDotOpacities(internalMs, [
				1,
				1,
				1
			]);
			return this.snapshot;
		}
		const progress = breathingProgress(internalMs % this.breathePeriodMs / this.breathePeriodMs);
		this.snapshot.scale = progress <= .5 ? 1 + progress / .5 * .25 : BREATHE_MAX_SCALE - (progress - .5) / .5 * .25;
		this.writeDotOpacities(internalMs, [
			fractionAt(0, this.segmentMs, 1),
			fractionAt(this.segmentMs, this.segmentMs, 1),
			fractionAt(this.segmentMs * 2, this.dot3DurationMs, this.dot3Target)
		]);
		return this.snapshot;
	}
};
/**
* 容器呼吸式缩放的曲线
*/
function breathingProgress(t) {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const angle = 4 * Math.PI * t;
	const s = Math.sin(angle);
	const c = Math.cos(angle);
	return t - .084 * s + .008 * (1 - c) + .0046 * s * (c - s);
}
/**
* 将点亮分数（0~1）映射为圆点透明度，在未点亮与全亮之间线性插值
*/
function dotOpacity(fraction) {
	return DOT_INACTIVE_OPACITY + .7 * clamp01(fraction);
}
/**
* 容器行的入场淡入系数
*
* 演出开始后的前 `ENTER_FADE_MS` 内从 0 升到 1，之后恒为 1
*/
function enterOpacity(internalMs) {
	return enterFadeEasing(clamp01(internalMs / ENTER_FADE_MS));
}
/**
* 某颗圆点的入场淡入系数
*
* 每颗圆点使用 `DOT_ENTER_STAGGER_MS` 错峰淡入，各自在 `DOT_ENTER_FADE_MS`
* 内从 0 升到 1
*
* @param index 圆点序号（0 起），决定错峰延迟
* @param internalMs 距演出开始的经过时间
*/
function dotEnterAlpha(index, internalMs) {
	const t = clamp01((internalMs - index * DOT_ENTER_STAGGER_MS) / DOT_ENTER_FADE_MS);
	return t * t;
}
/**
* 计算单颗圆点在给定时刻的点亮分数
*
* @param startDelay 该圆点的开始延迟（依次为 0、segment、2 * segment）
* @param duration 该圆点的点亮时长（圆点 3 应短于前两颗）
* @param internalMs 距演出开始的经过时间
* @param target 点亮完成目标
*/
function computeDotFraction(startDelay, duration, internalMs, target) {
	if (internalMs <= startDelay) return 0;
	const localT = (internalMs - startDelay) / duration;
	return lightingEasing(clamp01(localT)) * target;
}
//#endregion
//#region src/lyric-player/dom/interlude-dots.ts
var InterludeDotsEl = class extends InterludeDotsBase {
	element = document.createElement("div");
	dot0 = document.createElement("span");
	dot1 = document.createElement("span");
	dot2 = document.createElement("span");
	lastStyle = "";
	constructor() {
		super();
		this.element.className = lyric_player_module_default.interludeDots;
		this.element.appendChild(this.dot0);
		this.element.appendChild(this.dot1);
		this.element.appendChild(this.dot2);
		this.element.style.opacity = "0";
	}
	getElement() {
		return this.element;
	}
	render(snapshot, left, top) {
		const curStyle = `transform:translate(${left.toFixed(2)}px, ${top.toFixed(2)}px) scale(${snapshot.scale.toFixed(4)});opacity:${snapshot.opacity.toFixed(3)}`;
		this.dot0.style.opacity = snapshot.dotOpacities[0].toFixed(3);
		this.dot1.style.opacity = snapshot.dotOpacities[1].toFixed(3);
		this.dot2.style.opacity = snapshot.dotOpacities[2].toFixed(3);
		if (this.lastStyle !== curStyle) {
			this.element.setAttribute("style", curStyle);
			this.lastStyle = curStyle;
		}
	}
	dispose() {
		super.dispose();
		this.element.remove();
	}
};
//#endregion
//#region src/lyric-player/base/group.ts
var LyricLineGroupBase = class {
	mainLine;
	bgLine;
	posY = new Spring(0);
	bgSlideY = new Spring(-80);
	top = 0;
	delay = Duration.ZERO;
	isActive = false;
	opacity = 1;
	blur = 0;
	isBgFirst = false;
	isUiDirty = true;
	constructor(mainLine, bgLine) {
		this.mainLine = mainLine;
		this.bgLine = bgLine;
	}
	get startTime() {
		return MediaTime.fromMillis(this.mainLine.getLine().startTime);
	}
	get endTime() {
		return MediaTime.fromMillis(this.mainLine.getLine().endTime);
	}
	onLineSizeChange(size) {
		this.mainLine.onLineSizeChange(size);
		this.bgLine?.onLineSizeChange(size);
	}
	setTransform(top, immediate, delay, isActive, opacity, blur) {
		this.top = top;
		this.delay = delay;
		this.isActive = isActive;
		this.opacity = opacity;
		this.blur = blur;
		this.setLineTransformations(delay);
		const enableSpring = this.lyricPlayer.getEnableSpring();
		const hiddenSlideY = (this.lyricPlayer.getAlwaysPostpositionBackground() ? false : this.isBgFirst) ? 80 : -80;
		const isPlaying = this.lyricPlayer.getIsPlaying();
		const targetBgSlideY = isActive || !isPlaying ? 0 : hiddenSlideY;
		if (immediate || !enableSpring) {
			this.posY.setPosition(top);
			this.bgSlideY.setPosition(targetBgSlideY);
		} else {
			this.posY.setTargetPosition(top, delay);
			this.bgSlideY.setTargetPosition(targetBgSlideY, delay);
		}
		this.isUiDirty = true;
	}
	setLineTransformations(delay) {
		const enableScale = this.lyricPlayer.getEnableScale();
		const isPlaying = this.lyricPlayer.getIsPlaying();
		const renderMode = this.isActive ? LyricLineRenderMode.GRADIENT : LyricLineRenderMode.SOLID;
		const SCALE_ASPECT = enableScale ? 97 : 100;
		let mainScale = 100;
		if (!this.isActive && isPlaying) mainScale = SCALE_ASPECT;
		this.mainLine.setTransform(mainScale, 1, 0, delay, renderMode);
		let bgScale = 100;
		if (!this.isActive && isPlaying) bgScale = 75;
		this.bgLine?.setTransform(bgScale, 1, 0, delay, renderMode);
	}
	update(delta = Duration.ZERO) {
		if (this.lyricPlayer.getEnableSpring()) {
			const posMoving = !this.posY.arrived();
			const bgMoving = !this.bgSlideY.arrived();
			this.posY.update(delta);
			this.bgSlideY.update(delta);
			if (posMoving || bgMoving) this.isUiDirty = true;
		}
		this.mainLine.update(delta);
		this.bgLine?.update(delta);
	}
	commitChanges() {
		if (!this.isInRenderRange()) return;
		if (this.isUiDirty) {
			this.renderStyles();
			this.isUiDirty = false;
		}
		this.mainLine.commitChanges();
		this.bgLine?.commitChanges();
	}
	rebuildAllLines() {
		this.mainLine.rebuildElement();
		this.bgLine?.rebuildElement();
	}
	enable(time, shouldPlay) {
		this.mainLine.enable(time, shouldPlay);
		this.bgLine?.enable(time, shouldPlay);
	}
	disable() {
		this.mainLine.disable();
		this.bgLine?.disable();
	}
	dispose() {
		this.mainLine.dispose();
		this.bgLine?.dispose();
	}
};
//#endregion
//#region src/lyric-player/dom/lyric-group.ts
var LyricLineGroup = class extends LyricLineGroupBase {
	lyricPlayer;
	element;
	bgWrapper;
	lastIsActive;
	lastBgHeight = 0;
	lastBgIsHidden;
	lastYNum = -9999;
	lastOpacityNum = -1;
	lastBlurNum = -1;
	lastBgSlideYNum = -9999;
	constructor(lyricPlayer, mainLine) {
		super(mainLine);
		this.lyricPlayer = lyricPlayer;
		this.element = document.createElement("div");
		this.element.className = lyric_player_module_default.lyricLineWrapper;
		if (mainLine.getLine().isDuet) this.element.classList.add(lyric_player_module_default.isDuetWrapper);
		this.element.appendChild(mainLine.getElement());
		this.posY.setPosition(window.innerHeight * 2);
		lyricPlayer.resizeObserver.observe(this.element);
	}
	getElement() {
		return this.element;
	}
	isInRenderRange(includeOverscan = true) {
		const top = this.posY.getCurrentPosition();
		const index = this.lyricPlayer.lyricGroupIndexMap.get(this) ?? -1;
		const height = index !== -1 ? this.lyricPlayer.getLineHeight(index) : this.lyricPlayer.defaultLineHeight;
		const viewportHeight = this.lyricPlayer.size[1];
		if (viewportHeight <= 0 || height <= 0) return false;
		const overscan = includeOverscan ? this.lyricPlayer.getOverscanPx() : 0;
		return top < viewportHeight + overscan && top + height > -overscan;
	}
	show() {
		if (!this.element.parentElement) {
			const cached = this.lyricPlayer.detachedGroups; const index = cached.indexOf(this); if (index >= 0) cached.splice(index, 1);
			const playerEl = this.lyricPlayer.getElement();
			const groups = this.lyricPlayer.currentLyricGroups;
			const myIndex = this.lyricPlayer.lyricGroupIndexMap.get(this) ?? -1;
			let referenceNode = null;
			if (myIndex !== -1) {
				for (let i = myIndex + 1; i < groups.length; i++) if (groups[i].element.parentElement === playerEl) {
					referenceNode = groups[i].element;
					break;
				}
			}
			playerEl.insertBefore(this.element, referenceNode);
			this.lyricPlayer.resizeObserver.observe(this.element);
			if (this.bgWrapper) this.lyricPlayer.resizeObserver.observe(this.bgWrapper);
		}
		const entering = !this.wasVisible; this.wasVisible = true;
		this.mainLine.show();
		this.bgLine?.show();
		if (entering) { if(this.mainLine.isEnabled) this.mainLine.enable(); if(this.bgLine?.isEnabled) this.bgLine.enable(); }
	}
	hide() {
		this.wasVisible = false;
		if (this.element.parentElement) {
       this.mainLine.pause(); this.bgLine?.pause();
       const cached = this.lyricPlayer.detachedGroups; cached.push(this);
       if (cached.length > 12) { const old = cached.shift(); old.mainLine.release(); old.bgLine?.release(); }
    
			this.lyricPlayer.resizeObserver.unobserve(this.element);
			if (this.bgWrapper) this.lyricPlayer.resizeObserver.unobserve(this.bgWrapper);
			this.element.remove();
		}
	}
	update(delta = Duration.ZERO) {
		super.update(delta);
	}
	commitChanges() {
		if (this.isInRenderRange()) {
			this.show();
			super.commitChanges();
		} else this.hide();
	}
	onBgSizeChange(size) {
		if (this.bgWrapper && this.lastBgHeight !== size[1]) {
			this.lastBgHeight = size[1];
			this.lastBgSlideYNum = -9999;
			this.isUiDirty = true;
		}
	}
	addBgLine(bgLine) {
		if (this.bgLine) this.bgLine.dispose();
		if (this.bgWrapper) this.bgWrapper.remove();
		this.bgLine = bgLine;
		const bgStartTime = bgLine.getLine().words[0]?.startTime ?? bgLine.getLine().startTime;
		const mainStartTime = this.mainLine.getLine().words[0]?.startTime ?? this.mainLine.getLine().startTime;
		this.isBgFirst = bgStartTime < mainStartTime;
		if (this.mainLine.getLine().isDuet) {
			bgLine.getElement().classList.add(lyric_player_module_default.lyricDuetLine);
			this.element.classList.add(lyric_player_module_default.isDuetWrapper);
		}
		this.bgWrapper = document.createElement("div");
		this.bgWrapper.className = lyric_player_module_default.bgWrapper;
		this.bgWrapper.appendChild(bgLine.getElement());
		if (!this.lyricPlayer.getAlwaysPostpositionBackground() && this.isBgFirst) {
			this.bgWrapper.classList.add(lyric_player_module_default.bgWrapperTop);
			this.element.insertBefore(this.bgWrapper, this.mainLine.getElement());
			this.bgSlideY.setPosition(80);
		} else this.element.appendChild(this.bgWrapper);
		this.lyricPlayer.lyricGroupElementMap.set(this.bgWrapper, this);
		if (this.element.parentElement) this.lyricPlayer.resizeObserver.observe(this.bgWrapper);
		this.lastBgHeight = this.bgWrapper.clientHeight || 0;
	}
	renderStyles() {
		const style = this.element.style;
		const currentY = this.posY.getCurrentPosition();
		if (Math.abs(currentY - this.lastYNum) >= .001) {
			this.lastYNum = currentY;
			style.transform = `translateY(${currentY.toFixed(1)}px)`;
		}
		if (Math.abs(this.opacity - this.lastOpacityNum) >= .05) {
			this.lastOpacityNum = this.opacity;
			style.opacity = String(this.opacity);
		}
		const blurVal = Math.min(5, this.blur);
		if (Math.abs(blurVal - this.lastBlurNum) >= .05) {
			this.lastBlurNum = blurVal;
			style.filter = blurVal > .01 ? `blur(${blurVal.toFixed(2)}px)` : "none";
		}
		if (this.bgWrapper) {
			if (this.lastIsActive !== this.isActive) {
				this.lastIsActive = this.isActive;
				this.bgWrapper.classList.toggle(lyric_player_module_default.bgWrapperActive, this.isActive);
			}
			const bgStyle = this.bgWrapper.style;
			const slideY = this.bgSlideY.getCurrentPosition();
			if (Math.abs(slideY - this.lastBgSlideYNum) >= .001) {
				this.lastBgSlideYNum = slideY;
				const activeProgress = clamp01(1 - Math.abs(slideY) / 80);
				const scaleStr = (.8 + activeProgress * .2).toFixed(3);
				const shouldBgFirst = !this.lyricPlayer.getAlwaysPostpositionBackground() && this.isBgFirst;
				const translateYPx = slideY / 100 * this.lastBgHeight;
				if (shouldBgFirst) bgStyle.marginTop = `${(-this.lastBgHeight * (1 - activeProgress)).toFixed(1)}px`;
				else bgStyle.marginTop = "";
				bgStyle.transform = `translateY(${translateYPx.toFixed(1)}px) scale(${scaleStr})`;
				const isHidden = Math.abs(slideY - (shouldBgFirst ? 80 : -80)) < .1 && !this.isActive;
				if (this.lastBgIsHidden !== isHidden) {
					this.lastBgIsHidden = isHidden;
					this.bgWrapper.classList.toggle(lyric_player_module_default.bgWrapperHidden, isHidden);
				}
			}
		}
	}
	dispose() {
		super.dispose();
		this.lyricPlayer.resizeObserver.unobserve(this.element);
		if (this.bgWrapper) {
			this.lyricPlayer.lyricGroupElementMap.delete(this.bgWrapper);
			this.lyricPlayer.resizeObserver.unobserve(this.bgWrapper);
		}
		this.element.remove();
	}
};
//#endregion
//#region src/utils/is-cjk.ts
const isCJK = (char) => {
	return /^[\p{Unified_Ideograph}\u0800-\u9FFC]+$/u.test(char);
};
//#endregion
//#region src/lyric-player/base/line.ts
/**
* 所有标准歌词行的基类
* @internal
*/
var LyricLineBase = class extends EventTarget {
	top = 0;
	scale = 1;
	blur = 0;
	opacity = 1;
	delay = Duration.ZERO;
	isUiDirty = true;
	lineTransforms = { scale: new Spring(100) };
	/**
	* 用于 CJK 词语边界检测的分词器
	*/
	static wordSegmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(void 0, { granularity: "word" }) : null;
	/**
	* Unicode 标准的全局 Grapheme Cluster 分词器
	* 用于正确处理 emoji、复合字符等
	*/
	static graphemeSegmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(void 0, { granularity: "grapheme" }) : null;
	setTransform(scale = this.scale, opacity = this.opacity, blur = this.blur, delay = Duration.ZERO, _mode = LyricLineRenderMode.SOLID) {
		this.scale = scale;
		this.opacity = opacity;
		this.blur = blur;
		this.delay = delay;
		this.isUiDirty = true;
	}
	rebuildElement() {}
	/**
	* 判定歌词是否可以应用强调辉光效果
	*
	* 果子在对辉光效果的解释是一种强调（emphasized）效果
	*
	* 条件是一个单词时长大于等于 1s 且长度小于等于 7
	*
	* @param word 单词
	* @returns 是否可以应用强调辉光效果
	*/
	static shouldEmphasize(word) {
		if (isCJK(word.word)) return word.endTime - word.startTime >= 1e3;
		return word.endTime - word.startTime >= 1e3 && word.word.trim().length <= 7 && word.word.trim().length > 1;
	}
	dispose() {}
};
//#endregion
//#region src/utils/lyric-line-break.ts
/**
* 单个词超过容器宽度时的大惩罚倍数
*/
const OVERFLOW_PENALTY_MULTIPLIER = 1e3;
/**
* 截断 CJK 词组边界的惩罚比例
*
* 相对于容器宽度
*/
const CJK_BREAK_PENALTY_RATIO = .15;
/**
* 截断普通文本（非空格、非 CJK 词界）的惩罚比例
*/
const NORMAL_BREAK_PENALTY_RATIO = .5;
/**
* 在空格处断开的奖励比例
*/
const SPACE_BREAK_REWARD_RATIO = .4;
/**
* 在标点符号处断开的奖励比例
*
* 比空格更高以便优先一点在标点处换行
*/
const PUNCTUATION_BREAK_REWARD_RATIO = .6;
const PUNCTUATION_REGEX = /[,.;:!?，。；：！？、）】》」』’”)[\]}>~…]$/;
/**
* 计算平均行长度的断点位置
* @param children 子节点信息
* @param containerWidth 容器可用内容宽度
* @param fullText 完整的行文本
* @param segmenter 预创建的 Intl.Segmenter 分词器
* @returns 需要在其前面插入 `<br>` 的子节点索引数组，升序
*/
function calcBalancedBreaks(children, containerWidth, fullText, segmenter) {
	const n = children.length;
	if (n === 0 || containerWidth <= 0) return [];
	const cjkBoundaries = /* @__PURE__ */ new Set();
	let offset = 0;
	for (const { segment, isWordLike } of segmenter.segment(fullText)) {
		if (offset > 0 && isWordLike) {
			if ([...segment].some((ch) => isCJK(ch))) cjkBoundaries.add(offset);
		}
		offset += segment.length;
	}
	const charOffsets = new Int32Array(n + 1);
	const prefixWidth = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) {
		charOffsets[i + 1] = charOffsets[i] + children[i].text.length;
		prefixWidth[i + 1] = prefixWidth[i] + children[i].width;
	}
	if (prefixWidth[n] <= containerWidth) return [];
	/**
	* dp[i] 表示将 index i 到 n-1 的节点进行排版的最小代价
	*/
	const dp = new Float64Array(n + 1).fill(Number.POSITIVE_INFINITY);
	const nextBreak = new Int32Array(n + 1).fill(-1);
	dp[n] = 0;
	const PENALTY_CJK = (containerWidth * CJK_BREAK_PENALTY_RATIO) ** 2;
	const PENALTY_NORMAL = (containerWidth * NORMAL_BREAK_PENALTY_RATIO) ** 2;
	for (let i = n - 1; i >= 0; i--) for (let j = i + 1; j <= n; j++) {
		const w = prefixWidth[j] - prefixWidth[i];
		let lineCost = 0;
		if (w > containerWidth) {
			if (j === i + 1) lineCost = (w - containerWidth) ** 2 * OVERFLOW_PENALTY_MULTIPLIER;
			else continue;
		} else lineCost = (containerWidth - w) ** 2;
		let breakPenalty = 0;
		if (j < n) {
			const prevChild = children[j - 1];
			if (PUNCTUATION_REGEX.test(prevChild.text)) breakPenalty = -((containerWidth * PUNCTUATION_BREAK_REWARD_RATIO) ** 2);
			else if (prevChild.isSpace) breakPenalty = -((containerWidth * SPACE_BREAK_REWARD_RATIO) ** 2);
			else if (cjkBoundaries.has(charOffsets[j])) breakPenalty = PENALTY_CJK;
			else breakPenalty = PENALTY_NORMAL;
		}
		const totalCost = lineCost + breakPenalty + dp[j];
		if (totalCost < dp[i]) {
			dp[i] = totalCost;
			nextBreak[i] = j;
		}
	}
	const breaks = [];
	let curr = 0;
	while (curr < n) {
		curr = nextBreak[curr];
		if (curr > 0 && curr < n) breaks.push(curr);
	}
	return breaks;
}
//#endregion
//#region src/utils/line-balancer.ts
let sharedCanvasCtx = null;
function getMeasurementContext() {
	if (!sharedCanvasCtx) sharedCanvasCtx = document.createElement("canvas").getContext("2d");
	return sharedCanvasCtx;
}
/**
* 用于平衡歌词行在换行后的各行长度
*/
var LineBalancer = class {
	mainElement;
	isBalancing = false;
	lastBalancedContainerWidth = -1;
	constructor(mainElement) {
		this.mainElement = mainElement;
	}
	balanceLineBreaks(isNonDynamic, hasSplittedWords, wordSegmenter) {
		if (this.isBalancing || !this.mainElement) return;
		const computedStyle = getComputedStyle(this.mainElement);
		const fontKey = computedStyle.font + computedStyle.letterSpacing;
		if (fontKey !== this.lastBalancedFont) { this.lastBalancedFont = fontKey; this.lastBalancedContainerWidth = -1; }
		const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
		const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
		const containerWidth = this.mainElement.clientWidth - paddingLeft - paddingRight;
		if (containerWidth <= 0) return;
		if (isNonDynamic) {
			this.balanceNonDynamicLineBreaks(containerWidth, computedStyle, wordSegmenter);
			return;
		}
		if (!hasSplittedWords) return;
		this.balanceDynamicLineBreaks(containerWidth, wordSegmenter);
	}
	reset() {
		this.lastBalancedContainerWidth = -1;
	}
	executeLineBalance(containerWidth, adapter, wordSegmenter) {
		if (containerWidth === this.lastBalancedContainerWidth) return;
		adapter.resetDOM();
		const prevWhiteSpace = this.mainElement.style.whiteSpace;
		this.mainElement.style.whiteSpace = "nowrap";
		const parentElement = this.mainElement.parentElement;
		let prevTransform = "";
		let transformChanged = false;
		if (parentElement) {
			prevTransform = parentElement.style.transform;
			if (prevTransform && prevTransform !== "none") {
				parentElement.style.transform = "none";
				transformChanged = true;
			}
		}
		let lockAcquired = false;
		try {
			const { childInfos, fullText } = adapter.buildChildInfos();
			let layoutWidth = childInfos.reduce((sum, c) => sum + c.width, 0);
			if (adapter.needsCalibration) {
				const range = document.createRange();
				range.selectNodeContents(this.mainElement);
				const visualWidth = range.getBoundingClientRect().width;
				if (layoutWidth > 0 && visualWidth > 0) {
					const scale = visualWidth / layoutWidth;
					for (const info of childInfos) info.width *= scale;
				}
				layoutWidth = visualWidth;
			}
			const safeContainerWidth = Math.max(1, containerWidth);
			if (layoutWidth <= safeContainerWidth) {
				this.lastBalancedContainerWidth = containerWidth;
				return;
			}
			const breaks = calcBalancedBreaks(childInfos, safeContainerWidth, fullText, wordSegmenter);
			if (breaks.length === 0) {
				this.lastBalancedContainerWidth = containerWidth;
				return;
			}
			this.isBalancing = true;
			lockAcquired = true;
			adapter.applyBreaks(breaks, childInfos);
			this.lastBalancedContainerWidth = containerWidth;
			this.isBalancing = false;
		} finally {
			this.mainElement.style.whiteSpace = prevWhiteSpace;
			if (transformChanged && parentElement) parentElement.style.transform = prevTransform;
			if (lockAcquired) this.isBalancing = false;
		}
	}
	balanceDynamicLineBreaks(containerWidth, wordSegmenter) {
		const infoToNode = [];
		this.executeLineBalance(containerWidth, {
			resetDOM: () => {
				this.mainElement.querySelectorAll("br").forEach((br) => {
					br.remove();
				});
			},
			buildChildInfos: () => {
				infoToNode.length = 0;
				const childNodes = Array.from(this.mainElement.childNodes);
				const childInfos = [];
				const range = document.createRange();
				for (const node of childNodes) if (node.nodeType === Node.TEXT_NODE) {
					const text = node.textContent ?? "";
					if (text.length === 0) continue;
					range.selectNodeContents(node);
					childInfos.push({
						width: range.getBoundingClientRect().width,
						text,
						isSpace: text.trim().length === 0
					});
					infoToNode.push(node);
				} else if (node.nodeType === Node.ELEMENT_NODE) {
					const el = node;
					const rect = el.getBoundingClientRect();
					const elStyle = getComputedStyle(el);
					const marginLeft = Number.parseFloat(elStyle.marginLeft) || 0;
					const marginRight = Number.parseFloat(elStyle.marginRight) || 0;
					childInfos.push({
						width: clampPositive(rect.width + marginLeft + marginRight),
						text: el.textContent ?? "",
						isSpace: false
					});
					infoToNode.push(node);
				}
				return {
					childInfos,
					fullText: childInfos.map((c) => c.text).join("")
				};
			},
			applyBreaks: (breaks) => {
				for (let i = breaks.length - 1; i >= 0; i--) {
					const breakIndex = breaks[i];
					if (breakIndex >= 0 && breakIndex < infoToNode.length) this.mainElement.insertBefore(document.createElement("br"), infoToNode[breakIndex]);
				}
			},
			needsCalibration: false
		}, wordSegmenter);
	}
	balanceNonDynamicLineBreaks(containerWidth, computedStyle, wordSegmenter) {
		const fullText = this.mainElement.textContent ?? "";
		if (fullText.trim().length === 0) return;
		this.executeLineBalance(containerWidth, {
			resetDOM: () => {
				this.mainElement.innerHTML = "";
				this.mainElement.textContent = fullText;
			},
			buildChildInfos: () => {
				const ctx = getMeasurementContext();
				if (!ctx) {
					console.debug("Canvas 2D context is not supported, skipping line balancing");
					return {
						childInfos: [],
						fullText
					};
				}
				ctx.font = `${computedStyle.fontWeight} ${computedStyle.fontSize} ${computedStyle.fontFamily}`;
				if ("letterSpacing" in ctx) ctx.letterSpacing = computedStyle.letterSpacing !== "normal" ? computedStyle.letterSpacing : "0px";
				if ("wordSpacing" in ctx) ctx.wordSpacing = computedStyle.wordSpacing !== "normal" ? computedStyle.wordSpacing : "0px";
				const childInfos = [];
				for (const { segment } of wordSegmenter.segment(fullText)) childInfos.push({
					width: ctx.measureText(segment).width,
					text: segment,
					isSpace: segment.trim().length === 0
				});
				return {
					childInfos,
					fullText
				};
			},
			applyBreaks: (breaks, childInfos) => {
				this.mainElement.innerHTML = "";
				const breakSet = new Set(breaks);
				const fragment = document.createDocumentFragment();
				for (let i = 0; i < childInfos.length; i++) {
					if (breakSet.has(i)) fragment.appendChild(document.createElement("br"));
					fragment.appendChild(document.createTextNode(childInfos[i].text));
				}
				this.mainElement.appendChild(fragment);
			},
			needsCalibration: true
		}, wordSegmenter);
	}
};
//#endregion
//#region src/utils/lyric-split-words.ts
const SPLIT_WHITESPACE_RE = /(\s+)/;
const WHITESPACE_RE = /\s/g;
/**
* 将输入的单词重新分组，之间没有空格的单词将会组合成一个单词数组
*
* 例如输入：`["Life", " ", "is", " a", " su", "gar so", "sweet"]`
*
* 应该返回：`["Life", " ", "is", " a", [" su", "gar"], "so", "sweet"]`
* @param words 输入的单词数组
* @returns 重新分组后的单词数组
*/
function chunkAndSplitLyricWords(words) {
	const result = [];
	let currentGroup = [];
	const flushGroup = () => {
		if (currentGroup.length > 0) {
			result.push(currentGroup.length === 1 ? currentGroup[0] : [...currentGroup]);
			currentGroup = [];
		}
	};
	const processAtom = (atom) => {
		const isSpace = atom.word.trim().length === 0;
		const hasRuby = (atom.ruby?.length ?? 0) > 0;
		const isCJKChar = isCJK(atom.word);
		if (!isSpace && !hasRuby && !isCJKChar) currentGroup.push(atom);
		else {
			flushGroup();
			result.push(atom);
		}
	};
	for (const w of words) {
		const content = w.word.trim();
		const isSpace = content.length === 0;
		const romanWord = w.romanWord ?? "";
		const obscene = w.obscene ?? false;
		const hasRuby = (w.ruby?.length ?? 0) > 0;
		if (isSpace) {
			processAtom({
				...w,
				obscene
			});
			continue;
		}
		if (hasRuby) {
			const leadingSpaceMatch = w.word.match(/^\s+/);
			const trailingSpaceMatch = w.word.match(/\s+$/);
			const leadingSpace = leadingSpaceMatch ? leadingSpaceMatch[0] : "";
			const trailingSpace = trailingSpaceMatch ? trailingSpaceMatch[0] : "";
			if (leadingSpace) processAtom({
				word: leadingSpace,
				romanWord: "",
				startTime: w.startTime,
				endTime: w.startTime,
				obscene
			});
			processAtom({
				...w,
				word: content,
				obscene
			});
			if (trailingSpace) processAtom({
				word: trailingSpace,
				romanWord: "",
				startTime: w.endTime,
				endTime: w.endTime,
				obscene
			});
			continue;
		}
		const parts = w.word.split(SPLIT_WHITESPACE_RE).filter((p) => p.length > 0);
		const totalLength = w.word.replace(WHITESPACE_RE, "").length || 1;
		const timePerUnit = (w.endTime - w.startTime) / totalLength;
		const wordParts = w.word.trim().split(/\s+/).filter((p) => p.length > 0);
		const romanTrimmed = romanWord.trim();
		const romanParts = romanTrimmed.length > 0 ? romanTrimmed.split(/\s+/).filter((p) => p.length > 0) : [];
		const isMatched = wordParts.length > 0 && wordParts.length === romanParts.length;
		let currentOffset = 0;
		let nonSpaceIndex = 0;
		for (const part of parts) {
			if (!part.trim()) {
				const startTime = w.startTime + currentOffset * timePerUnit;
				processAtom({
					word: part,
					romanWord: "",
					startTime,
					endTime: startTime,
					obscene
				});
				continue;
			}
			let partRomanWord = "";
			if (romanParts.length > 0) {
				if (isMatched) partRomanWord = romanParts[nonSpaceIndex] ?? "";
				else if (nonSpaceIndex === 0) partRomanWord = romanWord;
			}
			nonSpaceIndex++;
			if (isCJK(part) && part.length > 1 && romanTrimmed.length === 0) {
				const chars = part.split("");
				for (const char of chars) {
					const startTime = w.startTime + currentOffset * timePerUnit;
					processAtom({
						word: char,
						romanWord: "",
						startTime,
						endTime: startTime + timePerUnit,
						obscene
					});
					currentOffset += 1;
				}
			} else {
				const partRealLen = part.length;
				const startTime = w.startTime + currentOffset * timePerUnit;
				const duration = partRealLen * timePerUnit;
				processAtom({
					word: part,
					romanWord: partRomanWord,
					startTime,
					endTime: startTime + duration,
					obscene
				});
				currentOffset += partRealLen;
			}
		}
	}
	flushGroup();
	return result;
}
//#endregion
//#region src/utils/matrix.ts
function createMatrix4() {
	return [
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1,
		0,
		0,
		0,
		0,
		1
	];
}
function scaleMatrix4(m, scale = 1, origin = {
	x: 0,
	y: 0
}) {
	const [ox, oy] = [origin.x, origin.y];
	return [
		m[0] * scale,
		m[1] * scale,
		m[2] * scale,
		m[3],
		m[4] * scale,
		m[5] * scale,
		m[6] * scale,
		m[7],
		m[8] * scale,
		m[9] * scale,
		m[10] * scale,
		m[11],
		m[12] - ox * scale + ox,
		m[13] - oy * scale + oy,
		m[14],
		m[15]
	];
}
function matrix4ToCSS(m, fractionDigits = 4) {
	const format = (n, _) => n.toFixed(fractionDigits);
	return `matrix3d(${m.map(format).join(", ")})`;
}
//#endregion
//#region src/lyric-player/dom/animation/emphasize/index.ts
const ANIMATION_FRAME_QUANTITY = 32;
const norNum = (min, max) => (x) => clamp01((x - min) / (max - min));
const EMP_EASING_MID = .5;
const beginNum = norNum(0, EMP_EASING_MID);
const endNum = norNum(EMP_EASING_MID, 1);
const bezIn = bezier(.2, .4, .58, 1);
const bezOut = bezier(.3, 0, .58, 1);
const makeEmpEasing = (mid) => {
	return (x) => x < mid ? bezIn(beginNum(x)) : 1 - bezOut(endNum(x));
};
const empEasing = makeEmpEasing(EMP_EASING_MID);
/**
* 为单词元素的所有字符创建强调动画序列，
* 该效果会使得逐个字符依次进行辉光缩放和上浮
*
* 创建后的动画默认处于暂停状态，外部需要根据播放进度进行调度
*
* @param options 强调动画配置项
* @returns 构建完毕的 Animation 对象列表
*/
function createEmphasizeAnimation(options) {
	const params = calculateEmphasizeParams(options);
	const totalChars = options.characterElements.length;
	const result = [];
	options.characterElements.forEach((el, i) => {
		const wordDe = params.de + params.du / 2.5 / params.anchorCharCount * i;
		result.push(createCharGlowAnimation(el, i, totalChars, wordDe, params));
		result.push(createCharFloatAnimation(el, wordDe, options.isBG, params));
	});
	return result;
}
function calculateEmphasizeParams(options) {
	const { duration, delay, rubyCharCount, characterElements, isLastWord } = options;
	const de = clampPositive(delay);
	let du = Math.max(1e3, duration);
	const anchorCharCount = rubyCharCount > 0 ? rubyCharCount : Math.max(1, characterElements.length);
	let amount = du / 2e3;
	amount = amount > 1 ? Math.sqrt(amount) : amount ** 3;
	let blur = du / 3e3;
	blur = blur > 1 ? Math.sqrt(blur) : blur ** 3;
	amount *= .6;
	blur *= .5;
	if (isLastWord) {
		amount *= 1.6;
		blur *= 1.5;
		du *= 1.2;
	}
	amount = Math.min(1.2, amount);
	blur = Math.min(.8, blur);
	return {
		amount,
		blur,
		du,
		de,
		anchorCharCount,
		animateDu: Number.isFinite(du) ? du : 0
	};
}
function generateGlowKeyframes(charIndex, totalChars, amount, blur) {
	return new Array(ANIMATION_FRAME_QUANTITY).fill(0).map((_, j) => {
		const x = (j + 1) / ANIMATION_FRAME_QUANTITY;
		const transX = empEasing(x);
		const glowLevel = transX * blur;
		const mat = scaleMatrix4(createMatrix4(), 1 + transX * .1 * amount);
		const offsetX = -transX * .03 * amount * (totalChars / 2 - charIndex);
		const offsetY = -transX * .025 * amount;
		return {
			offset: x,
			transform: `${matrix4ToCSS(mat, 4)} translate(${offsetX}em, ${offsetY}em)`,
			
		};
	});
}
function generateFloatKeyframes(isBG) {
	return new Array(ANIMATION_FRAME_QUANTITY).fill(0).map((_, j) => {
		const x = (j + 1) / ANIMATION_FRAME_QUANTITY;
		let y = Math.sin(x * Math.PI);
		if (isBG) y *= 2;
		return {
			offset: x,
			transform: `translateY(${-y * .05}em)`
		};
	});
}
function createCharGlowAnimation(el, charIndex, totalChars, wordDelay, params) {
	const frames = generateGlowKeyframes(charIndex, totalChars, params.amount, params.blur);
	const glow = el.animate(frames, {
		duration: params.animateDu,
		delay: Number.isFinite(wordDelay) ? wordDelay : 0,
		id: `emphasize-word-${el.textContent}-${charIndex}`,
		iterations: 1,
		composite: "replace",
		fill: "both"
	});
	glow.onfinish = () => glow.pause();
	glow.pause();
	return glow;
}
function createCharFloatAnimation(el, wordDelay, isBG, params) {
	const frames = generateFloatKeyframes(isBG);
	const float = el.animate(frames, {
		duration: params.animateDu * 1.4,
		delay: Number.isFinite(wordDelay) ? wordDelay - 400 : 0,
		id: "emphasize-word-float",
		iterations: 1,
		composite: "add",
		fill: "both"
	});
	float.onfinish = () => float.pause();
	float.pause();
	return float;
}
//#endregion
//#region src/lyric-player/dom/animation/float/index.ts
/**
* 创建常规歌词单词的上浮动画
*
* 基于 Web Animations API 实现，动画会使传入的单词元素产生一个轻微向上平移的效果
*
* 创建后的动画默认处于暂停状态，外部需要根据播放进度进行调度
*
* @param wordEl - 需要应用上浮动画的歌词单词 DOM 元素
* @param options - 动画相关的上下文配置选项
* @returns 一个处于暂停状态的 {@link Animation} 对象
*/
function createFloatAnimation(wordEl, options) {
	const { word, lineStartTime, isBG } = options;
	const delay = word.startTime - lineStartTime;
	const duration = Math.max(1e3, word.endTime - word.startTime);
	let up = .05;
	if (isBG) up *= 2;
	const a = wordEl.animate([{ transform: "translateY(0px)" }, { transform: `translateY(${-up}em)` }], {
		duration: Number.isFinite(duration) ? duration : 0,
		delay: Number.isFinite(delay) ? delay : 0,
		id: "float-word",
		composite: "add",
		fill: "both",
		easing: "ease-out"
	});
	a.pause();
	return a;
}
//#endregion
//#region src/lyric-player/dom/animation/mask/utils.ts
const bright = "rgb(0 0 0 / var(--bright-mask-alpha, 1))";
const dark = "rgb(0 0 0 / var(--dark-mask-alpha, 1))";
function generateFadeGradient(width) {
	const totalAspect = 2 + width;
	const halfFadePercent = width / totalAspect * 50;
	const leftPercent = 50 - halfFadePercent;
	const rightPercent = 50 + halfFadePercent;
	return [`linear-gradient(to right, ${bright} ${leftPercent}%, ${dark} ${rightPercent}%)`, totalAspect];
}
//#endregion
//#region src/lyric-player/dom/animation/mask/animator-calc.ts
/**
* 使用 CSS calc() 表达式为行内所有单词应用逐词点亮的遮罩样式
*
* 运行环境不支持 Web Animations 驱动 mask-position 时的回退方案，
* 依赖播放器在每帧更新 `--amll-player-time` CSS 变量来驱动遮罩移动，
* 因此无需外部调度任何动画
*/
var CalcMaskAnimator = class {
	words;
	context;
	constructor(words, context) {
		this.words = words;
		this.context = context;
	}
	apply() {
		for (const word of this.words) {
			const { mainElement: wordEl, width: textWidth, padding: paddingLeft, height, startTime, endTime } = word;
			const totalWordWidth = textWidth + paddingLeft * 2;
			const fadeWidth = height * this.context.wordFadeWidth;
			const [maskImage, totalAspect] = generateFadeGradient(fadeWidth / totalWordWidth);
			const totalAspectStr = `${totalAspect * 100}% 100%`;
			const speed = textWidth / Math.max(Math.abs(endTime - startTime), 1);
			const startPos = paddingLeft - totalWordWidth - fadeWidth / 2;
			const maskPos = `clamp(${-totalWordWidth - fadeWidth}px, ${startPos}px + (var(--amll-player-time) - ${startTime}) * ${speed}px, 0px) 0px`;
			Object.assign(wordEl.style, {
				maskImage,
				webkitMaskImage: maskImage,
				maskRepeat: "no-repeat",
				webkitMaskRepeat: "no-repeat",
				maskSize: totalAspectStr,
				webkitMaskSize: totalAspectStr,
				maskPosition: maskPos,
				webkitMaskPosition: maskPos
			});
		}
	}
	setCurrentTime(_timeRelative, _isPlaying) {}
	pause() {}
	resume() {}
	dispose() {
		for (const word of this.words) {
			const wordEl = word.mainElement;
			if (wordEl) ["mask", "-webkit-mask"].forEach((prop) => {
				wordEl.style.removeProperty(prop);
			});
		}
	}
};
//#endregion
//#region src/lyric-player/dom/animation/mask/animator-web.ts
/**
* 使用 Web Animations API 为行内所有单词创建逐词点亮的遮罩动画
*
* 创建后的动画均处于暂停状态，外部需要根据播放进度进行调度
*/
var WebMaskAnimator = class {
      words; context; tracks = []; totalFadeDuration;
      	constructor(words, context) {
		this.words = words;
		this.context = context;
		this.totalFadeDuration = this.context.lineEndTime - this.context.lineStartTime;
	}

      apply() { this.buildAnimations(); }
      setCurrentTime(time) { this.update(time); }
      pause() {}
      resume() {}
      update(time) {
        const t = Math.max(0, Math.min(1, time / Math.max(this.totalFadeDuration, 1)));
        for (const track of this.tracks) {
          const value = sampleMask(track.frames, t);
          const x = value.toFixed(2);
          if (x !== track.last) {
            track.element.style.maskPosition = x + "px 0";
            track.last = x;
          }
        }
      }
      buildAnimations() {
        for (const [i, word] of this.words.entries()) {
          if (!word.mainElement) continue;
          const fadeWidth = word.height * this.context.wordFadeWidth;
          this.updateWordMaskStyles(word.mainElement, word, fadeWidth);
          const frames = this.generateWordKeyframes(word, i, fadeWidth).map(f => ({offset:f.offset, position:parseFloat(f.maskPosition)}));
          this.tracks.push({element:word.mainElement, frames, last:null, mode:null, mask:word.mainElement.style.maskImage, minimum:-(word.width + word.padding * 2 + fadeWidth)});
        }
        this.update(0);
      }
	/**
	* 为单个单词 DOM 元素配置 CSS 渐变遮罩样式
	*/
	updateWordMaskStyles(wordEl, word, fadeWidth) {
		const [maskImage, totalAspect] = generateFadeGradient(fadeWidth / (word.width + word.padding * 2));
		Object.assign(wordEl.style, {
			maskImage,
			maskRepeat: "no-repeat",
			maskSize: `${totalAspect * 100}% 100%`
		});
	}
	/**
	* 推导时间轴并生成单个单词在播放周期内的所有遮罩关键帧
	*/
	generateWordKeyframes(targetWord, targetIndex, fadeWidth) {
		const widthBeforeSelf = this.words.slice(0, targetIndex).reduce((a, b) => a + b.width, 0) + (this.words[0] ? fadeWidth : 0);
		const minOffset = -(targetWord.width + targetWord.padding * 2 + fadeWidth);
		const initialPos = -widthBeforeSelf - targetWord.width - targetWord.padding - fadeWidth;
		const config = {
			minOffset,
			fadeWidth
		};
		const cursor = {
			curPos: initialPos,
			lastPos: initialPos,
			timeOffset: 0,
			lastTime: 0,
			lastTimeStamp: 0,
			frames: []
		};
		this.pushClampedKeyframe(cursor, config.minOffset);
		for (const [j, otherWord] of this.words.entries()) {
			this.advancePauseTimeline(cursor, otherWord.startTime, config);
			const rubySegments = otherWord.ruby?.filter((r) => Boolean(r?.word?.trim())) ?? [];
			if (rubySegments.length > 0) this.advanceRubyWordTimeline(cursor, otherWord, rubySegments, config, j);
			else this.advancePlainWordTimeline(cursor, otherWord, config, j);
		}
		return cursor.frames;
	}
	advancePauseTimeline(cursor, targetStartTime, config) {
		const curTimeStamp = targetStartTime - this.context.lineStartTime;
		const staticDuration = curTimeStamp - cursor.lastTimeStamp;
		if (staticDuration > 0) this.advanceTimelineStep(cursor, config, staticDuration, 0);
		cursor.lastTimeStamp = curTimeStamp;
	}
	/**
	* 推导带有 Ruby 注音的多音节单词时间线
	*
	* 原理是把每个主音节的总宽度均分给 ruby 片段总数，并应用每个 ruby 片段的时间给主音节
	*
	* 此功能具有诸多缺陷，如下所示：
	* 1. 汉字是一个紧凑的表意单位，内部由形旁、声旁或笔画构成，与读音之间不存在从左到右的序列关系，
	*    像是一个多音节英语单词按连字符分开时间轴和停顿这才有语义
	* 2. 在主音节中间分时间和停顿会导致用户必须将视线焦点从主音节上移到上方的 ruby
	*    注音，以寻找音节锚点，显然破坏用户预期
	* 3. ruby 的注音功能已由逐字音译承担
	*
	* 但考虑到功能已进入生产环境，因此保留此功能
	*/
	advanceRubyWordTimeline(cursor, otherWord, rubySegments, config, wordIndex) {
		const rubyCharCount = rubySegments.reduce((sum, r) => sum + r.word.length, 0);
		const widthPerChar = otherWord.width / rubyCharCount;
		let charIndex = 0;
		for (const ruby of rubySegments) {
			const rubyStart = Math.max(ruby.startTime, otherWord.startTime);
			const rubyEnd = Math.min(Math.max(ruby.endTime, rubyStart), otherWord.endTime);
			const rubyStartStamp = rubyStart - this.context.lineStartTime;
			const rubyStaticDuration = rubyStartStamp - cursor.lastTimeStamp;
			if (rubyStaticDuration > 0) this.advanceTimelineStep(cursor, config, rubyStaticDuration, 0);
			cursor.lastTimeStamp = rubyStartStamp;
			const perCharDuration = Math.max(0, rubyEnd - rubyStart) / ruby.word.length;
			for (let i = 0; i < ruby.word.length; i++) {
				let movePx = widthPerChar;
				if (wordIndex === 0 && charIndex === 0) movePx += config.fadeWidth * 1.5;
				if (wordIndex === this.words.length - 1 && charIndex === rubyCharCount - 1) movePx += config.fadeWidth * .5;
				this.advanceTimelineStep(cursor, config, perCharDuration, movePx);
				cursor.lastTimeStamp += perCharDuration;
				charIndex++;
			}
		}
		const wordEndStamp = Math.max(otherWord.endTime - this.context.lineStartTime, cursor.lastTimeStamp);
		const wordTailDuration = wordEndStamp - cursor.lastTimeStamp;
		if (wordTailDuration > 0) this.advanceTimelineStep(cursor, config, wordTailDuration, 0);
		cursor.lastTimeStamp = wordEndStamp;
	}
	advancePlainWordTimeline(cursor, otherWord, config, wordIndex) {
		const { startTime, endTime, width } = otherWord;
		const fadeDuration = Math.max(0, endTime - startTime);
		let movePx = width;
		if (wordIndex === 0) movePx += config.fadeWidth * 1.5;
		if (wordIndex === this.words.length - 1) movePx += config.fadeWidth * .5;
		this.advanceTimelineStep(cursor, config, fadeDuration, movePx);
		cursor.lastTimeStamp += fadeDuration;
	}
	advanceTimelineStep(cursor, config, duration, movePx) {
		cursor.timeOffset += duration / this.totalFadeDuration;
		cursor.curPos += movePx;
		if (duration > 0) this.pushClampedKeyframe(cursor, config.minOffset);
	}
	pushClampedKeyframe(cursor, minOffset) {
		const moveOffset = cursor.curPos - cursor.lastPos;
		const time = Math.min(1, Math.max(0, cursor.timeOffset));
		const duration = time - cursor.lastTime;
		const msPerPixel = moveOffset !== 0 ? Math.abs(duration / moveOffset) : 0;
		if (cursor.curPos > minOffset && cursor.lastPos < minOffset) {
			const staticTime = Math.abs(cursor.lastPos - minOffset) * msPerPixel;
			cursor.frames.push({
				offset: cursor.lastTime + staticTime,
				maskPosition: `${Math.min(Math.max(cursor.lastPos, minOffset), 0)}px 0`
			});
		}
		if (cursor.curPos > 0 && cursor.lastPos < 0) {
			const staticTime = Math.abs(cursor.lastPos) * msPerPixel;
			cursor.frames.push({
				offset: cursor.lastTime + staticTime,
				maskPosition: `${Math.min(Math.max(cursor.curPos, minOffset), 0)}px 0`
			});
		}
		cursor.frames.push({
			offset: time,
			maskPosition: `${Math.min(Math.max(cursor.curPos, minOffset), 0)}px 0`
		});
		cursor.lastPos = cursor.curPos;
		cursor.lastTime = time;
	}
	getAnimationEndTime(animation) {
		const timing = animation.effect?.getComputedTiming();
		return Number(timing?.delay ?? 0) + Number(timing?.duration ?? 0);
	}
 dispose() {
      for (const track of this.tracks) { track.element.style.removeProperty("mask"); track.element.style.removeProperty("mask-position"); track.element.style.removeProperty("opacity"); }
      this.tracks.length = 0;
    }
};
//#endregion
//#region src/lyric-player/dom/animation/mask/index.ts
function createLineMaskAnimator(words, context) {
	if (context.supportMaskImage) return new WebMaskAnimator(words, context);
	else return new CalcMaskAnimator(words, context);
}
//#endregion
//#region src/lyric-player/dom/lyric-line.ts
var LyricLineEl = class extends LyricLineBase {
	lyricPlayer;
	lyricLine;
	element = document.createElement("div");
	splittedWords = [];
	built = false;
	renderMode = LyricLineRenderMode.SOLID;
	maskAnimator;
	lastScaleNum = -1;
	lineHasRubyWords;
	lineHasRomanWords;
	/**
	* 用于平衡换行、尽量减少各行长度差异的类
	*/
	balancer;
	constructor(lyricPlayer, lyricLine = {
		words: [],
		translatedLyric: "",
		romanLyric: "",
		startTime: 0,
		endTime: 0,
		isBG: false,
		isDuet: false
	}) {
		super();
		this.lyricPlayer = lyricPlayer;
		this.lyricLine = lyricLine;
		this.lineHasRubyWords = this.lyricLine.words.some((word) => (word.ruby?.length ?? 0) > 0);
		this.lineHasRomanWords = this.lyricLine.words.some((word) => (word.romanWord?.trim().length ?? 0) > 0);
		this.element.setAttribute("class", lyric_player_module_default.lyricLine);
		if (this.lyricLine.isBG) this.element.classList.add(lyric_player_module_default.lyricBgLine);
		if (this.lyricLine.isDuet) this.element.classList.add(lyric_player_module_default.lyricDuetLine);
		this.element.appendChild(document.createElement("div"));
		this.element.appendChild(document.createElement("div"));
		this.element.appendChild(document.createElement("div"));
		const main = this.element.children[0];
		const trans = this.element.children[1];
		const roman = this.element.children[2];
		main.setAttribute("class", lyric_player_module_default.lyricMainLine);
		trans.setAttribute("class", lyric_player_module_default.lyricSubLine);
		roman.setAttribute("class", lyric_player_module_default.lyricSubLine);
		if (LyricLineBase.wordSegmenter) this.balancer = new LineBalancer(main);
		this.rebuildStyle();
	}
	isEnabled = false;
	async enable(maskAnimationTime = this.lyricPlayer.getCurrentTime(), shouldPlay = this.lyricPlayer.getIsPlaying()) {
		this.isEnabled = true;
		this.element.classList.add(lyric_player_module_default.active);
		const main = this.element.children[0];
		const relativeTime = clampPositive(maskAnimationTime - this.lyricLine.startTime);
		for (const word of this.splittedWords) for (const a of word.elementAnimations) {
			a.currentTime = relativeTime;
			a.playbackRate = 1;
			const timing = a.effect?.getComputedTiming();
			const endTime = Number(timing?.delay ?? 0) + Number(timing?.duration ?? 0);
			if (shouldPlay && relativeTime < endTime) a.play();
			else a.pause();
		}
		this.maskAnimator?.setCurrentTime(relativeTime, shouldPlay);
		main.classList.add(lyric_player_module_default.active);
	}
	disable() {
		this.isEnabled = false;
		this.element.classList.remove(lyric_player_module_default.active);
		this.setRenderMode(LyricLineRenderMode.SOLID);
		const main = this.element.children[0];
		for (const word of this.splittedWords) for (const a of word.elementAnimations) if (a.id === "float-word" || a.id.includes("emphasize-word-float-only")) {
			a.playbackRate = -1;
			a.play();
		}
		this.maskAnimator?.pause();
		main.classList.remove(lyric_player_module_default.active);
	}
	lastWord;
	async resume() {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) for (const a of word.elementAnimations) if (!this.lastWord || this.splittedWords.indexOf(this.lastWord) < this.splittedWords.indexOf(word)) {
			const timing = a.effect?.getComputedTiming();
			const endTime = Number(timing?.delay ?? 0) + Number(timing?.duration ?? 0);
			if (a.playState !== "finished" && (a.currentTime || 0) < endTime) a.play();
		}
		this.maskAnimator?.resume();
	}
	async pause() {
		if (!this.isEnabled) return;
		for (const word of this.splittedWords) for (const a of word.elementAnimations) a.pause();
		this.maskAnimator?.pause();
	}
	getLine() {
		return this.lyricLine;
	}
	release() { this.disposeElements(); this.built = false; }
	show() {
		if (!this.built) {
			this.rebuildElement();
			this.built = true;
			this.updateMaskImageSync();
		}
	}
	rebuildStyle() {
		const style = this.element.style;
		const currentScale = this.lineTransforms.scale.getCurrentPosition() / 100;
		if (Math.abs(currentScale - this.lastScaleNum) >= 1e-4) {
			this.lastScaleNum = currentScale;
			style.transform = `scale(${currentScale.toFixed(3)})`;
		}
	}
	rebuildElement() {
		this.disposeElements();
		const main = this.element.children[0];
		const trans = this.element.children[1];
		const roman = this.element.children[2];
		if (this.lyricPlayer._getIsNonDynamic()) {
			main.textContent = this.lyricLine.words.map((w) => w.word).join("");
			this.setSubLinesText(trans, roman);
			return;
		}
		const chunkedWords = chunkAndSplitLyricWords(this.lyricLine.words);
		main.innerHTML = "";
		for (const chunk of chunkedWords) this.buildWord(chunk, main);
		this.setSubLinesText(trans, roman);
	}
	/** 设置翻译与音译行文本 */
	setSubLinesText(trans, roman) {
		trans.textContent = this.lyricLine.translatedLyric;
		roman.textContent = this.lyricLine.romanLyric;
	}
	getRubyCharCount(word) {
		return (word.ruby ?? []).reduce((total, ruby) => total + ruby.word.length, 0);
	}
	getRubySegments(word) {
		return (word.ruby ?? []).filter((ruby) => (ruby?.word?.trim().length ?? 0) > 0);
	}
	createWord(word, shouldEmphasize) {
		const mainWordEl = document.createElement("span");
		const subElements = [];
		const romanWord = word.romanWord?.trim() ?? "";
		const wordContainer = this.lineHasRubyWords ? document.createElement("span") : mainWordEl;
		const wordTextContainer = this.lineHasRubyWords ? document.createElement("span") : wordContainer;
		if (this.lineHasRubyWords) {
			const rubyWordEl = document.createElement("span");
			const rubySegments = this.getRubySegments(word);
			for (const ruby of rubySegments) {
				const rubyPartEl = document.createElement("span");
				rubyPartEl.textContent = ruby.word;
				rubyPartEl.dataset.startTime = String(ruby.startTime);
				rubyPartEl.dataset.endTime = String(ruby.endTime);
				rubyWordEl.appendChild(rubyPartEl);
			}
			rubyWordEl.classList.add(lyric_player_module_default.rubyWord);
			mainWordEl.classList.add(lyric_player_module_default.wordWithRuby);
			wordContainer.classList.add(lyric_player_module_default.wordBody);
			wordTextContainer.classList.add(lyric_player_module_default.rubyBaseWord);
			wordContainer.appendChild(wordTextContainer);
			mainWordEl.appendChild(rubyWordEl);
			mainWordEl.appendChild(wordContainer);
		}
		const displayWord = word.word;
		if (shouldEmphasize) {
			mainWordEl.classList.add(lyric_player_module_default.emphasize);
			const trimmedWord = displayWord.trim();

      const wordEl = document.createElement("span");
      wordEl.textContent = trimmedWord;
      subElements.push(wordEl);
      wordTextContainer.appendChild(wordEl);
		} else if (this.lineHasRomanWords) {
			const wordEl = document.createElement("span");
			wordEl.textContent = displayWord.trim();
			wordTextContainer.appendChild(wordEl);
		} else if (romanWord.length === 0) wordTextContainer.textContent = displayWord.trim();
		if (this.lineHasRomanWords) {
			const romanWordEl = document.createElement("span");
			romanWordEl.textContent = romanWord.length > 0 ? romanWord : "\xA0";
			romanWordEl.classList.add(lyric_player_module_default.romanWord);
			wordContainer.appendChild(romanWordEl);
		}
		return {
			...word,
			mainElement: mainWordEl,
			subElements,
			elementAnimations: [createFloatAnimation(mainWordEl, {
				word,
				lineStartTime: this.lyricLine.startTime,
				isBG: this.lyricLine.isBG
			})],
			width: 0,
			height: 0,
			padding: 0,
			shouldEmphasize
		};
	}
	buildWord(input, main) {
		const chunk = Array.isArray(input) ? input : [input];
		if (chunk.length === 0) return;
		if (chunk.every((w) => !w.word.trim())) {
			const textContent = chunk.map((w) => w.word).join("");
			main.appendChild(document.createTextNode(textContent));
			return;
		}
		const merged = chunk.reduce((a, b) => {
			a.endTime = Math.max(a.endTime, b.endTime);
			a.startTime = Math.min(a.startTime, b.startTime);
			a.word += b.word;
			return a;
		}, {
			word: "",
			romanWord: "",
			startTime: Number.POSITIVE_INFINITY,
			endTime: Number.NEGATIVE_INFINITY,
			wordType: "normal",
			obscene: false
		});
		let emp = chunk.some((word) => LyricLineBase.shouldEmphasize(word));
		if (!isCJK(merged.word)) emp = emp || LyricLineBase.shouldEmphasize(merged);
		const wrapperWordEl = document.createElement("span");
		wrapperWordEl.classList.add(lyric_player_module_default.emphasizeWrapper);
		const characterElements = [];
		for (const word of chunk) {
			if (!word.word.trim()) {
				wrapperWordEl.appendChild(document.createTextNode(word.word));
				continue;
			}
			const realWord = this.createWord(word, emp);
			if (emp) characterElements.push(...realWord.subElements);
			this.splittedWords.push(realWord);
			wrapperWordEl.appendChild(realWord.mainElement);
		}
		if (emp && this.splittedWords.length > 0) {
			const lastWordOfChunk = this.splittedWords[this.splittedWords.length - 1];
			const rubyCharCount = chunk.reduce((total, word) => total + this.getRubyCharCount(word), 0);
			const lineWords = this.lyricLine.words;
			const isLastWord = lineWords.length > 0 && merged.word.includes(lineWords[lineWords.length - 1].word);
			lastWordOfChunk.elementAnimations.push(...createEmphasizeAnimation({
				word: merged,
				characterElements,
				duration: merged.endTime - merged.startTime,
				delay: merged.startTime - this.lyricLine.startTime,
				rubyCharCount,
				isBG: this.lyricLine.isBG,
				isLastWord
			}));
		}
		main.appendChild(wrapperWordEl);
	}
	onLineSizeChange(_size) {
		this.updateMaskImageSync();
	}
	updateMaskImageSync() {
		let changed = !this.maskAnimator || this.lastMaskFade !== this.lyricPlayer.getWordFadeWidth();
		for (const word of this.splittedWords) {
			const oldWidth = word.width, oldHeight = word.height, oldPadding = word.padding;
			const el = word.mainElement;
			if (el) {
				word.padding = Number.parseFloat(getComputedStyle(el).paddingLeft);
				word.width = el.clientWidth - word.padding * 2;
				word.height = el.clientHeight - word.padding * 2;
			} else {
				word.width = 0;
				word.height = 0;
				word.padding = 0;
			}
			changed ||= oldWidth !== word.width || oldHeight !== word.height || oldPadding !== word.padding;
		}
		if (this.balancer && LyricLineBase.wordSegmenter) this.balancer.balanceLineBreaks(this.lyricPlayer._getIsNonDynamic(), this.splittedWords.length > 0, LyricLineBase.wordSegmenter);
		if (!changed) return;
		this.lastMaskFade = this.lyricPlayer.getWordFadeWidth();
		this.maskAnimator?.dispose();
		const maxEndTime = Math.max(0, ...this.splittedWords.map((w) => w.endTime), this.lyricLine.endTime);
		this.maskAnimator = createLineMaskAnimator(this.splittedWords, {
			lineStartTime: this.lyricLine.startTime,
			lineEndTime: maxEndTime,
			wordFadeWidth: this.lyricPlayer.getWordFadeWidth(),
			supportMaskImage: this.lyricPlayer.supportMaskImage
		});
		this.maskAnimator.apply();
		if (this.isEnabled) {
			const isPlayerRunning = this.lyricPlayer.getIsPlaying?.() ?? true;
			this.enable(this.lyricPlayer.getCurrentTime(), isPlayerRunning);
		}
	}
	getElement() {
		return this.element;
	}
	setRenderMode(mode) {
		if (this.renderMode === mode) return;
		this.renderMode = mode;
		this.element.classList.toggle(lyric_player_module_default.gradientMask, mode === LyricLineRenderMode.GRADIENT);
	}
	setTransform(scale = this.scale, opacity = this.opacity, blur = 0, delay = Duration.ZERO, mode = LyricLineRenderMode.SOLID) {
		super.setTransform(scale, opacity, blur, delay);
		this.setRenderMode(mode);
		this.top = 0;
		this.scale = scale;
		this.delay = delay;
		if (this.lyricPlayer.getEnableSpring()) this.lineTransforms.scale.setTargetPosition(scale);
		else this.lineTransforms.scale.setPosition(scale);
	}
	update(delta = Duration.ZERO) {
		if (this.isEnabled) this.maskAnimator?.update?.(this.lyricPlayer.getCurrentTime() - this.lyricLine.startTime);
		if (!this.lyricPlayer.getEnableSpring()) return;
		const scaleMoving = !this.lineTransforms.scale.arrived();
		this.lineTransforms.scale.update(delta);
		if (scaleMoving) this.isUiDirty = true;
	}
	commitChanges() {
		if (this.isUiDirty) {
			this.rebuildStyle();
			this.isUiDirty = false;
		}
	}
	/** @internal */
	_getDebugTargetPos() {
		return `[位移: ${this.top}; 缩放: ${this.scale}; 延时: ${this.delay}]`;
	}
	disposeElements() {
		this.balancer?.reset();
		this.maskAnimator?.dispose();
		this.maskAnimator = void 0;
		for (const realWord of this.splittedWords) {
			for (const a of realWord.elementAnimations) a.cancel();
			for (const sub of realWord.subElements) {
				sub.remove();
				sub.parentNode?.removeChild(sub);
			}
			realWord.elementAnimations = [];
			realWord.subElements = [];
			if (realWord.mainElement?.parentNode) realWord.mainElement.parentNode.removeChild(realWord.mainElement);
		}
		this.splittedWords = [];
		const main = this.element.children[0];
		const trans = this.element.children[1];
		const roman = this.element.children[2];
		if (main) main.innerHTML = "";
		if (trans) trans.innerHTML = "";
		if (roman) roman.innerHTML = "";
	}
	dispose() {
		this.disposeElements();
		this.lyricPlayer.resizeObserver.unobserve(this.element);
		this.element.remove();
	}
};
//#endregion
//#region src/lyric-player/dom/index.ts
/**
* 歌词行鼠标相关事件，可以获取到歌词行的索引、主歌词行以及背景歌词行（如果有）元素
*/
var LyricLineMouseEvent = class extends MouseEvent {
	lineIndex;
	line;
	bgLine;
	/**
	* 自定义标志位，用于记录外部是否调用了 `stopPropagation`
	*/
	isPropagationStopped = false;
	constructor(lineIndex, line, bgLine, event) {
		super(`line-${event.type}`, event);
		this.lineIndex = lineIndex;
		this.line = line;
		this.bgLine = bgLine;
	}
	stopPropagation() {
		this.isPropagationStopped = true;
		super.stopPropagation();
	}
	stopImmediatePropagation() {
		this.isPropagationStopped = true;
		super.stopImmediatePropagation();
	}
};
/**
* 歌词播放组件，本框架的核心组件
*
* 尽可能贴切 Apple Music for iPad 的歌词效果设计，且做了力所能及的优化措施
*/
var DomLyricPlayer = class extends LyricPlayerBase {
	abortController = new AbortController();
	currentLyricGroups = [];
	detachedGroups = [];
	onResize() {
		const computedStyles = getComputedStyle(this.element);
		this._baseFontSize = Number.parseFloat(computedStyles.fontSize);
		this.rebuildStyle();
	}
	supportPlusLighter = CSS.supports("mix-blend-mode", "plus-lighter");
	supportMaskImage = CSS.supports("mask-image", "none");
	innerSize = [0, 0];
	onMouseEventHandler = (e) => {
		const target = e.target;
		if (!(target instanceof Element)) return;
		const groupEl = target.closest(`.${lyric_player_module_default.lyricLineWrapper}`);
		if (!groupEl) return;
		const group = this.lyricGroupElementMap.get(groupEl);
		if (!group) return;
		const mainLine = group.mainLine;
		const bgLine = group.bgLine;
		const evt = new LyricLineMouseEvent(this.lyricLinesIndexes.get(mainLine) ?? -1, mainLine, bgLine, e);
		if (!this.dispatchEvent(evt) || evt.defaultPrevented) e.preventDefault();
		if (evt.isPropagationStopped) {
			e.stopPropagation();
			e.stopImmediatePropagation();
		}
	};
	/**
	* 是否为非逐词歌词
	* @internal
	*/
	_getIsNonDynamic() {
		return this.isNonDynamic;
	}
	_baseFontSize = Number.parseFloat(getComputedStyle(this.element).fontSize);
	get baseFontSize() {
		return this._baseFontSize;
	}
	constructor() {
		super();
		this.onResize();
		this.element.classList.add("amll-lyric-player", "dom");
		if (this.disableSpring) this.element.classList.add(lyric_player_module_default.disableSpring);
		this.element.addEventListener("click", this.onMouseEventHandler, { signal: this.abortController.signal });
		this.element.addEventListener("contextmenu", this.onMouseEventHandler, { signal: this.abortController.signal });
	}
	rebuildStyle() {}
	setWordFadeWidth(value = .5) {
		super.setWordFadeWidth(value);
		for (const group of this.currentLyricGroups) {
			group.mainLine.updateMaskImageSync();
			group.bgLine?.updateMaskImageSync();
		}
	}
	createInterludeDots() {
		return new InterludeDotsEl();
	}
	createBottomLine() {
		return new BottomLineEl(this);
	}
	/**
	* 重新构建歌词行和时间状态
	*
	* 一般用于在调用 {@link setLyricProcessConfig} 更新配置后手动刷新视图，
	* 或在外部样式/DOM 结构发生改变后重置歌词视图
	*
	* @param initialTime 重建后对齐的初始时间（毫秒），默认使用当前播放进度
	*/
	buildLyricGroups() {
		this.detachedGroups.length = 0;
		if (this.hasDuetLine) this.element.classList.add(lyric_player_module_default.hasDuetLine);
		else this.element.classList.remove(lyric_player_module_default.hasDuetLine);
		let currentGroup = null;
		for (let i = 0; i < this.processedLines.length; i++) {
			const line = this.processedLines[i];
			const lineEl = new LyricLineEl(this, line);
			this.lyricLinesIndexes.set(lineEl, i);
			if (!line.isBG || !currentGroup) {
				currentGroup = new LyricLineGroup(this, lineEl);
				this.currentLyricGroups.push(currentGroup);
				this.lyricGroupElementMap.set(currentGroup.element, currentGroup);
			} else currentGroup.addBgLine(lineEl);
		}
	}
	rebuildLyricView(initialTime = this.getCurrentTime()) {
		super.rebuildLyricView(initialTime);
		this.setLinePosXSpringParams({});
		this.setLinePosYSpringParams({});
		this.setLineScaleSpringParams({});
		this.update(0);
	}
	pause() {
		super.pause();
		this.element.classList.remove(lyric_player_module_default.playing);
		for (const group of this.currentLyricGroups) {
			group.mainLine.pause();
			group.bgLine?.pause();
		}
	}
	resume() {
		super.resume();
		this.element.classList.add(lyric_player_module_default.playing);
		for (const group of this.currentLyricGroups) {
			group.mainLine.resume();
			group.bgLine?.resume();
		}
	}
	update(delta = 0) {
		const d = Duration.min(Duration.fromMillis(delta), MAX_FRAME_DELTA);
		super.update(Duration.asMillis(d));
		if (!this.supportMaskImage) this.element.style.setProperty("--amll-player-time", `${this.getCurrentTime()}`);
		if (!this.isPageVisible) return;
		for (const group of this.currentLyricGroups) group.update(d);
		for (const group of this.currentLyricGroups) group.commitChanges();
	}
	dispose() {
		this.detachedGroups.length = 0;
		super.dispose();
		this.abortController.abort();
		this.element.remove();
		for (const group of this.currentLyricGroups) group.dispose();
	}
};
//#endregion
export { DomLyricPlayer, DomLyricPlayer as LyricPlayer, Duration, LayoutAlignAnchor, LayoutReason, LyricLineMouseEvent, LyricLineRenderMode, LyricPlayerBase, MaskObsceneWordsMode, MediaTime, spring_exports as spring };

