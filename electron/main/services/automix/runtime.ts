import { createWriteStream } from "node:fs";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { open } from "yauzl";

/**
 * 逐文件解压组件，限制路径、文件类型和总大小
 * @param archive - 下载完成的 ZIP 文件
 * @param destination - 新建的安装暂存目录
 * @param signal - 用户取消信号
 */
export const extractAutoMixPackage = async (
  archive: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> => {
  const zip = await new Promise<import("yauzl").ZipFile>((resolve, reject) => {
    open(archive, { lazyEntries: true, autoClose: true }, (error, file) =>
      error || !file ? reject(error) : resolve(file),
    );
  });
  await new Promise<void>((resolve, reject) => {
    let extracted = 0;
    let reading = false;
    /**
     * 关闭文件句柄并结束安装
     * @param error - 解压失败原因
     */
    const fail = (error: unknown): void => {
      zip.close();
      reject(error);
    };
    /** 用户取消时终止 ZIP 流 */
    const abort = (): void => {
      zip.close();
      if (!reading) reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    zip.once("error", fail);
    zip.once("close", () => signal.removeEventListener("abort", abort));
    zip.once("end", resolve);
    zip.on("entry", (entry: import("yauzl").Entry) => {
      reading = true;
      void (async () => {
        signal.throwIfAborted();
        const target = path.resolve(destination, entry.fileName);
        const mode = entry.externalFileAttributes >>> 16;
        if (
          !target.startsWith(path.resolve(destination) + path.sep) ||
          (mode & 0o170000) === 0o120000 ||
          entry.fileName.includes("\\")
        )
          throw new Error("组件压缩包含无效路径");
        extracted += entry.uncompressedSize;
        if (extracted > 600 * 1024 * 1024) throw new Error("组件解压大小超出限制");
        if (entry.fileName.endsWith("/")) await mkdir(target, { recursive: true });
        else {
          await mkdir(path.dirname(target), { recursive: true });
          const stream = await new Promise<import("node:stream").Readable>((res, rej) => {
            zip.openReadStream(entry, (error, source) =>
              error || !source ? rej(error) : res(source),
            );
          });
          await pipeline(stream, createWriteStream(target, { flags: "wx" }), { signal });
          if (process.platform !== "win32" && mode & 0o111) await chmod(target, 0o755);
        }
        reading = false;
        signal.throwIfAborted();
        zip.readEntry();
      })().catch(fail);
    });
    if (signal.aborted) abort();
    else zip.readEntry();
  });
};
