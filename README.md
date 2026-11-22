# Metadata Inspector

Lossless client-side image metadata inspector, editor, and scrubber. Runs entirely in the browser with zero server uploads.

## Engine & Standards

- **Core engine**: ExifTool (v13 via WebAssembly / ZeroPerl) in a dedicated Web Worker — the industry standard for metadata parsing and editing.
- **Native fallback**: zero-dependency binary parser and writer for direct container manipulation (JPEG APP markers, PNG chunks, WebP chunks, GIF blocks, TIFF IFDs).
- **Lossless guarantee**: container-level byte surgery without decoding or re-compressing pixel buffers; verified via CRC32 payload checks.
- **Eradication audit**: post-scrub scanner independently re-parses output binaries to confirm stripped tags and substrings are purged from the raw stream.

## Features

### Inspection & Taxonomy

- **Formats**: JPEG, PNG (APNG), WebP, GIF, HEIC/HEIF, AVIF, TIFF/DNG/RAW.
- **7 categories**: Location, Hidden Previews, Authors & Rights, Device & Hardware, Timestamps, Software, and Technical parameters.
- **Embedded previews**: extracts, displays, and exports hidden JFIF/IFD1 thumbnail streams embedded in EXIF headers.

### Lossless Scrubbing & Editing

- **Granular control**: strip individual tags or entire categories; edit timestamps, author credits, and GPS in place.
- **Safety locks**: protects EXIF orientation (`0x0112`) and preserves ICC color profiles to prevent rotation or color shifts.
- **Anonymization**: CSPRNG token generator (`crypto.getRandomValues`) for leak-free file renaming.

### Batch Queue & Export

- **Batch operations**: multi-file queue with global category toggles, template-based renaming, and field propagation.
- **Export formats**: direct download, uncompressed ZIP archive, or metadata dumps (JSON, CSV, XMP).

## Shortcuts

| Shortcut           | Action                                              |
| ------------------ | --------------------------------------------------- |
| `Ctrl+O` / `Cmd+O` | Open file picker                                    |
| `Ctrl+S` / `Cmd+S` | Apply & download active file (or ZIP in batch mode) |
| `Ctrl+V` / `Cmd+V` | Paste image from clipboard                          |
| `Drag & Drop`      | Drop files anywhere on window                       |
| `Escape`           | Close active dialog                                 |

---

[MIT License](./LICENSE), [Third-Party Licenses](./THIRD_PARTY_LICENSES.md)
