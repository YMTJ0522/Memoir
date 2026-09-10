use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// One entry in `.memoir-trash/manifest.json`. Records enough information to
/// restore a trashed file back to its original workspace-relative path.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    /// File name inside the trash directory, e.g. `1757430000-note.md`.
    pub trash_name: String,
    /// Original workspace-relative path (forward slashes), e.g. `日记/idea.md`.
    pub original_path: String,
    /// Workspace-relative path of the trash file, e.g. `.memoir-trash/1757430000-note.md`.
    pub trash_path: String,
    pub deleted_at_ms: u128,
    pub size: u64,
    /// True when the item was an attachment (vs. a note).
    #[serde(default)]
    pub is_attachment: bool,
}

/// The manifest persisted next to the trashed files.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashManifest {
    pub entries: Vec<TrashEntry>,
}

impl TrashManifest {
    pub fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    }

    #[allow(dead_code)]
    pub fn remove_by_trash_name(&mut self, trash_name: &str) -> Option<TrashEntry> {
        let index = self
            .entries
            .iter()
            .position(|entry| entry.trash_name == trash_name)?;
        Some(self.entries.remove(index))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_round_trips_json() {
        let manifest = TrashManifest {
            entries: vec![TrashEntry {
                trash_name: "1757430000-note.md".into(),
                original_path: "日记/idea.md".into(),
                trash_path: ".memoir-trash/1757430000-note.md".into(),
                deleted_at_ms: 1757430000,
                size: 128,
                is_attachment: false,
            }],
        };
        let json = serde_json::to_string(&manifest).unwrap();
        assert!(json.contains("\"trashName\""));
        let parsed: TrashManifest = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, manifest);
    }

    #[test]
    fn remove_by_trash_name_returns_and_removes() {
        let mut manifest = TrashManifest::default();
        manifest.entries.push(TrashEntry {
            trash_name: "a.md".into(),
            original_path: "a.md".into(),
            trash_path: ".memoir-trash/a.md".into(),
            deleted_at_ms: 1,
            size: 1,
            is_attachment: false,
        });
        manifest.entries.push(TrashEntry {
            trash_name: "b.md".into(),
            original_path: "b.md".into(),
            trash_path: ".memoir-trash/b.md".into(),
            deleted_at_ms: 2,
            size: 2,
            is_attachment: true,
        });
        let removed = manifest.remove_by_trash_name("a.md").unwrap();
        assert_eq!(removed.original_path, "a.md");
        assert_eq!(manifest.entries.len(), 1);
        assert!(manifest.remove_by_trash_name("missing.md").is_none());
    }
}
