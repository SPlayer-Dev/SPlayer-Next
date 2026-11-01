use super::*;

#[test]
fn recognizes_default_sink_metadata_keys() {
    assert!(is_default_sink_property(Some("default.audio.sink")));
    assert!(is_default_sink_property(Some(
        "default.configured.audio.sink"
    )));
    assert!(!is_default_sink_property(Some("default.audio.source")));
}

#[test]
fn ignores_sink_runtime_state_changes() {
    assert!(is_relevant_sink_change(NodeChangeMask::PROPS));
    assert!(is_relevant_sink_change(NodeChangeMask::PARAMS));
    assert!(!is_relevant_sink_change(NodeChangeMask::STATE));
}
