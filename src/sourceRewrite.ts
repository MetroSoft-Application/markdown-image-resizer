import * as vscode from 'vscode';
import type { SourceImageReference } from './markdownDocumentModel';

const ATTRIBUTE_VALUE_PATTERN = '"[^"]*"|\'[^\']*\'|[^\\s>]+';

/**
 * 画像幅の変更内容を TextDocument に適用する WorkspaceEdit を作成します。
 * @param document 編集対象の Markdown ドキュメントです。
 * @param image 更新対象の画像参照です。
 * @param width 新しい画像幅です。
 * @returns 適用可能な WorkspaceEdit です。
 */
export function buildResizeEdit(
    document: vscode.TextDocument,
    image: SourceImageReference,
    width: number
): vscode.WorkspaceEdit {
    const normalizedWidth = normalizeWidth(width);
    const replacement = image.kind === 'markdown'
        ? buildMarkdownReplacement(image, normalizedWidth)
        : buildHtmlReplacement(image, normalizedWidth);
    const edit = new vscode.WorkspaceEdit();

    edit.replace(
        document.uri,
        new vscode.Range(
            document.positionAt(image.startOffset),
            document.positionAt(image.endOffset)
        ),
        replacement
    );

    return edit;
}

/**
 * 画像サイズをリセットし、width 指定をソースから除去する WorkspaceEdit を作成します。
 * @param document 編集対象の Markdown ドキュメントです。
 * @param image 更新対象の画像参照です。
 * @returns 変更がある場合のみ適用可能な WorkspaceEdit です。
 */
export function buildResetSizeEdit(
    document: vscode.TextDocument,
    image: SourceImageReference
): vscode.WorkspaceEdit | undefined {
    if (image.kind !== 'html') {
        return undefined;
    }

    const replacement = buildHtmlResetReplacement(image);

    if (replacement === image.originalText) {
        return undefined;
    }

    const edit = new vscode.WorkspaceEdit();

    edit.replace(
        document.uri,
        new vscode.Range(
            document.positionAt(image.startOffset),
            document.positionAt(image.endOffset)
        ),
        replacement
    );

    return edit;
}

/**
 * HTML 属性を追加または更新します。
 * @param tag 更新対象の HTML タグです。
 * @param attributeName 対象属性名です。
 * @param attributeValue 設定する属性値です。
 * @returns 更新後のタグ文字列です。
 */
export function upsertHtmlAttribute(
    tag: string,
    attributeName: string,
    attributeValue: string
): string {
    const pattern = new RegExp(
        `\\s${escapeRegExp(attributeName)}\\s*=\\s*(${ATTRIBUTE_VALUE_PATTERN})`,
        'i'
    );

    if (pattern.test(tag)) {
        return tag.replace(pattern, ` ${attributeName}="${escapeHtmlAttribute(attributeValue)}"`);
    }

    const closing = tag.endsWith('/>') ? '/>' : '>';
    return tag.slice(0, -closing.length)
        + ` ${attributeName}="${escapeHtmlAttribute(attributeValue)}"`
        + closing;
}

/**
 * HTML 属性をすべて除去します。
 * @param tag 更新対象の HTML タグです。
 * @param attributeName 除去する属性名です。
 * @returns 属性除去後のタグ文字列です。
 */
export function removeHtmlAttribute(tag: string, attributeName: string): string {
    const pattern = new RegExp(
        `\\s${escapeRegExp(attributeName)}\\s*=\\s*(?:${ATTRIBUTE_VALUE_PATTERN})`,
        'gi'
    );

    return tag.replace(pattern, '');
}

/**
 * HTML 属性値を安全にエスケープします。
 * @param value 変換対象の文字列です。
 * @returns エスケープ後の文字列です。
 */
export function escapeHtmlAttribute(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * 画像幅を整数に正規化します。
 * @param width 正規化する幅です。
 * @returns 1 以上の整数幅です。
 */
function normalizeWidth(width: number): number {
    return Math.max(1, Math.round(width));
}

/**
 * Markdown 画像記法を HTML img タグへ置換します。
 * @param image 更新対象の画像参照です。
 * @param width 正規化済みの幅です。
 * @returns 新しい HTML img タグです。
 */
function buildMarkdownReplacement(image: SourceImageReference, width: number): string {
    const attributes = [
        `src="${escapeHtmlAttribute(image.src)}"`,
        `alt="${escapeHtmlAttribute(image.alt)}"`,
        `width="${width}"`
    ];

    if (image.title) {
        attributes.push(`title="${escapeHtmlAttribute(image.title)}"`);
    }

    return `<img ${attributes.join(' ')}>`;
}

/**
 * 既存の HTML img タグから高さ属性を除去し、width を更新します。
 * @param image 更新対象の画像参照です。
 * @param width 正規化済みの幅です。
 * @returns 更新後の HTML img タグです。
 */
function buildHtmlReplacement(image: SourceImageReference, width: number): string {
    const withoutHeight = removeHtmlAttribute(image.originalText, 'height');
    return upsertHtmlAttribute(withoutHeight, 'width', String(width));
}

/**
 * 既存の HTML img タグから width / height を除去して自然サイズへ戻します。
 * @param image 更新対象の画像参照です。
 * @returns 更新後の HTML img タグです。
 */
function buildHtmlResetReplacement(image: SourceImageReference): string {
    const withoutHeight = removeHtmlAttribute(image.originalText, 'height');
    return removeHtmlAttribute(withoutHeight, 'width');
}

/**
 * 正規表現へ埋め込む文字列をエスケープします。
 * @param value エスケープ対象の文字列です。
 * @returns 正規表現用にエスケープした文字列です。
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}