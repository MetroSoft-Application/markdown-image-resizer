# Markdown Image Resize Viewer Test Samples

このディレクトリには、Markdown Image Resize Viewer の動作確認用サンプルをまとめています。

## Files

- `basic-markdown-images.md`: 基本的な Markdown 画像記法。
- `local-raster-images.md`: ローカル参照の PNG/GIF/JPEG 画像。
- `reference-markdown-images.md`: 参照形式 Markdown 画像。
- `html-image-tags.md`: 既存の HTML `<img>` タグと SVG `<image>` タグ更新確認。
- `mixed-and-ignored.md`: リサイズ対象と対象外の混在確認。
- `duplicate-source.md`: 同じ `src` を複数回使うケース。
- `embedded-data-uri.md`: data URI の埋め込み画像。
- `embedded-raster-data-uri.md`: SVG 以外の埋め込み data URI 画像。

## Expected checks

1. `.md` ファイルを通常エディタで開く。
2. **Markdown Image Resize Viewer: Open With Markdown Image Resize Viewer** を実行する。
3. 画像右下のハンドルをドラッグする。
4. マウスを離した後、元の Markdown ソースが更新されることを確認する。

## Notes

- `https://` 画像は読み取り専用として表示される想定です。
- `samples/assets/` には SVG に加えて PNG/GIF/JPEG のローカル画像も含めています。
- 参照形式 Markdown 画像はリサイズ後に HTML `<img>` へ置き換わる想定です。
- インラインコードと fenced code block 内の画像記法は無視される想定です。