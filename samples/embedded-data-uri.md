# Embedded Data URI

埋め込み画像でもドラッグ操作と width 書き戻しが動くか確認します。

![Embedded sample](data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%20360%20210%22%20role%3D%22img%22%20aria-label%3D%22Embedded%20sample%22%3E%3Crect%20width%3D%22360%22%20height%3D%22210%22%20rx%3D%2224%22%20fill%3D%22%232f4858%22/%3E%3Ccircle%20cx%3D%2268%22%20cy%3D%2268%22%20r%3D%2234%22%20fill%3D%22%23f6bd60%22/%3E%3Cpath%20d%3D%22M38%20170c34-46%2076-70%20124-70s90%2024%20160%2070%22%20fill%3D%22none%22%20stroke%3D%22%23f7ede2%22%20stroke-width%3D%2218%22%20stroke-linecap%3D%22round%22/%3E%3Ctext%20x%3D%22152%22%20y%3D%2290%22%20fill%3D%22%23f7ede2%22%20font-size%3D%2228%22%20font-family%3D%22Segoe%20UI%2C%20Arial%2C%20sans-serif%22%20font-weight%3D%22700%22%3EData%20URI%3C/text%3E%3Ctext%20x%3D%22152%22%20y%3D%22128%22%20fill%3D%22%23f7ede2%22%20font-size%3D%2218%22%20font-family%3D%22Georgia%2C%20serif%22%3EInline%20embedded%20image%3C/text%3E%3C/svg%3E)

ドラッグ後は Markdown 記法が HTML `<img>` に変換され、同じ data URI を保持したまま `width` が付く想定です。