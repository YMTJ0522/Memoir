use crate::domain::{AppError, AppResult};
use std::{
    fs,
    io,
    path::{Component, Path},
    time::{SystemTime, UNIX_EPOCH},
};

pub const ATTACHMENTS_DIR: &str = "attachments";
pub const MAX_ATTACHMENT_BYTES: usize = 20 * 1024 * 1024;
pub const MAX_VIDEO_ATTACHMENT_BYTES: usize = 200 * 1024 * 1024;
pub const MAX_AUDIO_ATTACHMENT_BYTES: usize = 100 * 1024 * 1024;
/// Documents and archives stream from disk on import, so the cap only guards
/// against absurd files — two gigabytes keeps large project archives usable
/// without a meaningful memory footprint.
pub const MAX_LARGE_ATTACHMENT_BYTES: usize = 2 * 1024 * 1024 * 1024;
pub const IMAGE_EXTENSIONS: [&str; 8] =
    ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];
pub const VIDEO_EXTENSIONS: [&str; 7] =
    ["mp4", "webm", "mov", "m4v", "avi", "mkv", "wmv"];
pub const AUDIO_EXTENSIONS: [&str; 5] = ["mp3", "wav", "ogg", "m4a", "flac"];
pub const DOCUMENT_EXTENSIONS: [&str; 15] = [
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", //
    "rtf", "odt", "ods", "odp", "epub",
];
pub const ARCHIVE_EXTENSIONS: [&str; 8] =
    ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"];
pub const ATTACHMENT_EXTENSIONS: [&str; 43] = [
    // images
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg", //
    // videos
    "mp4", "webm", "mov", "m4v", "avi", "mkv", "wmv", //
    // audio
    "mp3", "wav", "ogg", "m4a", "flac", //
    // documents
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv", "md", //
    "rtf", "odt", "ods", "odp", "epub", //
    // archives
    "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
];

pub fn is_video_extension(extension: &str) -> bool {
    VIDEO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_audio_extension(extension: &str) -> bool {
    AUDIO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_document_extension(extension: &str) -> bool {
    DOCUMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_archive_extension(extension: &str) -> bool {
    ARCHIVE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn max_attachment_bytes_for_extension(extension: &str) -> usize {
    if is_video_extension(extension) {
        MAX_VIDEO_ATTACHMENT_BYTES
    } else if is_audio_extension(extension) {
        MAX_AUDIO_ATTACHMENT_BYTES
    } else if is_document_extension(extension) || is_archive_extension(extension) {
        MAX_LARGE_ATTACHMENT_BYTES
    } else {
        MAX_ATTACHMENT_BYTES
    }
}

pub fn is_attachment_extension(extension: &str) -> bool {
    ATTACHMENT_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
}

pub fn is_attachment_root_name(name: &std::ffi::OsStr) -> bool {
    name == ATTACHMENTS_DIR
}

pub fn is_attachment_relative(relative: &Path) -> bool {
    let mut components = relative.components();
    matches!(
        components.next(),
        Some(Component::Normal(name)) if is_attachment_root_name(name)
    ) && components.next().is_some()
}

pub fn attachment_month_dir() -> String {
    attachment_month_dir_at(SystemTime::now())
}

pub fn attachment_month_dir_at(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let (year, month) = unix_utc_year_month(secs);
    format!("{year:04}-{month:02}")
}

fn unix_utc_year_month(secs: u64) -> (i32, u32) {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    (year as i32, month as u32)
}

pub fn validate_attachment_extension(path: &Path) -> AppResult<String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if is_attachment_extension(&extension) {
        Ok(extension)
    } else {
        Err(AppError::unsupported_attachment())
    }
}

pub fn mime_from_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "m4v" => "video/x-m4v",
        "avi" => "video/x-msvideo",
        "mkv" => "video/x-matroska",
        "wmv" => "video/x-ms-wmv",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "txt" | "csv" | "md" => "text/plain",
        "rtf" => "application/rtf",
        "odt" => "application/vnd.oasis.opendocument.text",
        "ods" => "application/vnd.oasis.opendocument.spreadsheet",
        "odp" => "application/vnd.oasis.opendocument.presentation",
        "epub" => "application/epub+zip",
        "zip" => "application/zip",
        "rar" => "application/vnd.rar",
        "7z" => "application/x-7z-compressed",
        "tar" => "application/x-tar",
        "gz" => "application/gzip",
        "tgz" => "application/gzip",
        "bz2" => "application/x-bzip2",
        "xz" => "application/x-xz",
        _ => "application/octet-stream",
    }
}

pub fn extension_from_mime(mime: &str) -> Option<&'static str> {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/bmp" | "image/x-ms-bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        "image/svg+xml" => Some("svg"),
        "video/mp4" => Some("mp4"),
        "video/webm" => Some("webm"),
        "video/quicktime" => Some("mov"),
        "video/x-m4v" => Some("m4v"),
        "video/x-msvideo" | "video/avi" => Some("avi"),
        "video/x-matroska" => Some("mkv"),
        "video/x-ms-wmv" => Some("wmv"),
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/wav" | "audio/x-wav" => Some("wav"),
        "audio/ogg" => Some("ogg"),
        "audio/mp4" | "audio/x-m4a" => Some("m4a"),
        "audio/flac" => Some("flac"),
        "application/pdf" => Some("pdf"),
        "application/msword" => Some("doc"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => Some("docx"),
        "application/vnd.ms-excel" => Some("xls"),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => Some("xlsx"),
        "application/vnd.ms-powerpoint" => Some("ppt"),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => Some("pptx"),
        "text/plain" => Some("txt"),
        "text/csv" => Some("csv"),
        "text/markdown" => Some("md"),
        "application/rtf" => Some("rtf"),
        "application/vnd.oasis.opendocument.text" => Some("odt"),
        "application/vnd.oasis.opendocument.spreadsheet" => Some("ods"),
        "application/vnd.oasis.opendocument.presentation" => Some("odp"),
        "application/epub+zip" => Some("epub"),
        "application/zip" => Some("zip"),
        "application/x-zip-compressed" => Some("zip"),
        "application/vnd.rar" => Some("rar"),
        "application/x-7z-compressed" => Some("7z"),
        "application/x-tar" => Some("tar"),
        "application/gzip" => Some("gz"),
        "application/x-gzip" => Some("gz"),
        "application/x-bzip2" => Some("bz2"),
        "application/x-xz" => Some("xz"),
        _ => None,
    }
}

pub fn sniff_image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Some("png");
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return Some("jpg");
    }
    if bytes.starts_with(b"GIF8") {
        return Some("gif");
    }
    if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WEBP" {
        return Some("webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"avif" || brand == b"avis" {
            return Some("avif");
        }
    }
    None
}

pub fn looks_like_svg(bytes: &[u8]) -> bool {
    let preview = String::from_utf8_lossy(&bytes[..bytes.len().min(512)]).to_ascii_lowercase();
    preview.contains("<svg") || (preview.contains("<?xml") && preview.contains("svg"))
}

pub fn sanitize_attachment_file_name(name: &str) -> String {
    let normalized = name.replace('\\', "/");
    let base = normalized.rsplit('/').next().unwrap_or(name).trim();
    let mut slug = String::new();
    let mut last_dash = false;
    for character in base.chars() {
        if character == '.' {
            if !slug.is_empty() && !slug.ends_with('.') {
                slug.push('.');
            }
            last_dash = false;
            continue;
        }
        if character.is_alphanumeric() || character == '_' {
            slug.push(character);
            last_dash = false;
            continue;
        }
        if !last_dash && !slug.is_empty() {
            slug.push('-');
            last_dash = true;
        }
    }
    let slug = slug.trim_matches(|c| c == '.' || c == '-');
    if slug.is_empty() {
        "image".into()
    } else {
        slug.into()
    }
}

pub fn resolve_attachment_extension(
    file_name: Option<&str>,
    mime_type: Option<&str>,
    bytes: &[u8],
) -> AppResult<String> {
    let named = file_name
        .and_then(|name| Path::new(name).extension())
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| is_attachment_extension(value));
    let mimed = mime_type
        .and_then(extension_from_mime)
        .map(str::to_string);
    let extension = sniff_image_extension(bytes)
        .map(str::to_string)
        .or(named)
        .or(mimed)
        .ok_or_else(AppError::unsupported_attachment)?;
    // Video files have no image magic bytes; their declared extension is the
    // source of truth, so size checks happen after the extension is settled.
    if bytes.len() > max_attachment_bytes_for_extension(&extension) {
        return Err(AppError::attachment_too_large());
    }
    if bytes.is_empty() {
        return Err(AppError::unsupported_attachment());
    }
    if extension == "svg" && !looks_like_svg(bytes) {
        return Err(AppError::unsupported_attachment());
    }
    Ok(extension)
}

/// Streaming counterpart of `resolve_attachment_extension` for imports: the
/// file name settles the extension, and only the first 512 bytes are read
/// for the SVG sanity check, so a multi-gigabyte import never loads the
/// whole file into memory. The consumed header bytes are handed back so the
/// caller can chain them in front of the rest of the stream.
pub fn validate_attachment_import(
    file_name: Option<&str>,
    metadata: &fs::Metadata,
    reader: &mut impl io::Read,
) -> AppResult<(String, Vec<u8>)> {
    let extension = file_name
        .and_then(|name| Path::new(name).extension())
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| is_attachment_extension(value))
        .ok_or_else(AppError::unsupported_attachment)?;
    if metadata.len() > max_attachment_bytes_for_extension(&extension) as u64 {
        return Err(AppError::attachment_too_large());
    }
    if metadata.len() == 0 {
        return Err(AppError::unsupported_attachment());
    }
    let mut header = [0_u8; 512];
    let mut read = 0;
    while read < header.len() {
        match reader.read(&mut header[read..]) {
            Ok(0) => break,
            Ok(count) => read += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(_) => return Err(AppError::unsupported_attachment()),
        }
    }
    // Empty files slip past the metadata length check on some filesystems.
    if read == 0 {
        return Err(AppError::unsupported_attachment());
    }
    if extension == "svg" && !looks_like_svg(&header[..read]) {
        return Err(AppError::unsupported_attachment());
    }
    Ok((extension, header[..read].to_vec()))
}

pub fn unique_file_name(preferred: &str, existing: impl Fn(&str) -> bool) -> String {
    let path = Path::new(preferred);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("image");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png");
    for index in 0..1000 {
        let candidate = if index == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{index}.{extension}")
        };
        if !existing(&candidate) {
            return candidate;
        }
    }
    format!("{stem}-overflow.{extension}")
}
