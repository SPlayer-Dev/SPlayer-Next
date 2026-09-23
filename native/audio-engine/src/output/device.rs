use super::*;

/// 设备显示名：cpal 0.18 起 `Device::name()` 并入 `description().name()`。
/// 可能重复、可被用户改名，只用于展示和旧配置回退匹配
fn persisted_device_name(device: &cpal::Device) -> Option<String> {
    device.description().ok().map(|desc| desc.name().to_owned())
}

/// 设备稳定 ID：WASAPI 端点 ID / CoreAudio UID / PipeWire node.name，跨重启和改名都稳定
pub(super) fn device_id_string(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

/// cpal 的 PipeWire 后端会合成「跟随系统默认」的哨兵设备，它们不对应真实节点，
/// 选择系统默认时由 `open_device(None)` 取用，不应混进给用户挑选的设备列表
fn is_synthetic_default_device(name: &str) -> bool {
    cfg!(target_os = "linux") && matches!(name, "default_output" | "default_sink")
}

/// 按选择器查找输出设备，优先按稳定 ID 匹配，失败后回退到显示名。
///
/// 回退是为 1.0.0 及更早版本存下的显示名配置准备的：命中后由 JS 侧改写成 ID。
/// 显示名可能重复，回退路径取首个匹配，因此仅用于迁移，不作为长期身份。
fn find_device(host: &cpal::Host, selector: &str) -> Option<cpal::Device> {
    if let Ok(parsed) = selector.parse::<cpal::DeviceId>() {
        return host.device_by_id(&parsed);
    }
    host.output_devices()
        .ok()?
        .find(|device| persisted_device_name(device).as_deref() == Some(selector))
}

/// 枚举所有输出设备，返回 `(id, name, is_default)` 列表
/// 纯查询，不涉及流状态，调用方任意线程都能用
pub fn list_output_devices() -> Vec<(String, String, bool)> {
    run_in_mta(|| {
        let host = cpal::default_host();
        let default_id = host
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        let list = host
            .output_devices()
            .map(|devices| {
                devices
                    .filter_map(|device| {
                        let name = persisted_device_name(&device)?;
                        if is_synthetic_default_device(&name) {
                            return None;
                        }
                        let id = device_id_string(&device)?;
                        let is_default = default_id.as_deref() == Some(id.as_str());
                        Some((id, name, is_default))
                    })
                    .collect()
            })
            .unwrap_or_default();
        debug!(
            default_id = default_id.as_deref().unwrap_or("-"),
            devices = ?list,
            "枚举音频输出设备"
        );
        Ok(list)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备名
pub fn default_device_name() -> Option<String> {
    run_in_mta(|| {
        let name = cpal::default_host()
            .default_output_device()
            .and_then(|device| persisted_device_name(&device));
        Ok(name)
    })
    .unwrap_or_default()
}

/// 取系统默认输出设备稳定 ID，供主进程做切换检测（显示名可重复、可被改名）
pub fn default_device_id() -> Option<String> {
    run_in_mta(|| {
        let id = cpal::default_host()
            .default_output_device()
            .and_then(|device| device_id_string(&device));
        Ok(id)
    })
    .unwrap_or_default()
}

/// 独占模式协商结果类型：非 Windows 平台无此概念
#[cfg(target_os = "windows")]
type ExclusiveFormatOpt = Option<crate::output::wasapi::ExclusiveFormat>;
#[cfg(not(target_os = "windows"))]
type ExclusiveFormatOpt = ();

/// 按设备 ID（`None` 为默认设备）解析设备与输出配置。
/// 设备支持 `requested_sample_rate` 时按该速率打开，否则使用设备默认配置。
/// 样本格式优先沿用设备默认格式：PipeWire 等后端上报的 supported 列表包含
/// 全部合成格式（顺序 I8…F64），首个条目不代表设备真实能力，直接采用会导致
/// 以 i8 打开输出流而严重劣化音质。
fn open_device_internal(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
    source_bits: Option<u32>,
    exclusive: Option<&ExclusiveFallbackCallback>,
) -> Result<(cpal::Device, SupportedStreamConfig, ExclusiveFormatOpt)> {
    let host = cpal::default_host();
    info!(backend = ?host.id(), requested_sample_rate, "协商音频输出流格式");
    let device = match device_id {
        Some(selector) => {
            find_device(&host, selector).with_context(|| format!("输出设备 '{selector}' 不存在"))?
        }
        None => {
            let default = host.default_output_device().context("没有可用的输出设备")?;
            let default_id = device_id_string(&default).context("读取默认输出设备 ID 失败")?;
            find_device(&host, &default_id).context("解析默认输出设备端点失败")?
        }
    };
    let default_config = device
        .default_output_config()
        .context("读取输出设备配置失败")?;

    #[cfg(target_os = "windows")]
    {
        let _ = requested_sample_rate;
        let mut exclusive_format = None;
        if let Some(on_fallback) = exclusive {
            // 独占模式：优先按音源采样率/位深协商，失败时回退共享并上报原因
            match crate::output::wasapi::negotiate_exclusive_format(
                device_id_string(&device).as_deref(),
                requested_sample_rate.unwrap_or(default_config.sample_rate()),
                source_bits.unwrap_or(24),
                default_config.channels(),
            ) {
                Ok(format) => exclusive_format = Some(format),
                Err(error) => {
                    warn!(reason = error.reason(), error = %error, "独占模式协商失败，回退共享模式");
                    on_fallback(error.reason());
                }
            }
        }
        Ok((device, default_config, exclusive_format))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (source_bits, exclusive);
        let config = match requested_sample_rate {
            Some(rate) => {
                if rate == default_config.sample_rate() {
                    default_config
                } else {
                    let default_format = default_config.sample_format();
                    let default_channels = default_config.channels();
                    let at_rate = device.supported_output_configs().ok().and_then(|configs| {
                        let configs: Vec<_> = configs.collect();
                        configs
                            .iter()
                            .copied()
                            .find(|range| {
                                range.min_sample_rate() <= rate
                                    && rate <= range.max_sample_rate()
                                    && range.sample_format() == default_format
                                    && range.channels() == default_channels
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.sample_format() == default_format
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                        && range.channels() == default_channels
                                })
                            })
                            .or_else(|| {
                                configs.iter().copied().find(|range| {
                                    range.min_sample_rate() <= rate
                                        && rate <= range.max_sample_rate()
                                })
                            })
                            .map(|range| range.with_sample_rate(rate))
                    });
                    at_rate.unwrap_or(default_config)
                }
            }
            None => default_config,
        };
        Ok((device, config, ()))
    }
}

pub(super) fn open_device(
    device_id: Option<&str>,
    requested_sample_rate: Option<u32>,
    source_bits: Option<u32>,
    exclusive: Option<&ExclusiveFallbackCallback>,
) -> Result<(cpal::Device, SupportedStreamConfig, ExclusiveFormatOpt)> {
    let id_owned = device_id.map(String::from);
    // 回退回调只在 MTA 工作线程被调用，Arc 在此克隆进闭包
    let fallback_owned = exclusive.cloned();
    run_in_mta(move || {
        open_device_internal(
            id_owned.as_deref(),
            requested_sample_rate,
            source_bits,
            fallback_owned.as_ref(),
        )
    })
}

#[cfg(test)]
#[path = "tests/device.rs"]
mod tests;
