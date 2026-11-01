use anyhow::{ensure, Context, Result};
use ort::{
    ep,
    logging::LogLevel,
    session::Session,
    value::{DynTensor, Tensor},
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    fs,
    io::{self, Read, Write},
    path::PathBuf,
    time::Instant,
};

mod beats;
mod demucs;
mod spectral;

#[derive(Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Beat,
    Demucs,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    kind: Kind,
    model: PathBuf,
    windows: Vec<Window>,
    #[serde(default)]
    cpu_only: bool,
}

#[derive(Deserialize)]
struct Window {
    input: PathBuf,
    output: PathBuf,
}

/// 读取有限的浮点窗口，拒绝残缺或非有限采样
/// @param path - 主进程导出的窗口
/// @returns 小端 FP32 采样
fn read_samples(path: &std::path::Path) -> Result<Vec<f32>> {
    let bytes = fs::read(path)?;
    ensure!(bytes.len().is_multiple_of(4), "窗口长度不完整");
    let samples: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|bytes| f32::from_le_bytes(*bytes))
        .collect();
    ensure!(
        samples.iter().all(|value| value.is_finite()),
        "窗口包含无效采样"
    );
    Ok(samples)
}

/// 流式写出小端浮点预测，不在 JSON 中传递音频
/// @param path - 临时输出路径
/// @param samples - 交错排列的预测或声部
fn write_samples(path: &std::path::Path, samples: &[f32]) -> Result<()> {
    let mut output = io::BufWriter::new(fs::File::create(path)?);
    for sample in samples {
        output.write_all(&sample.to_le_bytes())?;
    }
    output.flush()?;
    Ok(())
}

/// 生成与官方权重导出端一致的固定校验输入
/// @param kind - 节拍或分离模型
/// @returns 命名输入张量
fn probe(kind: Kind) -> Result<Vec<(&'static str, DynTensor)>> {
    let count = if kind == Kind::Beat {
        1500 * 128
    } else {
        2 * demucs::FRAMES
    };
    let scale = if kind == Kind::Beat { 4.0 } else { 0.2 };
    let samples: Vec<f32> = (0..count)
        .map(|index| {
            let value = (index as u32)
                .wrapping_mul(1664525)
                .wrapping_add(1013904223)
                & 65535;
            (value as f32 / 65535.0 - 0.5) * scale
        })
        .collect();
    if kind == Kind::Beat {
        Ok(vec![(
            "spectrogram",
            Tensor::from_array(([1, 1500, 128], samples))?.upcast(),
        )])
    } else {
        let spectrum = spectral::Spectral::new().forward(&samples);
        Ok(vec![
            (
                "waveform",
                Tensor::from_array(([1, 2, demucs::FRAMES], samples))?.upcast(),
            ),
            (
                "spectrum",
                Tensor::from_array(([1, 4, spectral::SIZE / 2, spectral::CELLS], spectrum))?
                    .upcast(),
            ),
        ])
    }
}

/// 校验执行后端的实际预测，GPU 不可用或数值不符时由调用方改用 CPU
/// @param session - 刚创建的执行会话
/// @param request - 本次模型请求
fn validate(session: &mut Session, request: &Request) -> Result<()> {
    let check: Value =
        serde_json::from_slice(&fs::read(request.model.with_extension("check.json"))?)?;
    let outputs = session.run(probe(request.kind)?)?;
    let expected = check["outputs"].as_array().context("模型缺少校验向量")?;
    ensure!(outputs.len() == expected.len(), "模型校验输出数量不符");
    for (index, reference) in expected.iter().enumerate() {
        let (_, samples) = outputs[index].try_extract_tensor::<f32>()?;
        let reference = reference.as_array().context("模型校验格式错误")?;
        ensure!(reference.len() == 128, "模型校验长度错误");
        for (at, value) in reference.iter().enumerate() {
            let expected = value.as_f64().context("模型校验值错误")? as f32;
            let actual = samples[at * (samples.len() - 1) / 127];
            ensure!(
                actual.is_finite() && (actual - expected).abs() <= 0.001 + expected.abs() * 0.001,
                "模型计算校验失败"
            );
        }
    }
    Ok(())
}

/// 获取当前分析进程的峰值工作集，不采样播放器或其他应用
/// @returns 峰值物理内存字节数
fn peak_memory() -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::{
            ProcessStatus::{GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
            Threading::GetCurrentProcess,
        };
        let mut counters = PROCESS_MEMORY_COUNTERS::default();
        let size = std::mem::size_of_val(&counters) as u32;
        if GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size).is_ok() {
            return counters.PeakWorkingSetSize as u64;
        }
        0
    }
    #[cfg(unix)]
    unsafe {
        let mut usage: libc::rusage = std::mem::zeroed();
        if libc::getrusage(libc::RUSAGE_SELF, &mut usage) != 0 {
            return 0;
        }
        let bytes = usage.ru_maxrss as u64;
        if cfg!(target_os = "macos") {
            bytes
        } else {
            bytes * 1024
        }
    }
}

/// 运行一批串行窗口，结果写完后结束进程并释放全部模型资源
/// @returns 发回主进程的紧凑结果
fn run() -> Result<Value> {
    let began = Instant::now();
    let mut input = String::new();
    io::stdin().take(256_001).read_to_string(&mut input)?;
    ensure!(input.len() <= 256_000, "分析请求过大");
    let request: Request = serde_json::from_str(&input)?;
    let executable = std::env::current_exe()?;
    let directory = executable.parent().context("分析进程路径无效")?;
    let library = if cfg!(windows) {
        "onnxruntime.dll"
    } else if cfg!(target_os = "macos") {
        "libonnxruntime.dylib"
    } else {
        "libonnxruntime.so"
    };
    ort::init_from(directory.join(library))?
        .with_name("AutoMix")
        .with_telemetry(false)
        .commit();
    let mut gpu = cfg!(windows) && !request.cpu_only;
    let (mut session, backend) = loop {
        let candidate = (|| -> Result<Session> {
            // 分离模型在 CPU 使用两条执行流及时释放张量，节拍模型仍按顺序执行
            let parallel = !gpu && request.kind == Kind::Demucs;
            let mut builder = Session::builder()?
                .with_intra_threads(4)?
                .with_inter_threads(if parallel { 2 } else { 1 })?
                .with_parallel_execution(parallel)?
                .with_memory_pattern(false)?
                .with_config_entry("session.intra_op.allow_spinning", "0")?
                .with_config_entry("session.inter_op.allow_spinning", "0")?
                .with_log_level(LogLevel::Error)?;
            let mut providers = Vec::new();
            if gpu {
                providers.push(
                    ep::DirectML::default()
                        .with_device_id(0)
                        .build()
                        .error_on_failure(),
                );
            }
            providers.push(ep::CPU::default().with_arena_allocator(false).build());
            builder = builder.with_execution_providers(providers)?;
            let mut session = builder.commit_from_file(&request.model)?;
            validate(&mut session, &request)?;
            Ok(session)
        })();
        match candidate {
            Ok(session) => break (session, if gpu { "DirectML" } else { "CPU" }),
            Err(error) if !gpu => return Err(error),
            Err(_) => gpu = false,
        }
    };
    let mut results = Vec::new();
    for window in request.windows {
        let samples = read_samples(&window.input)?;
        if request.kind == Kind::Beat {
            let output = beats::run(&mut session, &samples)?;
            write_samples(&window.output, &output)?;
            results.push(json!({"frames": samples.len() / 128}));
        } else {
            let (output, vocals) = demucs::run(&mut session, &samples)?;
            write_samples(&window.output, &output)?;
            results.push(json!({"frames": samples.len() / 2, "structure": {"vocals": vocals}}));
        }
    }
    Ok(
        json!({"windows": results, "backend": backend, "memoryMb": (peak_memory() as f64 / 1_048_576.0).round(), "seconds": began.elapsed().as_secs_f64()}),
    )
}

/// 只向标准输出写协议结果，失败原因由主进程统一记录
fn main() {
    match run() {
        Ok(result) => println!("{result}"),
        Err(error) => {
            eprintln!("{error:#}");
            std::process::exit(1);
        }
    }
}
