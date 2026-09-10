use crate::domain::{AppError, AppResult};

/// Extensions that can be imported as article notes. Mirrors
/// `IMPORT_SOURCE_EXTENSIONS` in `src/features/import/import-article.ts`.
pub const IMPORT_SOURCE_EXTENSIONS: [&str; 6] = ["txt", "md", "markdown", "html", "htm", "docx"];

/// Read a file chosen by the "import article" flow.
///
/// Decoding strategy: UTF-8 first (the common case), then GBK — the de-facto
/// encoding of Chinese Windows txt/html exports. BOM-prefixed UTF-8 is
/// stripped. docx files are not decoded here; they are handled by the
/// webview (mammoth) which reads the raw bytes via this command's
/// `bytes_base64` output.
pub fn read_import_source(source_path: &str) -> AppResult<ImportSource> {
    let path = std::path::PathBuf::from(source_path);
    let metadata = std::fs::metadata(&path)
        .map_err(|error| AppError::io("Inspect import source", &path, error))?;
    if !metadata.is_file() {
        return Err(AppError::not_found("Import source is not a file."));
    }
    if metadata.len() > MAX_IMPORT_SOURCE_BYTES {
        return Err(import_source_too_large());
    }
    let bytes = std::fs::read(&path)
        .map_err(|error| AppError::io("Read import source", &path, error))?;
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("import.txt")
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if !IMPORT_SOURCE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(unsupported_import_source());
    }
    Ok(ImportSource {
        file_name,
        extension,
        text: decode_import_text(&bytes),
        bytes_base64: encode_base64(&bytes),
    })
}

fn encode_base64(bytes: &[u8]) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    STANDARD.encode(bytes)
}

/// 20MB cap: article imports are text; anything larger is suspicious.
pub const MAX_IMPORT_SOURCE_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug)]
pub struct ImportSource {
    pub file_name: String,
    pub extension: String,
    /// Decoded text — meaningful for txt/md/html; docx callers use bytes_base64.
    pub text: String,
    pub bytes_base64: String,
}

impl ImportSource {
    pub fn into_payload(self) -> ImportSourcePayload {
        ImportSourcePayload {
            file_name: self.file_name,
            extension: self.extension,
            text: self.text,
            bytes_base64: self.bytes_base64,
        }
    }
}

/// Serializable shape returned to the webview by `read_import_source`.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourcePayload {
    pub file_name: String,
    pub extension: String,
    pub text: String,
    pub bytes_base64: String,
}

fn import_source_too_large() -> AppError {
    AppError::new(
        crate::domain::ErrorCode::Io,
        "Import source exceeds its size limit.",
    )
}

fn unsupported_import_source() -> AppError {
    AppError::new(
        crate::domain::ErrorCode::UnsupportedExtension,
        "Unsupported import source file type.",
    )
}

fn decode_import_text(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return String::from_utf8_lossy(&bytes[3..]).into_owned();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    let (decoded, _, had_errors) = encoding_rs::GBK.decode(bytes);
    if had_errors {
        String::from_utf8_lossy(bytes).into_owned()
    } else {
        decoded.into_owned()
    }
}
