import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { AUTOMIX_RUNTIME_FILES, AUTOMIX_WORKER } from "../electron/main/services/automix/assets";
import { extractAutoMixPackage } from "../electron/main/services/automix/runtime";

const version = process.platform === "darwin" && process.arch === "x64" ? "1.23.2" : "1.24.4";
const identity = `${process.platform}-${process.arch}`;
const target = path.resolve(process.argv[2] ?? "node_modules/.cache/automix-runtime");
const hashes: Record<string, string> = {
  "onnxruntime-directml.nupkg": "57e9f11b73437bef7a309496135d4c1f96b1a8e9ddba60013fa27bfc1d788681",
  "directml.nupkg": "4e7cb7ddce8cf837a7a75dc029209b520ca0101470fcdf275c1f49736a3615b9",
  "onnxruntime-linux-x64-1.24.4.tgz":
    "3a211fbea252c1e66290658f1b735b772056149f28321e71c308942cdb54b747",
  "onnxruntime-linux-aarch64-1.24.4.tgz":
    "866109a9248d057671a039b9d725be4bd86888e3754140e6701ec621be9d4d7e",
  "onnxruntime-osx-arm64-1.24.4.tgz":
    "93787795f47e1eee369182e43ed51b9e5da0878ab0346aecf4258979b8bba989",
  "onnxruntime-osx-x86_64-1.23.2.tgz":
    "d10359e16347b57d9959f7e80a225a5b4a66ed7d7e007274a15cae86836485a6",
};

/**
 * 分块计算二进制摘要，打包期间不持有完整运行库
 * @param file - 待校验文件
 * @returns SHA256 摘要
 */
const digest = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};

/** 构建当前系统的独立包，提供模型目录时同时执行打包后推理校验 */
const main = async (): Promise<void> => {
  if (
    !["win32", "darwin", "linux"].includes(process.platform) ||
    !["x64", "arm64"].includes(process.arch)
  )
    throw new Error(`不支持的构建平台 ${identity}`);
  await mkdir(target, { recursive: true });
  execFileSync("cargo", ["build", "-p", "automix-worker", "--release", "--locked"], {
    stdio: "inherit",
  });
  const staging = path.join(target, identity + "-files");
  await mkdir(staging, { recursive: true });
  await copyFile(
    path.resolve(process.env.CARGO_TARGET_DIR ?? "target", "release", AUTOMIX_WORKER),
    path.join(staging, AUTOMIX_WORKER),
  );
  if (process.platform === "darwin")
    execFileSync("codesign", ["--force", "--sign", "-", path.join(staging, AUTOMIX_WORKER)]);
  const archiveTarget: Record<string, string> = {
    "darwin-arm64": "osx-arm64",
    "darwin-x64": "osx-x86_64",
    "linux-arm64": "linux-aarch64",
    "linux-x64": "linux-x64",
  };
  const archiveName = `onnxruntime-${archiveTarget[identity]}-${version}.tgz`;
  const sources =
    process.platform === "win32"
      ? [
          {
            file: "onnxruntime-directml.nupkg",
            url: "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime.directml/1.24.4/microsoft.ml.onnxruntime.directml.1.24.4.nupkg",
          },
          {
            file: "directml.nupkg",
            url: "https://api.nuget.org/v3-flatcontainer/microsoft.ai.directml/1.15.4/microsoft.ai.directml.1.15.4.nupkg",
          },
        ]
      : [
          {
            file: archiveName,
            url: `https://github.com/microsoft/onnxruntime/releases/download/v${version}/${archiveName}`,
          },
        ];
  for (const source of sources) {
    const archive = path.join(target, source.file);
    if (!(await stat(archive).catch(() => null))) {
      const response = await fetch(source.url);
      if (!response.ok || !response.body)
        throw new Error(`下载失败 ${response.status}: ${source.url}`);
      // 先写临时文件，下载中断不会留下被当作已缓存的半个文件
      await pipeline(Readable.from(response.body), createWriteStream(archive + ".part"));
      await rename(archive + ".part", archive);
    }
    if ((await digest(archive)) !== hashes[source.file]) {
      await rm(archive, { force: true });
      throw new Error(`官方源文件校验失败 ${source.file}`);
    }
    const unpacked = await mkdtemp(path.join(target, source.file + "-"));
    try {
      if (source.file.endsWith(".nupkg")) {
        await extractAutoMixPackage(archive, unpacked, new AbortController().signal);
        if (source.file === "onnxruntime-directml.nupkg") {
          for (const file of ["onnxruntime.dll", "onnxruntime_providers_shared.dll"])
            await copyFile(
              path.join(unpacked, `runtimes/win-${process.arch}/native`, file),
              path.join(staging, file),
            );
          for (const file of ["LICENSE", "ThirdPartyNotices.txt"])
            await copyFile(path.join(unpacked, file), path.join(staging, file + ".onnxruntime"));
        } else {
          await copyFile(
            path.join(
              unpacked,
              `bin/${process.arch === "arm64" ? "arm64-win" : "x64-win"}/DirectML.dll`,
            ),
            path.join(staging, "DirectML.dll"),
          );
          await copyFile(
            path.join(unpacked, "LICENSE.txt"),
            path.join(staging, "LICENSE.DirectML.txt"),
          );
        }
      } else {
        execFileSync("tar", ["-xf", archive, "-C", unpacked]);
        const root = path.join(unpacked, source.file.replace(/\.tgz$/, ""));
        const library =
          process.platform === "darwin" ? "libonnxruntime.dylib" : "libonnxruntime.so";
        await copyFile(path.join(root, "lib", library), path.join(staging, library));
        for (const file of ["LICENSE", "ThirdPartyNotices.txt"])
          await copyFile(path.join(root, file), path.join(staging, file));
      }
    } finally {
      await rm(unpacked, { recursive: true, force: true });
    }
  }
  if (process.platform === "win32") {
    const vswhere = path.join(
      process.env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
      "Microsoft Visual Studio/Installer/vswhere.exe",
    );
    const found = execFileSync(
      vswhere,
      [
        "-latest",
        "-products",
        "*",
        "-find",
        // 只匹配桌面版 CRT，递归通配会先选中 onecore 子目录
        `VC/Redist/MSVC/*/${process.arch}/Microsoft.VC*.CRT/msvcp140.dll`,
      ],
      { encoding: "utf8" },
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
    if (!found.length) throw new Error(`构建机缺少 ${process.arch} Visual C++ 可再发行组件`);
    // 同一安装可能包含多版 CRT，旧版本缺少新 ONNX Runtime 所需的符号
    const directory = path.dirname(found[0]);
    for (const file of ["msvcp140.dll", "msvcp140_1.dll", "vcruntime140.dll", "vcruntime140_1.dll"])
      await copyFile(path.join(directory, file), path.join(staging, file));
    await writeFile(
      path.join(staging, "VisualCpp.txt"),
      `Microsoft Visual C++ Redistributable ${path.basename(path.dirname(path.dirname(directory)))}\nhttps://visualstudio.microsoft.com/license-terms/\n`,
    );
  }
  const contents = await Promise.all(
    AUTOMIX_RUNTIME_FILES.map(async (file) => ({
      file,
      bytes: (await stat(path.join(staging, file))).size,
      sha256: await digest(path.join(staging, file)),
    })),
  );
  const manifest = {
    version: "rust-1",
    platform: process.platform,
    arch: process.arch,
    onnxruntime: version,
    contents,
  };
  await writeFile(path.join(staging, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(
    path.join(staging, "SOURCES.json"),
    JSON.stringify(
      sources.map((source) => ({ ...source, sha256: hashes[source.file] })),
      null,
      2,
    ),
  );
  await copyFile("LICENSE", path.join(staging, "LICENSE.SPlayer"));
  const archive = path.join(target, `automix-runtime-${identity}.zip`);
  const zip = new ZipFile();
  const writing = pipeline(zip.outputStream, createWriteStream(archive));
  for (const file of (await readdir(staging)).sort())
    zip.addFile(path.join(staging, file), file, {
      mtime: new Date("2000-01-01T00:00:00Z"),
      mode: file === AUTOMIX_WORKER ? 0o100755 : 0o100644,
    });
  zip.end();
  await writing;
  const result = {
    ...manifest,
    file: path.basename(archive),
    bytes: (await stat(archive)).size,
    sha256: await digest(archive),
    sources,
  };
  await writeFile(path.join(target, identity + ".json"), JSON.stringify(result, null, 2));
  if (process.argv[3]) {
    const verification = await mkdtemp(path.join(target, "verify-"));
    const signal = new AbortController().signal;
    try {
      await extractAutoMixPackage(archive, verification, signal);
      for (const [kind, prefix] of [
        ["beat", "beat-this"],
        ["demucs", "htdemucs"],
      ] as const) {
        const models = path.join(verification, kind);
        await mkdir(models);
        await extractAutoMixPackage(
          path.resolve(process.argv[3], `automix-${kind}-v2.zip`),
          models,
          signal,
        );
        const output = execFileSync(path.join(verification, AUTOMIX_WORKER), [], {
          input: JSON.stringify({
            kind,
            model: path.join(models, prefix + ".onnx"),
            windows: [],
            cpuOnly: true,
          }),
          encoding: "utf8",
        });
        if (JSON.parse(output).backend !== "CPU") throw new Error(`${kind} CPU 推理校验失败`);
        console.log(`${identity} ${kind} 推理校验通过: ${output.trim()}`);
      }
    } finally {
      await rm(verification, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(result));
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
