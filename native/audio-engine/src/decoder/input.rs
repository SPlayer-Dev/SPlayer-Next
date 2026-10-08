use std::io::{self, BufReader, Read, Seek, SeekFrom};

/// 为附带 ID3 前缀的 MP4 提供从容器起点计数的读取视图
pub(crate) struct AudioInput<R> {
    inner: BufReader<R>,
    offset: u64,
}

impl<R: Read + Seek> AudioInput<R> {
    /// 仅跳过紧接 MP4 文件类型块的合法 ID3 标签，其他格式保留原始内容
    pub(crate) fn new(inner: R) -> io::Result<Self> {
        // 探测后在固定大小缓冲内回退，普通网络歌曲无需为重读文件头再次请求
        let mut inner = BufReader::new(inner);
        let mut header = [0_u8; 10];
        let mut offset = 0;
        match inner.read_exact(&mut header) {
            Ok(())
                if &header[..3] == b"ID3"
                    && (2..=4).contains(&header[3])
                    && header[4] != 0xff
                    && header[6..].iter().all(|byte| byte & 0x80 == 0) =>
            {
                let size = header[6..]
                    .iter()
                    .fold(0_u64, |size, byte| (size << 7) | u64::from(*byte));
                let footer = if header[3] == 4 && header[5] & 0x10 != 0 {
                    10
                } else {
                    0
                };
                let start = 10 + size + footer;
                inner.seek_relative((start - 10) as i64)?;
                let mut atom = [0_u8; 8];
                match inner.read_exact(&mut atom) {
                    Ok(())
                        if &atom[4..] == b"ftyp"
                            && u32::from_be_bytes(atom[..4].try_into().unwrap()) >= 16 =>
                    {
                        offset = start
                    }
                    Ok(()) => {}
                    Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {}
                    Err(error) => return Err(error),
                }
            }
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => {}
            Err(error) => return Err(error),
        }
        let position = inner.stream_position()?;
        inner.seek_relative(offset as i64 - position as i64)?;
        Ok(Self { inner, offset })
    }
}

impl<R: Read> Read for AudioInput<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        self.inner.read(buf)
    }
}

impl<R: Read + Seek> Seek for AudioInput<R> {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        // FFmpeg 用 End(0) 查询文件长度，三个 seek 方向都必须处于同一坐标系
        let target = match pos {
            SeekFrom::Start(position) => self.offset.checked_add(position),
            SeekFrom::Current(delta) => self.inner.stream_position()?.checked_add_signed(delta),
            SeekFrom::End(delta) => self.inner.seek(SeekFrom::End(0))?.checked_add_signed(delta),
        }
        .filter(|target| *target >= self.offset)
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "音频读取位置超出范围"))?;
        let position = self.inner.stream_position()?;
        if let Ok(delta) = i64::try_from(i128::from(target) - i128::from(position)) {
            self.inner.seek_relative(delta)?;
        } else {
            self.inner.seek(SeekFrom::Start(target))?;
        }
        Ok(target - self.offset)
    }
}

#[cfg(test)]
#[path = "tests/input.rs"]
mod tests;
