package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestReplaceContentHashOnlyUpdatesTopLevelField(t *testing.T) {
	line := `{"type":"session","content_hash":"old","meta":{"content_hash":"keep","items":[{"content_hash":"keep-array"}]}}`

	object := decodeTestObject(t, replaceContentHash(line, "new"))

	if got := object["content_hash"]; got != "new" {
		t.Fatalf("top-level content_hash = %v, want new", got)
	}
	meta := object["meta"].(map[string]any)
	if got := meta["content_hash"]; got != "keep" {
		t.Fatalf("nested meta.content_hash = %v, want keep", got)
	}
	items := meta["items"].([]any)
	item := items[0].(map[string]any)
	if got := item["content_hash"]; got != "keep-array" {
		t.Fatalf("nested array content_hash = %v, want keep-array", got)
	}
}

func TestReplacePrevContentHashOnlyUpdatesSegmentField(t *testing.T) {
	line := `{"type":"session","segment":{"seq":2,"prev_content_hash":"old"},"meta":{"prev_content_hash":"keep"}}`

	object := decodeTestObject(t, replacePrevContentHash(line, "new"))

	segment := object["segment"].(map[string]any)
	if got := segment["prev_content_hash"]; got != "new" {
		t.Fatalf("segment.prev_content_hash = %v, want new", got)
	}
	meta := object["meta"].(map[string]any)
	if got := meta["prev_content_hash"]; got != "keep" {
		t.Fatalf("nested meta.prev_content_hash = %v, want keep", got)
	}
}

func TestCheckPrevContentHashRejectsMismatchedSegmentChain(t *testing.T) {
	line := `{"type":"session","segment":{"seq":2,"prev_content_hash":"old"}}`

	err := checkPrevContentHash("hash-vectors/segment-chain-seq2.trail.jsonl", line, "new")

	if err == nil {
		t.Fatal("checkPrevContentHash returned nil, want mismatch error")
	}
	if !strings.Contains(err.Error(), "segment.prev_content_hash mismatch") {
		t.Fatalf("checkPrevContentHash error = %q, want mismatch", err.Error())
	}
}

func decodeTestObject(t *testing.T, line string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(line))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil {
		t.Fatalf("decode replacement result: %v", err)
	}
	return object
}
