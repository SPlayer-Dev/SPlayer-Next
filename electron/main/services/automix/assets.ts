import type { AutoMixComponentId } from "@shared/types/automix";
import { release } from "node:os";

/** 独立组件的发布文件、校验值与所需文件 */
interface AutoMixAsset {
  file: string;
  bytes: number;
  sha256: string;
  files: readonly string[];
}

/** 国内镜像在前，全部失败再直连，内容统一由 sha256 校验 */
export const AUTOMIX_MIRRORS = ["https://gh-proxy.com/", "https://ghfast.top/", ""].map(
  (prefix) => `${prefix}https://github.com/SPlayer-Dev/SPlayer-Next/releases/download/AutoMix/`,
);

const runtimeDigests: Record<string, [number, string]> = {
  "darwin-arm64": [10566937, "2d8109e818bbd8ee0faed50fdcb9b87879ff734788ee23b59f64cbfd781da83f"],
  "darwin-x64": [12350443, "352d9cf8edfe1a45958687a54075d6c255a47a7bfd9308505fbd9435c8879925"],
  "linux-arm64": [7777694, "634f093d3710b4e4a1a0267b292795a3c12f7ffc4bad74122dc899ccc629a202"],
  "linux-x64": [8893654, "4337c285937c1f8628a22ffa7a5f5b6e406924d34f232eb842982e24d3d7dd7c"],
  "win32-arm64": [16552290, "9aa718d6964c4f95b9861662e25d2656b886fc5eb081589d6c58e5cf49bdcd51"],
  "win32-x64": [16765101, "fc9625b39e00389d8836490727fa975b110ded46bd4536fd99cb7276968d5e4a"],
};
const runtimeDigest = runtimeDigests[`${process.platform}-${process.arch}`];
const [osMajor, osMinor] = release().split(".").map(Number);
const supportedMac =
  process.platform !== "darwin" ||
  (process.arch === "arm64" ? osMajor >= 23 : osMajor > 22 || (osMajor === 22 && osMinor >= 5));
export const AUTOMIX_WORKER =
  process.platform === "win32" ? "automix-worker.exe" : "automix-worker";
export const AUTOMIX_RUNTIME_FILES = [
  AUTOMIX_WORKER,
  ...(process.platform === "win32"
    ? [
        "onnxruntime.dll",
        "DirectML.dll",
        "onnxruntime_providers_shared.dll",
        "msvcp140.dll",
        "msvcp140_1.dll",
        "vcruntime140.dll",
        "vcruntime140_1.dll",
      ]
    : process.platform === "darwin"
      ? ["libonnxruntime.dylib"]
      : ["libonnxruntime.so"]),
];

export const AUTOMIX_COMPONENTS: Record<AutoMixComponentId, AutoMixAsset | null> = {
  beat: {
    file: "automix-beat-v2.zip",
    bytes: 76981537,
    sha256: "2bc9a93d9b69fe175294438f1f85ce1ca5d2e8f7bc5e1f0306cd3822eb5ec221",
    files: ["beat-this.onnx", "beat-this.check.json"],
  },
  demucs: {
    file: "automix-demucs-v2.zip",
    bytes: 98431199,
    sha256: "4444b909b1621a051e58f761ec28679d53c1cee3d2e527b87fdd2c04271d8a05",
    files: ["htdemucs.onnx", "htdemucs.check.json"],
  },
  runtime:
    supportedMac && runtimeDigest
      ? {
          file: `automix-runtime-${process.platform}-${process.arch}.zip`,
          bytes: runtimeDigest[0],
          sha256: runtimeDigest[1],
          files: AUTOMIX_RUNTIME_FILES,
        }
      : null,
};
