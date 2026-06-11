package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/cyberphone/json-canonicalization/go/src/webpki.org/jsoncanonicalizer"
)

const oracleComment = "Oracle: Go github.com/cyberphone/json-canonicalization v0.0.0-20241213102144-19d51d7fe467 + crypto/sha256"

type manifest struct {
	Fixtures []manifestFixture `json:"fixtures"`
}

type manifestFixture struct {
	Path     string           `json:"path"`
	Comment  string           `json:"comment,omitempty"`
	Expected *hashExpectation `json:"expected,omitempty"`
}

type hashExpectation struct {
	SessionHashes []string `json:"session_hashes,omitempty"`
	FileHash      string   `json:"file_hash,omitempty"`
}

type vectorResult struct {
	Path          string
	SessionHashes []string
	FileHash      string
	Lines         []string
}

type recordInfo struct {
	Type    string `json:"type"`
	Segment *struct {
		Seq             int    `json:"seq"`
		PrevContentHash string `json:"prev_content_hash"`
	} `json:"segment"`
}

type group struct {
	Start int
	End   int
}

func main() {
	check := flag.Bool("check", false, "verify hash-vector fixtures against manifest expectations")
	write := flag.Bool("write", false, "stamp hash-vector fixtures and print manifest snippets")
	flag.Parse()

	if *check == *write {
		exitf("choose exactly one of --check or --write")
	}

	root, err := repoRoot()
	if err != nil {
		exitf("%v", err)
	}

	results, err := computeVectors(root, *write)
	if err != nil {
		exitf("%v", err)
	}

	if *write {
		for _, result := range results {
			path := filepath.Join(root, "tests/fixtures/validation", result.Path)
			if err := os.WriteFile(path, []byte(strings.Join(result.Lines, "\n")+"\n"), 0o644); err != nil {
				exitf("%s: %v", result.Path, err)
			}
		}
		printManifestSnippets(results)
		return
	}

	if err := checkManifest(root, results); err != nil {
		exitf("%v", err)
	}
}

func repoRoot() (string, error) {
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(wd, "tests/fixtures/validation/manifest.json")); err == nil {
			return wd, nil
		}
		parent := filepath.Dir(wd)
		if parent == wd {
			return "", errors.New("could not find repo root")
		}
		wd = parent
	}
}

func computeVectors(root string, write bool) ([]vectorResult, error) {
	vectorDir := filepath.Join(root, "tests/fixtures/validation/hash-vectors")
	entries, err := os.ReadDir(vectorDir)
	if err != nil {
		return nil, err
	}

	var paths []string
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !strings.HasSuffix(entry.Name(), ".trail.jsonl") {
			continue
		}
		paths = append(paths, filepath.ToSlash(filepath.Join("hash-vectors", entry.Name())))
	}
	sort.Strings(paths)

	var results []vectorResult
	var segmentSeq1Hash string
	for _, path := range paths {
		fullPath := filepath.Join(root, "tests/fixtures/validation", filepath.FromSlash(path))
		text, err := os.ReadFile(fullPath)
		if err != nil {
			return nil, err
		}
		lines := splitJSONLLines(string(text))
		if strings.HasSuffix(path, "segment-chain-seq2.trail.jsonl") {
			if segmentSeq1Hash == "" {
				return nil, errors.New("segment-chain-seq2 requires segment-chain-seq1 first")
			}
			if len(lines) == 0 {
				return nil, fmt.Errorf("%s: empty fixture", path)
			}
			if write {
				lines[0] = replacePrevContentHash(lines[0], segmentSeq1Hash)
			} else if err := checkPrevContentHash(path, lines[0], segmentSeq1Hash); err != nil {
				return nil, err
			}
		}

		result, err := computeVector(path, lines, write)
		if err != nil {
			return nil, err
		}
		if strings.HasSuffix(path, "segment-chain-seq1.trail.jsonl") && len(result.SessionHashes) > 0 {
			segmentSeq1Hash = result.SessionHashes[0]
		}
		results = append(results, result)
	}

	return results, nil
}

func computeVector(path string, lines []string, write bool) (vectorResult, error) {
	infos := make([]recordInfo, len(lines))
	for i, line := range lines {
		if err := json.Unmarshal([]byte(line), &infos[i]); err != nil {
			return vectorResult{}, fmt.Errorf("%s:%d: %w", path, i+1, err)
		}
	}

	groups := splitGroups(infos)
	if len(groups) == 0 {
		return vectorResult{}, fmt.Errorf("%s: no session groups", path)
	}

	out := append([]string(nil), lines...)
	sessionHashes := make([]string, len(groups))
	for i, group := range groups {
		hash, err := digestCanonicalLines(out[group.Start:group.End], 0)
		if err != nil {
			return vectorResult{}, fmt.Errorf("%s: session group %d: %w", path, i, err)
		}
		sessionHashes[i] = hash
		if write {
			out[group.Start] = replaceContentHash(out[group.Start], hash)
		}
	}

	var fileHash string
	if len(out) > 0 && infos[0].Type == "trail" {
		hash, err := digestCanonicalLines(out, 0)
		if err != nil {
			return vectorResult{}, fmt.Errorf("%s: envelope: %w", path, err)
		}
		fileHash = hash
		if write {
			out[0] = replaceContentHash(out[0], hash)
		}
	}

	return vectorResult{
		Path:          path,
		SessionHashes: sessionHashes,
		FileHash:      fileHash,
		Lines:         out,
	}, nil
}

func splitJSONLLines(text string) []string {
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

func splitGroups(infos []recordInfo) []group {
	var groups []group
	current := -1
	for i, info := range infos {
		if i == 0 && info.Type == "trail" {
			continue
		}
		if info.Type == "session" {
			if current != -1 {
				groups = append(groups, group{Start: current, End: i})
			}
			current = i
		}
	}
	if current != -1 {
		groups = append(groups, group{Start: current, End: len(infos)})
	}
	return groups
}

func digestCanonicalLines(lines []string, pinIndex int) (string, error) {
	var canonicalJSONL bytes.Buffer
	for i, line := range lines {
		raw := line
		if i == pinIndex {
			raw = replaceContentHash(raw, "<pending>")
		}
		canonical, err := jsoncanonicalizer.Transform([]byte(raw))
		if err != nil {
			return "", err
		}
		if i > 0 {
			canonicalJSONL.WriteByte('\n')
		}
		canonicalJSONL.Write(canonical)
	}
	canonicalJSONL.WriteByte('\n')
	sum := sha256.Sum256(canonicalJSONL.Bytes())
	return hex.EncodeToString(sum[:]), nil
}

func replaceContentHash(line string, value string) string {
	return replaceTopLevelString(line, "content_hash", value)
}

func replacePrevContentHash(line string, value string) string {
	object := decodeObject(line, "prev_content_hash replacement")
	segment, ok := object["segment"].(map[string]any)
	if !ok {
		exitf("missing replacement target %q in line: %s", "segment.prev_content_hash", line)
	}
	existing, ok := segment["prev_content_hash"]
	if !ok {
		exitf("missing replacement target %q in line: %s", "segment.prev_content_hash", line)
	}
	if _, ok := existing.(string); !ok {
		exitf("replacement target %q is not a string in line: %s", "segment.prev_content_hash", line)
	}
	segment["prev_content_hash"] = value
	return encodeObject(object, "prev_content_hash replacement")
}

func checkPrevContentHash(path string, line string, expected string) error {
	var info recordInfo
	if err := json.Unmarshal([]byte(line), &info); err != nil {
		return fmt.Errorf("%s: segment-chain seq-2 header: %w", path, err)
	}
	if info.Segment == nil {
		return fmt.Errorf("%s: segment-chain seq-2 header missing segment", path)
	}
	if info.Segment.PrevContentHash != expected {
		return fmt.Errorf("%s: segment.prev_content_hash mismatch\nfixture: %s\noracle:   %s", path, info.Segment.PrevContentHash, expected)
	}
	return nil
}

func replaceTopLevelString(line string, field string, value string) string {
	object := decodeObject(line, field+" replacement")
	existing, ok := object[field]
	if !ok {
		exitf("missing replacement target %q in line: %s", field, line)
	}
	if _, ok := existing.(string); !ok {
		exitf("replacement target %q is not a string in line: %s", field, line)
	}
	object[field] = value
	return encodeObject(object, field+" replacement")
}

func decodeObject(line string, context string) map[string]any {
	decoder := json.NewDecoder(strings.NewReader(line))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil {
		exitf("could not decode line for %s: %v", context, err)
	}
	return object
}

func encodeObject(object map[string]any, context string) string {
	encoded, err := json.Marshal(object)
	if err != nil {
		exitf("could not encode line for %s: %v", context, err)
	}
	return string(encoded)
}

func checkManifest(root string, results []vectorResult) error {
	manifestPath := filepath.Join(root, "tests/fixtures/validation/manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return err
	}
	var mf manifest
	if err := json.Unmarshal(data, &mf); err != nil {
		return err
	}
	entries := map[string]manifestFixture{}
	for _, fixture := range mf.Fixtures {
		if strings.HasPrefix(fixture.Path, "hash-vectors/") {
			entries[fixture.Path] = fixture
		}
	}
	for _, result := range results {
		fixture, ok := entries[result.Path]
		if !ok {
			return fmt.Errorf("%s: missing manifest entry", result.Path)
		}
		if fixture.Comment != oracleComment {
			return fmt.Errorf("%s: missing oracle comment", result.Path)
		}
		if fixture.Expected == nil {
			return fmt.Errorf("%s: missing expected hashes", result.Path)
		}
		if !equalStrings(fixture.Expected.SessionHashes, result.SessionHashes) {
			return fmt.Errorf("%s: session hashes mismatch\nmanifest: %v\noracle:   %v", result.Path, fixture.Expected.SessionHashes, result.SessionHashes)
		}
		if fixture.Expected.FileHash != result.FileHash {
			return fmt.Errorf("%s: file hash mismatch\nmanifest: %s\noracle:   %s", result.Path, fixture.Expected.FileHash, result.FileHash)
		}
	}
	if len(entries) != len(results) {
		return fmt.Errorf("manifest has %d hash-vector entries; oracle found %d fixture files", len(entries), len(results))
	}
	return nil
}

func equalStrings(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func printManifestSnippets(results []vectorResult) {
	for _, result := range results {
		entry := manifestFixture{
			Path:    result.Path,
			Comment: oracleComment,
			Expected: &hashExpectation{
				SessionHashes: result.SessionHashes,
				FileHash:      result.FileHash,
			},
		}
		encoded, err := json.MarshalIndent(entry, "    ", "  ")
		if err != nil {
			exitf("%v", err)
		}
		fmt.Println(string(encoded))
	}
}

func exitf(format string, args ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", args...)
	os.Exit(1)
}
