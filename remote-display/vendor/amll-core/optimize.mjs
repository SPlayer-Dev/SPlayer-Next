import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = new URL(".", import.meta.url);
let source = readFileSync(new URL("upstream.mjs", root), "utf8");
const upstreamHash = createHash("sha256").update(source).digest("hex");
if (upstreamHash !== "fd3dd4a8ba727b7cbb860b0e0879683f18c74cf0116297d3b8239fcac6e6af5c") {
  throw new Error("AMLL 上游文件版本不匹配，请重新审查补丁");
}
function replace(before, after) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`补丁必须唯一匹配，实际 ${count}: ${before.slice(0, 100)}`);
  source = source.replace(before, after);
}
function section(start, end, edit) {
  const a = source.indexOf(start),
    b = source.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error("上游结构已改变");
  const previous = source.slice(a, b);
  replace(previous, edit(previous));
}
// 静止弹簧不再重复执行数值微分、指数求解或分配三个闭包。
section("var Spring = class", "function solveSpring", (s) =>
  s
    .replace("\tcurrentPosition = 0;", "\tsettled = true;\n\tcurrentPosition = 0;")
    .replace("\tresetSolver() {", "\tresetSolver() {\n\t\tthis.settled = false;")
    .replace(
      "\tarrived() {",
      "\tarrived() {\n\t\tif (this.settled && !this.queueParams && !this.queuePosition) return true;",
    )
    .replace(
      "\tsetPosition(targetPosition) {",
      "\tsetPosition(targetPosition) {\n\t\tthis.settled = true;",
    )
    .replace(
      "\tupdate(delta = Duration.ZERO) {",
      "\tupdate(delta = Duration.ZERO) {\n\t\tif (this.settled && !this.queueParams && !this.queuePosition) return;",
    )
    .replace(
      "if (this.queueParams.time <= 0) this.updateParams({ ...this.queueParams });",
      "if (this.queueParams.time <= 0) { const params = this.queueParams; this.queueParams = void 0; this.updateParams(params); }",
    ),
);
// 基类已经在重建时维护 WeakMap，避免每帧对每一行再次线性寻找索引。
replace(
  "const index = this.lyricPlayer.currentLyricGroups.indexOf(this);",
  "const index = this.lyricPlayer.lyricGroupIndexMap.get(this) ?? -1;",
);
replace(
  "const myIndex = groups.indexOf(this);",
  "const myIndex = this.lyricPlayer.lyricGroupIndexMap.get(this) ?? -1;",
);
// 单行不需要插入 br 时也应命中测量缓存；字体变化必须使缓存失效。
replace(
  "\t\tconst computedStyle = getComputedStyle(this.mainElement);",
  "\t\tconst computedStyle = getComputedStyle(this.mainElement);\n\t\tconst fontKey = computedStyle.font + computedStyle.letterSpacing;\n\t\tif (fontKey !== this.lastBalancedFont) { this.lastBalancedFont = fontKey; this.lastBalancedContainerWidth = -1; }",
);
replace(
  '\t\tconst existingBrs = this.mainElement.querySelectorAll("br");\n\t\tif (containerWidth === this.lastBalancedContainerWidth && existingBrs.length > 0) return;',
  "\t\tif (containerWidth === this.lastBalancedContainerWidth) return;",
);
// 容器高度变化不代表单词尺寸变化，避免重复销毁/重建整行遮罩动画。
section("\tupdateMaskImageSync() {", "\n\tgetElement() {", (s) =>
  s
    .replace(
      "\t\tfor (const word",
      "\t\tlet changed = !this.maskAnimator || this.lastMaskFade !== this.lyricPlayer.getWordFadeWidth();\n\t\tfor (const word",
    )
    .replace(
      "\t\t\tconst el = word.mainElement;",
      "\t\t\tconst oldWidth = word.width, oldHeight = word.height, oldPadding = word.padding;\n\t\t\tconst el = word.mainElement;",
    )
    .replace(
      "\n\t\t}\n\t\tif (this.balancer",
      "\n\t\t\tchanged ||= oldWidth !== word.width || oldHeight !== word.height || oldPadding !== word.padding;\n\t\t}\n\t\tif (this.balancer",
    )
    .replace(
      "\t\tthis.maskAnimator?.dispose();",
      "\t\tif (!changed) return;\n\t\tthis.lastMaskFade = this.lyricPlayer.getWordFadeWidth();\n\t\tthis.maskAnimator?.dispose();",
    ),
);
// 销毁时释放持有播放器和行组的 ResizeObserver。
replace(
  "\t\tthis.bottomLineObserver.disconnect();",
  "\t\tthis.bottomLineObserver.disconnect();\n\t\tthis.resizeObserver.disconnect();",
);
// 对比用的软件遮罩：沿用上游关键帧轨迹，仅更新正在变化的词。
if (process.argv.includes("--manual-mask")) {
  source = 'import { sampleMask } from "./mask-runtime.mjs";\n' + source;
  section("var WebMaskAnimator = class", "\n\t/**\n\t* 为单个单词", (s) => {
    const constructor = s.slice(s.indexOf("\tconstructor("), s.indexOf("\tapply()"));
    return `var WebMaskAnimator = class {
      words; context; tracks = []; totalFadeDuration;
      ${constructor}
      apply() { this.buildAnimations(); }
      setCurrentTime(time) { this.update(time); }
      pause() {}
      resume() {}
      update(time) {
        const t = Math.max(0, Math.min(1, time / Math.max(this.totalFadeDuration, 1)));
        for (const track of this.tracks) {
          const value = sampleMask(track.frames, t);
          const x = value.toFixed(2);
          const mode = value >= 0 ? "bright" : value <= track.minimum ? "dark" : "mask";
          if (mode !== track.mode) {
            track.element.style.maskImage = mode === "mask" ? track.mask : "none";
            track.element.style.opacity = mode === "mask" ? "1" : mode === "bright" ? "var(--bright-mask-alpha)" : "var(--dark-mask-alpha)";
            track.mode = mode;
          }
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
      }`;
  });
  section("var WebMaskAnimator = class", "//#endregion", (s) => {
    const a = s.indexOf("\n\tdispose() {");
    return (
      s.slice(0, a) +
      `\n dispose() {
      for (const track of this.tracks) { track.element.style.removeProperty("mask"); track.element.style.removeProperty("mask-position"); track.element.style.removeProperty("opacity"); }
      this.tracks.length = 0;
    }\n};\n`
    );
  });
  section("var LyricLineEl = class", "//#endregion", (s) =>
    s.replace(
      "\tupdate(delta = Duration.ZERO) {",
      "\tupdate(delta = Duration.ZERO) {\n\t\tif (this.isEnabled) this.maskAnimator?.update?.(this.lyricPlayer.getCurrentTime() - this.lyricLine.startTime);",
    ),
  );
}
// 实验表明部分 WebKit 合成路径对静态 opacity 替代遮罩更慢，因此单独开关验证。
if (process.argv.includes("--manual-mask") && !process.argv.includes("--solid-masks")) {
  const begin = source.indexOf("          const mode = value >= 0");
  const end = source.indexOf("          if (x !== track.last)", begin);
  if (begin < 0 || end < 0) throw new Error("遮罩实验补丁未匹配");
  source = source.slice(0, begin) + source.slice(end);
}
// 保留强调缩放与上浮，单独剔除会逐帧重绘文字的辉光阴影。
if (process.argv.includes("--no-glow")) {
  replace("textShadow: `0 0 ${Math.min(.3, blur * .3)}em rgba(255, 255, 255, ${glowLevel})`", "");
}
// 强调动画只有平面缩放；用等价 2D 变换避免 4x4 矩阵和 3D 合成路径。
if (process.argv.includes("--2d")) {
  replace(
    "const mat = scaleMatrix4(createMatrix4(), 1 + transX * .1 * amount);",
    "const scale = (1 + transX * .1 * amount).toFixed(4);",
  );
  replace(
    "transform: `${matrix4ToCSS(mat, 4)} translate(${offsetX}em, ${offsetY}em)`",
    "transform: `scale(${scale}) translate(${offsetX}em, ${offsetY}em)`",
  );
}
// 离屏仅保留最近十二组的 DOM/动画，防止长歌逐渐积累整首词粒度对象。
if (process.argv.includes("--bounded-lines")) {
  section("var DomLyricPlayer = class", "//#endregion", (s) =>
    s
      .replace("\tcurrentLyricGroups = [];", "\tcurrentLyricGroups = [];\n\tdetachedGroups = [];")
      .replace(
        "\tbuildLyricGroups() {",
        "\tbuildLyricGroups() {\n\t\tthis.detachedGroups.length = 0;",
      )
      .replace("\tdispose() {", "\tdispose() {\n\t\tthis.detachedGroups.length = 0;"),
  );
  section("var LyricLineEl = class", "//#endregion", (s) =>
    s.replace(
      "\tshow() {",
      "\trelease() { this.disposeElements(); this.built = false; }\n\tshow() {",
    ),
  );
  section("var LyricLineGroup = class", "//#endregion", (s) =>
    s
      .replace(
        "\tshow() {\n\t\tif (!this.element.parentElement) {",
        "\tshow() {\n\t\tif (!this.element.parentElement) {\n\t\t\tconst cached = this.lyricPlayer.detachedGroups; const index = cached.indexOf(this); if (index >= 0) cached.splice(index, 1);",
      )
      .replace(
        "\thide() {\n\t\tif (this.element.parentElement) {",
        `\thide() {\n\t\tif (this.element.parentElement) {
       this.mainLine.pause(); this.bgLine?.pause();
       const cached = this.lyricPlayer.detachedGroups; cached.push(this);
       if (cached.length > 12) { const old = cached.shift(); old.mainLine.release(); old.bgLine?.release(); }
    `,
      )
      .replace(
        "\t\tthis.mainLine.show();",
        "\t\tconst entering = !this.wasVisible; this.wasVisible = true;\n\t\tthis.mainLine.show();",
      )
      .replace(
        "\t\tthis.bgLine?.show();",
        "\t\tthis.bgLine?.show();\n\t\tif (entering) { if(this.mainLine.isEnabled) this.mainLine.enable(); if(this.bgLine?.isEnabled) this.bgLine.enable(); }",
      )
      .replace("\thide() {", "\thide() {\n\t\tthis.wasVisible = false;"),
  );
}
// 低开销强调按词建立一个子元素，保留逐词遮罩与缩放/上浮，省去逐字母动画。
if (process.argv.includes("--word-emphasis")) {
  section("var LyricLineEl = class", "//#endregion", (s) => {
    const a = s.indexOf("\t\t\tif (LyricLineBase.graphemeSegmenter)");
    const b = s.indexOf("\n\t\t} else if (this.lineHasRomanWords)", a);
    if (a < 0 || b < 0) throw new Error("强调节点结构已变化");
    return (
      s.slice(0, a) +
      `
      const wordEl = document.createElement("span");
      wordEl.textContent = trimmedWord;
      subElements.push(wordEl);
      wordTextContainer.appendChild(wordEl);` +
      s.slice(b)
    );
  });
}
// 显示端只导出歌词模块，避免载入没有使用的 Pixi 背景和调色板依赖。
if (process.argv.includes("--dom-only")) {
  const a = source.indexOf("//#region src/bg-render/base.ts"),
    b = source.indexOf("//#region src/utils/time.ts");
  const clampStart = source.indexOf("//#region src/utils/clamp.ts"),
    clampEnd = source.indexOf("//#endregion", clampStart);
  source = source.slice(0, a) + source.slice(clampStart, clampEnd) + "\n" + source.slice(b);
  source = source.replace(/^import .*from "(?:@pixi\/[^"]+|gl-matrix)";\n/gm, "");
  source = source.replace(
    /^export \{.*\};$/m,
    "export { DomLyricPlayer, DomLyricPlayer as LyricPlayer, Duration, LayoutAlignAnchor, LayoutReason, LyricLineMouseEvent, LyricLineRenderMode, LyricPlayerBase, MaskObsceneWordsMode, MediaTime, spring_exports as spring };",
  );
}
source = source.replace(/\/\/# sourceMappingURL=.*$/m, "");
writeFileSync(new URL("amll-core.mjs", root), source);
writeFileSync(
  new URL("build.json", root),
  JSON.stringify(
    {
      version: "0.6.0-surface",
      flags: process.argv.slice(2),
      sha256: createHash("sha256").update(source).digest("hex"),
    },
    null,
    2,
  ),
);
console.log("已重建 Surface AMLL 优化分支", fileURLToPath(root));
