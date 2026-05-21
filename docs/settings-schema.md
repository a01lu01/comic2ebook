# Comic2Ebook Settings Schema

## Version

`schemaVersion: 1`

## Default settings.json

```json
{
  "schemaVersion": 1,
  "calibrePath": "",
  "outputDir": "",
  "overwritePolicy": "rename",
  "profile": "recommended",
  "packingConcurrency": 2,
  "convertConcurrency": 1
}
```

## Field Reference

| Key | Type | Default | Description |
|---|---|---|---|
| `schemaVersion` | number | 1 | Schema version for future migration |
| `calibrePath` | string | `""` | Path to `ebook-convert.exe`. Empty = auto-detect |
| `outputDir` | string | `""` | Last selected output directory path |
| `overwritePolicy` | string | `"rename"` | `"rename"` / `"overwrite"` / `"fail"` |
| `profile` | string | `"recommended"` | `"recommended"` / `"compatible"` |
| `packingConcurrency` | number | 2 | Max concurrent CBZ packing jobs (Phase 3) |
| `convertConcurrency` | number | 1 | Max concurrent Calibre conversions (Phase 3) |

## Migration

When `schemaVersion` changes:
1. Read existing settings
2. Apply migration function for old → new schema
3. Write with new `schemaVersion`

## Storage

- Path: `%APPDATA%/comic2ebook/settings.json` (Windows)
- Format: JSON, UTF-8, pretty-printed
- Corrupt file → reset to defaults with `schemaVersion: 1`
