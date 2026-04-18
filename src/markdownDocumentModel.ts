import * as path from 'path';
import * as vscode from 'vscode';
import MarkdownIt from 'markdown-it';
import { escapeHtmlAttribute, upsertHtmlAttribute } from './sourceRewrite';

type SourceImageKind = 'markdown' | 'html';

export interface SourceImageReference {
    id: string;
    kind: SourceImageKind;
    src: string;
    alt: string;
    title?: string;
    originalText: string;
    startOffset: number;
    endOffset: number;
    renderSrc: string;
    resizable: boolean;
    canReset: boolean;
}

export interface WebviewSettings {
    dragHandleSize: number;
    minImageWidth: number;
    canvasPadding: number;
}

export interface MarkdownViewModel {
    version: number;
    html: string;
    images: SourceImageReference[];
    settings: WebviewSettings;
}

const HTML_IMAGE_PATTERN = /<img\b[^>]*>/gi;

const markdownRenderer = createMarkdownRenderer();
const DEFAULT_WEBVIEW_SETTINGS: WebviewSettings = {
    dragHandleSize: 14,
    minImageWidth: 48,
    canvasPadding: 32
};

/**
 * Markdown ドキュメントを Webview 描画用のモデルへ変換します。
 * @param document 対象の TextDocument です。
 * @param webview 描画先の Webview です。
 * @returns Webview へ送信する描画モデルです。
 */
export function buildMarkdownViewModel(
    document: vscode.TextDocument,
    webview: vscode.Webview
): MarkdownViewModel {
    const settings = getWebviewSettings();
    const images = extractSourceImages(document, webview);
    const renderSource = decorateSourceImages(document.getText(), images);
    const html = markdownRenderer.render(renderSource);

    return {
        version: document.version,
        html,
        images,
        settings
    };
}

/**
 * Webview で必要な表示設定を読み取ります。
 * @returns Webview に渡す設定値です。
 */
export function getWebviewSettings(): WebviewSettings {
    return { ...DEFAULT_WEBVIEW_SETTINGS };
}

/**
 * ソース上の画像記法と HTML img タグを抽出します。
 * @param document 解析対象の TextDocument です。
 * @param webview 描画に使用する Webview です。
 * @returns ソース順に並んだ画像参照一覧です。
 */
function extractSourceImages(
    document: vscode.TextDocument,
    webview: vscode.Webview
): SourceImageReference[] {
    const source = document.getText();
    const images: SourceImageReference[] = [];

    for (const candidate of scanSourceImages(source)) {
        images.push({
            ...candidate,
            id: '',
            renderSrc: resolveRenderSrc(document, webview, candidate.src),
            resizable: isResizableSource(candidate.src)
        });
    }

    images.sort((left, right) => left.startOffset - right.startOffset);

    return images.map((image, index) => ({
        ...image,
        id: `${image.kind}-${index}-${image.startOffset}`
    }));
}

/**
 * 抽出済み画像を描画用 HTML img タグへ正規化したソースを生成します。
 * @param source 元の Markdown ソースです。
 * @param images 抽出済みの画像一覧です。
 * @returns MarkdownIt に渡す装飾済みソースです。
 */
function decorateSourceImages(source: string, images: SourceImageReference[]): string {
    let nextSource = source;

    for (const image of [...images].sort((left, right) => right.startOffset - left.startOffset)) {
        const replacement = image.kind === 'html'
            ? decorateHtmlImageTag(image)
            : buildRenderedMarkdownImageTag(image);

        nextSource = nextSource.slice(0, image.startOffset)
            + replacement
            + nextSource.slice(image.endOffset);
    }

    return nextSource;
}

/**
 * 既存の HTML img タグへ描画用属性を付与します。
 * @param image 更新対象の画像参照です。
 * @returns 装飾済み HTML img タグです。
 */
function decorateHtmlImageTag(image: SourceImageReference): string {
    let tag = image.originalText;
    tag = upsertHtmlAttribute(tag, 'src', image.renderSrc);
    tag = upsertHtmlAttribute(tag, 'data-imagefree-id', image.id);
    tag = upsertHtmlAttribute(tag, 'data-imagefree-resizable', image.resizable ? 'true' : 'false');
    tag = upsertHtmlAttribute(tag, 'data-imagefree-kind', image.kind);

    return tag;
}

/**
 * Markdown 画像記法を描画専用の HTML img タグへ変換します。
 * @param image 対象の画像参照です。
 * @returns 描画用 HTML img タグです。
 */
function buildRenderedMarkdownImageTag(image: SourceImageReference): string {
    const attributes = [
        `src="${escapeHtmlAttribute(image.renderSrc)}"`,
        `alt="${escapeHtmlAttribute(image.alt)}"`,
        `data-imagefree-id="${escapeHtmlAttribute(image.id)}"`,
        `data-imagefree-resizable="${image.resizable ? 'true' : 'false'}"`,
        `data-imagefree-kind="${image.kind}"`
    ];

    if (image.title) {
        attributes.push(`title="${escapeHtmlAttribute(image.title)}"`);
    }

    return `<img ${attributes.join(' ')}>`;
}

/**
 * HTML img タグから属性値を抽出します。
 * @param tag 解析対象の HTML img タグです。
 * @returns 小文字属性名をキーに持つ属性マップです。
 */
function parseHtmlAttributes(tag: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const attributePattern = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

    for (const match of tag.matchAll(attributePattern)) {
        const attributeName = match[1].toLowerCase();

        if (attributeName === 'img') {
            continue;
        }

        const attributeValue = match[2] ?? match[3] ?? match[4] ?? '';
        attributes[attributeName] = attributeValue;
    }

    return attributes;
}

/**
 * 画像ソースがマウスリサイズ可能かを判定します。
 * @param sourceSrc 画像の src 値です。
 * @returns リサイズ可能なら true です。
 */
function isResizableSource(sourceSrc: string): boolean {
    return !/^https?:\/\//i.test(sourceSrc);
}

/**
 * Markdown / HTML の src を Webview で描画可能な URI へ変換します。
 * @param document 対象ドキュメントです。
 * @param webview 描画先 Webview です。
 * @param sourceSrc ソース上の src 値です。
 * @returns Webview に設定する src 値です。
 */
function resolveRenderSrc(
    document: vscode.TextDocument,
    webview: vscode.Webview,
    sourceSrc: string
): string {
    if (/^https?:\/\//i.test(sourceSrc) || /^data:/i.test(sourceSrc)) {
        return sourceSrc;
    }

    if (/^file:/i.test(sourceSrc)) {
        return webview.asWebviewUri(vscode.Uri.parse(sourceSrc)).toString();
    }

    if (document.uri.scheme !== 'file') {
        return sourceSrc;
    }

    const { cleanPath, suffix } = splitPathSuffix(sourceSrc);
    const absolutePath = path.isAbsolute(cleanPath)
        ? cleanPath
        : path.resolve(path.dirname(document.uri.fsPath), decodeURI(cleanPath));

    return webview.asWebviewUri(vscode.Uri.file(absolutePath)).toString() + suffix;
}

/**
 * パスとクエリ・ハッシュ部を分離します。
 * @param sourceSrc 元の src 値です。
 * @returns パス本体とサフィックスです。
 */
function splitPathSuffix(sourceSrc: string): { cleanPath: string; suffix: string; } {
    const match = sourceSrc.match(/^([^?#]*)(.*)$/);

    return {
        cleanPath: match?.[1] ?? sourceSrc,
        suffix: match?.[2] ?? ''
    };
}

/**
 * MarkdownIt を画像拡張付きで構築します。
 * @returns MarkdownIt インスタンスです。
 */
function createMarkdownRenderer(): MarkdownIt {
    return new MarkdownIt({
        html: true,
        linkify: true,
        typographer: false
    });
}

/**
 * Markdown ソースを走査し、画像候補を抽出します。
 * @param source 解析対象の Markdown ソースです。
 * @returns ソース内の画像候補一覧です。
 */
function scanSourceImages(source: string): Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> {
    const images: Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> = [];
    const lines = source.split(/(\r?\n)/);
    const referenceDefinitions = collectReferenceDefinitions(source);
    let offset = 0;
    let fenceMarker: string | undefined;

    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index] ?? '';
        const newline = lines[index + 1] ?? '';
        const fence = getFenceMarker(line);

        if (fence && !fenceMarker) {
            fenceMarker = fence;
            offset += line.length + newline.length;
            continue;
        }

        if (fence && fenceMarker === fence) {
            fenceMarker = undefined;
            offset += line.length + newline.length;
            continue;
        }

        if (!fenceMarker) {
            images.push(...scanHtmlImagesInLine(line, offset, source));
            images.push(...scanMarkdownImagesInLine(line, offset, source, referenceDefinitions));
        }

        offset += line.length + newline.length;
    }

    return images;
}

/**
 * Markdown の fenced code block を検出します。
 * @param line 現在の行文字列です。
 * @returns フェンス記号、または未検出なら undefined です。
 */
function getFenceMarker(line: string): string | undefined {
    const match = line.match(/^\s{0,3}(```+|~~~+)/);
    return match?.[1]?.[0];
}

/**
 * 1 行内の HTML img タグを抽出します。
 * @param line 現在の行です。
 * @param lineOffset 行先頭のオフセットです。
 * @param source ドキュメント全体のソースです。
 * @returns 抽出した HTML 画像一覧です。
 */
function scanHtmlImagesInLine(
    line: string,
    lineOffset: number,
    source: string
): Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> {
    const images: Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> = [];

    for (const match of line.matchAll(HTML_IMAGE_PATTERN)) {
        if (typeof match.index !== 'number' || isInsideInlineCode(line, match.index)) {
            continue;
        }

        const tag = match[0];
        const attributes = parseHtmlAttributes(tag);

        if (!attributes.src) {
            continue;
        }

        const startOffset = lineOffset + match.index;
        const endOffset = startOffset + tag.length;

        images.push({
            kind: 'html',
            src: attributes.src,
            alt: attributes.alt ?? '',
            title: attributes.title,
            originalText: source.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            canReset: Object.prototype.hasOwnProperty.call(attributes, 'width')
        });
    }

    return images;
}

/**
 * 1 行内の Markdown 画像記法を抽出します。
 * @param line 現在の行です。
 * @param lineOffset 行先頭のオフセットです。
 * @param source ドキュメント全体のソースです。
 * @returns 抽出した Markdown 画像一覧です。
 */
function scanMarkdownImagesInLine(
    line: string,
    lineOffset: number,
    source: string,
    referenceDefinitions: Map<string, { src: string; title?: string; }>
): Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> {
    const images: Array<Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>> = [];
    let index = 0;

    while (index < line.length) {
        if (isInsideInlineCode(line, index)) {
            index += 1;
            continue;
        }

        if (line[index] !== '!' || line[index + 1] !== '[' || line[index - 1] === '\\') {
            index += 1;
            continue;
        }

        const closingBracket = findClosingBracket(line, index + 2, ']');

        if (closingBracket < 0) {
            index += 1;
            continue;
        }

        const alt = line.slice(index + 2, closingBracket);
        const inlineImage = scanInlineMarkdownImage(line, lineOffset, source, index, closingBracket, alt);

        if (inlineImage) {
            if (inlineImage.image) {
                images.push(inlineImage.image);
            }

            index = inlineImage.nextIndex;
            continue;
        }

        const referenceImage = scanReferenceMarkdownImage(
            line,
            lineOffset,
            source,
            index,
            closingBracket,
            alt,
            referenceDefinitions
        );

        if (referenceImage) {
            images.push(referenceImage.image);
            index = referenceImage.nextIndex;
            continue;
        }

        index += 1;
    }

    return images;
}

/**
 * 参照形式 Markdown 画像の定義一覧を収集します。
 * @param source 解析対象の Markdown ソースです。
 * @returns 正規化ラベルをキーに持つ参照定義マップです。
 */
function collectReferenceDefinitions(source: string): Map<string, { src: string; title?: string; }> {
    const definitions = new Map<string, { src: string; title?: string; }>();
    const lines = source.split(/(\r?\n)/);
    let fenceMarker: string | undefined;

    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index] ?? '';
        const newline = lines[index + 1] ?? '';
        const fence = getFenceMarker(line);

        if (fence && !fenceMarker) {
            fenceMarker = fence;
            continue;
        }

        if (fence && fenceMarker === fence) {
            fenceMarker = undefined;
            continue;
        }

        if (!fenceMarker) {
            const definition = parseReferenceDefinition(line);

            if (definition) {
                definitions.set(definition.label, {
                    src: definition.src,
                    title: definition.title
                });
            }
        }

    }

    return definitions;
}

/**
 * 1 行の中から参照定義を解析します。
 * @param line 対象行です。
 * @returns 有効な参照定義、または undefined です。
 */
function parseReferenceDefinition(line: string): { label: string; src: string; title?: string; } | undefined {
    const match = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(.+)$/);

    if (!match) {
        return undefined;
    }

    const label = normalizeReferenceLabel(match[1]);
    const parsedTarget = parseMarkdownTarget(match[2]);

    if (!label || !parsedTarget.src) {
        return undefined;
    }

    return {
        label,
        src: parsedTarget.src,
        title: parsedTarget.title
    };
}

/**
 * Markdown のインライン画像記法を解析します。
 * @param line 対象行です。
 * @param lineOffset 行先頭のオフセットです。
 * @param source ドキュメント全体のソースです。
 * @param index 画像記法の開始位置です。
 * @param closingBracket alt テキスト終端の位置です。
 * @param alt alt テキストです。
 * @returns 画像情報と次の探索位置、または undefined です。
 */
function scanInlineMarkdownImage(
    line: string,
    lineOffset: number,
    source: string,
    index: number,
    closingBracket: number,
    alt: string
): { image?: Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>; nextIndex: number; } | undefined {
    if (line[closingBracket + 1] !== '(') {
        return undefined;
    }

    const closingParenthesis = findClosingParenthesis(line, closingBracket + 2);

    if (closingParenthesis < 0) {
        return undefined;
    }

    const startOffset = lineOffset + index;
    const endOffset = lineOffset + closingParenthesis + 1;
    const target = line.slice(closingBracket + 2, closingParenthesis);
    const parsedTarget = parseMarkdownTarget(target);

    if (!parsedTarget.src) {
        return {
            nextIndex: closingParenthesis + 1
        };
    }

    return {
        image: {
            kind: 'markdown',
            src: parsedTarget.src,
            alt,
            title: parsedTarget.title,
            originalText: source.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            canReset: false
        },
        nextIndex: closingParenthesis + 1
    };
}

/**
 * Markdown の参照形式画像記法を解析します。
 * @param line 対象行です。
 * @param lineOffset 行先頭のオフセットです。
 * @param source ドキュメント全体のソースです。
 * @param index 画像記法の開始位置です。
 * @param closingBracket alt テキスト終端の位置です。
 * @param alt alt テキストです。
 * @param referenceDefinitions 参照定義マップです。
 * @returns 画像情報と次の探索位置、または undefined です。
 */
function scanReferenceMarkdownImage(
    line: string,
    lineOffset: number,
    source: string,
    index: number,
    closingBracket: number,
    alt: string,
    referenceDefinitions: Map<string, { src: string; title?: string; }>
): { image: Omit<SourceImageReference, 'id' | 'renderSrc' | 'resizable'>; nextIndex: number; } | undefined {
    let label = normalizeReferenceLabel(alt);
    let endIndex = closingBracket;

    if (line[closingBracket + 1] === '[') {
        const referenceClosingBracket = findClosingBracket(line, closingBracket + 2, ']');

        if (referenceClosingBracket < 0) {
            return undefined;
        }

        const rawLabel = line.slice(closingBracket + 2, referenceClosingBracket);
        label = normalizeReferenceLabel(rawLabel || alt);
        endIndex = referenceClosingBracket;
    }

    const definition = referenceDefinitions.get(label);

    if (!definition) {
        return undefined;
    }

    const startOffset = lineOffset + index;
    const endOffset = lineOffset + endIndex + 1;

    return {
        image: {
            kind: 'markdown',
            src: definition.src,
            alt,
            title: definition.title,
            originalText: source.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            canReset: false
        },
        nextIndex: endIndex + 1
    };
}

/**
 * 参照ラベルを比較用に正規化します。
 * @param label 元の参照ラベルです。
 * @returns 正規化済みの小文字ラベルです。
 */
function normalizeReferenceLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * 対応する閉じ角括弧を探します。
 * @param line 対象行です。
 * @param startIndex 探索開始位置です。
 * @param closingChar 対応する閉じ文字です。
 * @returns 見つかった位置、未検出なら -1 です。
 */
function findClosingBracket(line: string, startIndex: number, closingChar: string): number {
    for (let index = startIndex; index < line.length; index += 1) {
        if (line[index] === '\\') {
            index += 1;
            continue;
        }

        if (line[index] === closingChar) {
            return index;
        }
    }

    return -1;
}

/**
 * Markdown の画像リンクに対応する閉じ括弧を探します。
 * @param line 対象行です。
 * @param startIndex 探索開始位置です。
 * @returns 見つかった位置、未検出なら -1 です。
 */
function findClosingParenthesis(line: string, startIndex: number): number {
    let depth = 1;

    for (let index = startIndex; index < line.length; index += 1) {
        if (line[index] === '\\') {
            index += 1;
            continue;
        }

        if (line[index] === '(') {
            depth += 1;
            continue;
        }

        if (line[index] === ')') {
            depth -= 1;

            if (depth === 0) {
                return index;
            }
        }
    }

    return -1;
}

/**
 * Markdown のリンクターゲット文字列から src と title を抽出します。
 * @param target `(...)` 内の内容です。
 * @returns 抽出結果です。
 */
function parseMarkdownTarget(target: string): { src: string; title?: string; } {
    const trimmed = target.trim();

    if (!trimmed) {
        return { src: '' };
    }

    if (trimmed.startsWith('<')) {
        const closingIndex = trimmed.indexOf('>');

        if (closingIndex > 0) {
            const src = trimmed.slice(1, closingIndex);
            const title = parseOptionalTitle(trimmed.slice(closingIndex + 1).trim());
            return { src, title };
        }
    }

    const match = trimmed.match(/^(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?$/);

    if (!match) {
        return { src: trimmed };
    }

    return {
        src: match[1],
        title: match[2] ?? match[3] ?? match[4] ?? undefined
    };
}

/**
 * 任意の title 文字列を抽出します。
 * @param value 候補文字列です。
 * @returns title、または undefined です。
 */
function parseOptionalTitle(value: string): string | undefined {
    const match = value.match(/^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/);
    return match?.[1] ?? match?.[2] ?? match?.[3] ?? undefined;
}

/**
 * 指定位置がインラインコード内かを判定します。
 * @param line 対象行です。
 * @param targetIndex 判定位置です。
 * @returns インラインコード内なら true です。
 */
function isInsideInlineCode(line: string, targetIndex: number): boolean {
    let inInlineCode = false;

    for (let index = 0; index < line.length && index <= targetIndex; index += 1) {
        if (line[index] === '\\') {
            index += 1;
            continue;
        }

        if (line[index] === '`') {
            inInlineCode = !inInlineCode;
        }
    }

    return inInlineCode;
}