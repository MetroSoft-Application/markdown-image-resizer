# Local Raster Images

ローカル参照でも SVG 以外の画像が問題なく表示・リサイズできるか確認するためのサンプルです。

## PNG in Markdown

![Local PNG sample](./assets/raster-landscape.png)

## GIF with title

![Local GIF sample](./assets/raster-banner.gif "Raster banner")

## JPEG in HTML

![Local JPEG sample](./assets/raster-photo.jpg)

## Notes

- PNG と GIF は Markdown 記法、JPEG は既存 HTML `<img>` タグの更新確認用です。
- ドラッグ後は Markdown 記法が HTML `<img>` に変換され、既存 HTML は `width` のみ更新される想定です。