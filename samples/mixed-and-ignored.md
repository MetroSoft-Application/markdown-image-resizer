# Mixed And Ignored Cases

このファイルは、対象となる画像と無視される画像記法を混在させています。

## Resizable local image

![Resizable local image](./assets/landscape-card.svg)

## Remote image should stay read-only

![Remote image](https://picsum.photos/420/260)

## Inline code should be ignored

`![Do not parse](./assets/portrait-card.svg)`

## Fenced code block should be ignored

```md
![Ignore this fenced image](./assets/square-grid.svg)
<img src="./assets/landscape-card.svg" width="280">
```

## HTML image after ignored blocks

<img src="./assets/portrait-card.svg" alt="Resizable HTML image" width="260">