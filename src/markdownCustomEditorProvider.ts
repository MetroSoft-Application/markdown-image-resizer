import * as path from 'path';
import * as vscode from 'vscode';
import {
    buildMarkdownViewModel,
    type MarkdownViewModel,
    type SourceImageReference
} from './markdownDocumentModel';
import { buildResetSizeEdit, buildResizeEdit } from './sourceRewrite';

interface ReadyMessage {
    type: 'ready';
}

interface ResizeMessage {
    type: 'resizeImage';
    payload: {
        imageId: string;
        width: number;
        documentVersion: number;
    };
}

interface ResetMessage {
    type: 'resetImageSize';
    payload: {
        imageId: string;
        documentVersion: number;
    };
}

interface RevealSourceMessage {
    type: 'revealSource';
    payload: {
        imageId: string;
    };
}

type IncomingMessage = ReadyMessage | ResizeMessage | ResetMessage | RevealSourceMessage;

interface EditorState {
    readonly panel: vscode.WebviewPanel;
    readonly document: vscode.TextDocument;
    isReady: boolean;
    viewModel: MarkdownViewModel | undefined;
}

/**
 * Markdown をマウス操作で画像リサイズできる Custom Text Editor として提供します。
 */
export class MarkdownImageResizerCustomEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
    static readonly viewType = 'markdownImageResizer.editor';

    /**
     * プロバイダーを初期化します。
     * @param extensionUri 拡張機能のルート URI です。
     */
    constructor(private readonly extensionUri: vscode.Uri) { }

    /**
     * Custom Text Editor を解決し、Webview と TextDocument の同期を開始します。
     * @param document 対象の TextDocument です。
     * @param webviewPanel エディター表示に使う WebviewPanel です。
     * @param token キャンセルトークンです。
     */
    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        token: vscode.CancellationToken
    ): Promise<void> {
        void token;

        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: getLocalResourceRoots(this.extensionUri, document)
        };

        webviewPanel.title = `${path.basename(document.uri.fsPath)} · Markdown Image Resize Viewer`;
        webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

        const state: EditorState = {
            panel: webviewPanel,
            document,
            isReady: false,
            viewModel: undefined
        };

        const render = async (): Promise<void> => {
            state.viewModel = buildMarkdownViewModel(document, webviewPanel.webview);

            if (!state.isReady) {
                return;
            }

            await webviewPanel.webview.postMessage({
                type: 'render',
                payload: state.viewModel
            });
        };

        const documentChangeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
            if (event.document.uri.toString() !== document.uri.toString()) {
                return;
            }

            void render();
        });

        const messageSubscription = webviewPanel.webview.onDidReceiveMessage((message: IncomingMessage) => {
            void this.handleMessage(state, message, render);
        });

        const disposeSubscription = webviewPanel.onDidDispose(() => {
            documentChangeSubscription.dispose();
            messageSubscription.dispose();
            disposeSubscription.dispose();
        });

        await render();
    }

    /**
     * プロバイダーが保持するリソースを解放します。
     */
    dispose(): void {
        return;
    }

    /**
     * Webview から受信したメッセージを処理します。
     * @param state 対象エディターの状態です。
     * @param message 受信したメッセージです。
     * @param render 最新状態を再描画する関数です。
     */
    private async handleMessage(
        state: EditorState,
        message: IncomingMessage,
        render: () => Promise<void>
    ): Promise<void> {
        if (message.type === 'ready') {
            state.isReady = true;
            await render();
            return;
        }

        if (message.type === 'revealSource') {
            if (!state.viewModel) {
                await render();
            }

            const targetImage = state.viewModel?.images.find((image) => image.id === message.payload.imageId);

            if (targetImage) {
                await this.revealSource(state, targetImage);
            }

            return;
        }

        if (message.type !== 'resizeImage' && message.type !== 'resetImageSize') {
            return;
        }

        if (!state.viewModel || state.viewModel.version !== message.payload.documentVersion) {
            await render();
            return;
        }

        const targetImage = state.viewModel.images.find((image) => image.id === message.payload.imageId);

        if (!targetImage || !targetImage.resizable) {
            return;
        }

        if (message.type === 'resizeImage') {
            await this.applyResize(state, targetImage, message.payload.width);
            return;
        }

        if (targetImage.canReset) {
            await this.applyReset(state, targetImage);
        }
    }

    /**
     * リサイズ内容を Markdown ソースへ書き戻します。
     * @param state 対象エディターの状態です。
     * @param image 更新対象の画像参照です。
     * @param width 新しい画像幅です。
     */
    private async applyResize(
        state: EditorState,
        image: SourceImageReference,
        width: number
    ): Promise<void> {
        const edit = buildResizeEdit(state.document, image, width);
        const applied = await vscode.workspace.applyEdit(edit);

        if (!applied) {
            void vscode.window.showWarningMessage('Markdown Image Resize Viewer could not update the Markdown source.');
        }
    }

    /**
     * 画像の width 指定を除去して自然サイズへ戻します。
     * @param state 対象エディターの状態です。
     * @param image 更新対象の画像参照です。
     */
    private async applyReset(
        state: EditorState,
        image: SourceImageReference
    ): Promise<void> {
        const edit = buildResetSizeEdit(state.document, image);

        if (!edit) {
            return;
        }

        const applied = await vscode.workspace.applyEdit(edit);

        if (!applied) {
            void vscode.window.showWarningMessage('Markdown Image Resize Viewer could not reset the image size.');
        }
    }

    /**
     * プレビュー上の画像に対応するソース範囲を通常エディターで選択表示します。
     * @param state 対象エディターの状態です。
     * @param image 対応する画像参照です。
     */
    private async revealSource(state: EditorState, image: SourceImageReference): Promise<void> {
        const editor = await vscode.window.showTextDocument(state.document, {
            preview: false,
            preserveFocus: false
        });
        const range = new vscode.Range(
            state.document.positionAt(image.startOffset),
            state.document.positionAt(image.endOffset)
        );

        editor.selection = new vscode.Selection(range.start, range.end);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }

    /**
     * Custom Editor Webview 全体の HTML を生成します。
     * @param webview HTML を設定する Webview です。
     * @returns Webview に設定する完全な HTML 文字列です。
     */
    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: http: data:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <title>Markdown Image Resize Viewer</title>
    <style nonce="${nonce}">
        :root {
            color-scheme: light dark;
            --ifm-handle-size: 14px;
            --ifm-canvas-padding: 32px;
            --ifm-panel-width: min(960px, calc(100vw - var(--ifm-canvas-padding) * 2));
            --ifm-accent: #c26f1c;
            --ifm-accent-soft: color-mix(in srgb, var(--ifm-accent) 18%, transparent);
            --ifm-surface: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-editorWidget-background) 12%);
            --ifm-border: color-mix(in srgb, var(--vscode-editor-foreground) 16%, transparent);
            --ifm-body-font: var(--vscode-font-family);
            --ifm-heading-font: var(--vscode-font-family);
            --ifm-code-font: var(--vscode-editor-font-family);
        }

        * {
            box-sizing: border-box;
        }

        html,
        body {
            margin: 0;
            min-height: 100%;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-family: var(--ifm-body-font);
        }

        body {
            padding: 0;
        }

        .shell {
            width: 100%;
            margin: 0;
            padding: 12px 18px 28px;
        }

        .banner {
            margin-bottom: 16px;
            padding: 12px 14px;
            border-radius: 12px;
            background: color-mix(in srgb, var(--ifm-accent) 16%, var(--vscode-editorWarning-background));
            color: var(--vscode-editorWarning-foreground, var(--vscode-editor-foreground));
            border: 1px solid color-mix(in srgb, var(--ifm-accent) 32%, transparent);
        }

        .banner.is-hidden {
            display: none;
        }

        .document {
            position: relative;
            width: 100%;
            min-height: calc(100vh - 40px);
            padding: 0 0 24px;
            border: 0;
            border-radius: 0;
            background: transparent;
            box-shadow: none;
            overflow-x: hidden;
            overflow-y: auto;
            font-family: var(--ifm-body-font);
            line-height: 1.68;
            font-size: var(--vscode-font-size, 13px);
        }

        .document :is(h1, h2, h3, h4) {
            font-family: var(--ifm-heading-font);
            font-weight: 600;
            line-height: 1.25;
            letter-spacing: 0;
            margin-top: 1.5em;
        }

        .document h1 {
            font-size: 2.1em;
        }

        .document h2 {
            font-size: 1.55em;
        }

        .document h3,
        .document h4 {
            font-size: 1.2em;
        }

        .document :is(h1, h2, h3, h4):first-child {
            margin-top: 0;
        }

        .document pre {
            padding: 14px 16px;
            border-radius: 12px;
            overflow: auto;
            background: color-mix(in srgb, var(--vscode-textCodeBlock-background) 84%, var(--vscode-editor-background));
        }

        .document code {
            font-family: var(--ifm-code-font);
        }

        .document img {
            display: block;
            width: auto;
            max-width: 100%;
            height: auto;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
        }

        .ifm-image-frame {
            position: relative;
            display: block;
            width: fit-content;
            max-width: 100%;
            margin: 8px 0 18px;
        }

        .ifm-image-frame.is-overlay {
            position: absolute;
            width: auto;
            max-width: none;
            margin: 0;
            z-index: 4;
            pointer-events: none;
        }

        .ifm-image-frame.is-overlay .ifm-image-actions,
        .ifm-image-frame.is-overlay .ifm-resize-handle {
            pointer-events: auto;
        }

        .ifm-image-frame.is-readonly {
            opacity: 0.92;
        }

        .ifm-image-frame.is-broken img {
            opacity: 0.35;
            filter: grayscale(0.6);
        }

        .ifm-image-frame.is-broken {
            min-width: 72px;
            min-height: 48px;
        }

        .ifm-image-frame.is-resizing img {
            outline: 2px solid color-mix(in srgb, var(--ifm-accent) 60%, white);
            outline-offset: 4px;
            cursor: nwse-resize;
        }

        .ifm-image-badge,
        .ifm-image-meta {
            position: absolute;
            left: 12px;
            padding: 4px 8px;
            border-radius: 999px;
            font-family: var(--ifm-body-font);
            font-size: 11px;
            font-weight: 600;
            line-height: 1;
            background: rgba(19, 24, 31, 0.78);
            color: #fffaf2;
            pointer-events: none;
        }

        .ifm-image-badge {
            top: 12px;
        }

        .ifm-image-meta {
            top: 40px;
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 120ms ease, transform 120ms ease;
        }

        .ifm-image-actions {
            position: absolute;
            top: 12px;
            right: 12px;
            display: flex;
            gap: 6px;
            opacity: 0;
            transform: translateY(-4px);
            transition: opacity 120ms ease, transform 120ms ease;
        }

        .ifm-image-frame:hover .ifm-image-meta,
        .ifm-image-frame.is-resizing .ifm-image-meta,
        .ifm-image-frame.is-readonly .ifm-image-meta,
        .ifm-image-frame.is-broken .ifm-image-meta,
        .ifm-image-frame:hover .ifm-image-actions,
        .ifm-image-frame.is-resizing .ifm-image-actions,
        .ifm-image-frame.is-readonly .ifm-image-actions,
        .ifm-image-frame.is-broken .ifm-image-actions {
            opacity: 1;
            transform: translateY(0);
        }

        .ifm-image-action {
            padding: 4px 9px;
            border: 1px solid color-mix(in srgb, var(--ifm-accent) 35%, transparent);
            border-radius: 999px;
            background: rgba(19, 24, 31, 0.78);
            color: #fffaf2;
            font: inherit;
            font-size: 11px;
            line-height: 1;
            cursor: pointer;
        }

        .ifm-image-action:hover {
            background: rgba(34, 41, 52, 0.92);
        }

        .ifm-image-action:focus-visible {
            outline: 2px solid color-mix(in srgb, var(--ifm-accent) 72%, white);
            outline-offset: 2px;
        }

        .ifm-resize-handle {
            position: absolute;
            right: calc(var(--ifm-handle-size) * -0.4);
            bottom: calc(var(--ifm-handle-size) * -0.4);
            width: var(--ifm-handle-size);
            height: var(--ifm-handle-size);
            border: 0;
            border-radius: 50%;
            background: linear-gradient(135deg, color-mix(in srgb, var(--ifm-accent) 92%, white), var(--ifm-accent));
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.18);
            cursor: nwse-resize;
        }

        .ifm-resize-handle::after {
            content: '';
            position: absolute;
            inset: 4px;
            border-right: 2px solid rgba(255, 255, 255, 0.85);
            border-bottom: 2px solid rgba(255, 255, 255, 0.85);
            border-radius: 0 0 3px 0;
        }

        @media (max-width: 720px) {
            .shell {
                padding: 10px 12px 24px;
            }
        }

    </style>
</head>
<body>
    <div class="shell">
        <div id="banner" class="banner is-hidden"></div>
        <article id="document" class="document"></article>
    </div>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const state = {
            version: 0,
            settings: {
                dragHandleSize: 14,
                minImageWidth: 48,
                canvasPadding: 32
            }
        };
        const banner = document.getElementById('banner');
        const article = document.getElementById('document');

        window.addEventListener('message', (event) => {
            const message = event.data;

            if (!message || typeof message.type !== 'string') {
                return;
            }

            if (message.type === 'render') {
                render(message.payload);
                return;
            }

        });

        vscode.postMessage({ type: 'ready' });

        function render(model) {
            state.version = model.version;
            state.settings = model.settings;
            document.documentElement.style.setProperty('--ifm-handle-size', String(model.settings.dragHandleSize) + 'px');
            document.documentElement.style.setProperty('--ifm-canvas-padding', String(model.settings.canvasPadding) + 'px');
            article.innerHTML = model.html;
            banner.classList.add('is-hidden');

            initializeImages(model.images);
        }

        function initializeImages(images) {
            const imageLookup = new Map(images.map((image) => [image.id, image]));
            const imageElements = article.querySelectorAll('img[data-imagefree-id], image[data-imagefree-id]');

            imageElements.forEach((element) => {
                const imageId = element.dataset.imagefreeId;
                const image = imageLookup.get(imageId);

                if (!image) {
                    return;
                }

                enhanceImage(element, image);
            });
        }

        function enhanceImage(imageElement, image) {
            if (shouldUseOverlayFrame(imageElement)) {
                enhanceOverlayImage(imageElement, image);
                return;
            }

            enhanceWrappedImage(imageElement, image);
        }

        function shouldUseOverlayFrame(imageElement) {
            const tagName = imageElement.tagName.toLowerCase();
            const parentTagName = imageElement.parentElement?.tagName?.toLowerCase();
            return tagName === 'image' || parentTagName === 'picture';
        }

        function enhanceWrappedImage(imageElement, image) {
            if (!imageElement.parentNode) {
                return;
            }

            const { frame, badge, meta } = createImageFrameChrome(image);

            imageElement.parentNode.insertBefore(frame, imageElement);
            frame.appendChild(imageElement);

            imageElement.style.display = 'block';
            imageElement.style.height = 'auto';
            imageElement.style.maxWidth = '100%';

            if (image.resizable) {
                const handle = createResizeHandle((event) => startWrappedResize(event, image, frame, imageElement, badge));
                frame.appendChild(handle);
            }

            const handleImageReady = once(() => {
                frame.classList.remove('is-broken');
                applyInitialWrappedImageWidth(frame, imageElement);
                updateBadge(badge, imageElement);
            });

            const handleImageError = once(() => {
                frame.classList.add('is-broken');
                meta.textContent = 'Image could not be loaded';
                frame.style.removeProperty('width');
                const handle = frame.querySelector('.ifm-resize-handle');

                if (handle) {
                    handle.remove();
                }
            });

            initializeImageElementState(imageElement, handleImageReady, handleImageError);
        }

        function enhanceOverlayImage(imageElement, image) {
            const { frame, badge, meta } = createImageFrameChrome(image);
            frame.classList.add('is-overlay');
            article.appendChild(frame);

            const syncFrame = () => syncOverlayFrame(frame, imageElement);

            if (image.resizable) {
                const handle = createResizeHandle((event) => startOverlayResize(event, image, frame, imageElement, badge, syncFrame));
                frame.appendChild(handle);
            }

            const handleImageReady = once(() => {
                frame.classList.remove('is-broken');
                syncFrame();
                updateBadge(badge, imageElement);
            });

            const handleImageError = once(() => {
                frame.classList.add('is-broken');
                meta.textContent = 'Image could not be loaded';
                syncFrame();
                const handle = frame.querySelector('.ifm-resize-handle');

                if (handle) {
                    handle.remove();
                }
            });

            initializeImageElementState(imageElement, handleImageReady, handleImageError);
        }

        function createImageFrameChrome(image) {
            const frame = document.createElement('span');
            frame.className = 'ifm-image-frame';
            frame.dataset.imagefreeId = image.id;

            if (!image.resizable) {
                frame.classList.add('is-readonly');
            }

            const badge = document.createElement('span');
            badge.className = 'ifm-image-badge';
            frame.appendChild(badge);

            const meta = document.createElement('span');
            meta.className = 'ifm-image-meta';
            meta.textContent = image.resizable ? 'Drag handle to resize' : 'Remote image is read-only';
            frame.appendChild(meta);

            const actions = document.createElement('span');
            actions.className = 'ifm-image-actions';
            actions.appendChild(createActionButton('Source', () => {
                vscode.postMessage({
                    type: 'revealSource',
                    payload: {
                        imageId: image.id
                    }
                });
            }));

            if (image.resizable && image.canReset) {
                actions.appendChild(createActionButton('Reset', () => {
                    vscode.postMessage({
                        type: 'resetImageSize',
                        payload: {
                            imageId: image.id,
                            documentVersion: state.version
                        }
                    });
                }));
            }

            frame.appendChild(actions);

            return { frame, badge, meta };
        }

        function createResizeHandle(onPointerDown) {
            const handle = document.createElement('button');
            handle.className = 'ifm-resize-handle';
            handle.type = 'button';
            handle.setAttribute('aria-label', 'Resize image');
            handle.addEventListener('pointerdown', onPointerDown);
            return handle;
        }

        function initializeImageElementState(imageElement, onReady, onError) {
            imageElement.addEventListener('load', onReady, { once: true });
            imageElement.addEventListener('error', onError, { once: true });

            if (imageElement instanceof HTMLImageElement) {
                if (imageElement.complete) {
                    if (imageElement.naturalWidth > 0) {
                        onReady();
                    } else {
                        onError();
                    }
                }

                return;
            }

            requestAnimationFrame(() => {
                if (getRenderedImageWidth(imageElement) > 0) {
                    onReady();
                    return;
                }

                requestAnimationFrame(() => {
                    if (getRenderedImageWidth(imageElement) > 0) {
                        onReady();
                        return;
                    }

                    onReady();
                });
            });
        }

        function createActionButton(label, onClick) {
            const button = document.createElement('button');
            button.className = 'ifm-image-action';
            button.type = 'button';
            button.textContent = label;
            button.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                onClick();
            });
            return button;
        }

        function once(callback) {
            let invoked = false;

            return () => {
                if (invoked) {
                    return;
                }

                invoked = true;
                callback();
            };
        }

        function updateBadge(badge, imageElement) {
            badge.textContent = String(getRenderedImageWidth(imageElement) || 0) + 'px';
        }

        function getRenderedImageWidth(imageElement) {
            const measuredWidth = Math.round(imageElement.getBoundingClientRect().width);

            if (measuredWidth > 0) {
                return measuredWidth;
            }

            return getExplicitImageWidth(imageElement)
                || getIntrinsicImageWidth(imageElement)
                || 0;
        }

        function getRenderedImageHeight(imageElement) {
            const measuredHeight = Math.round(imageElement.getBoundingClientRect().height);

            if (measuredHeight > 0) {
                return measuredHeight;
            }

            return getExplicitImageHeight(imageElement) || 0;
        }

        function getExplicitImageWidth(imageElement) {
            return getNumericAttribute(imageElement, 'width');
        }

        function getExplicitImageHeight(imageElement) {
            return getNumericAttribute(imageElement, 'height');
        }

        function getIntrinsicImageWidth(imageElement) {
            if (imageElement instanceof HTMLImageElement) {
                return imageElement.naturalWidth || 0;
            }

            if (typeof imageElement.getBBox === 'function') {
                try {
                    return Math.round(imageElement.getBBox().width) || 0;
                } catch {
                    return 0;
                }
            }

            return 0;
        }

        function getNumericAttribute(imageElement, attributeName) {
            const rawValue = imageElement.getAttribute(attributeName);

            if (!rawValue) {
                return 0;
            }

            const parsed = Number.parseFloat(rawValue);
            return Number.isFinite(parsed) ? parsed : 0;
        }

        function applyInitialWrappedImageWidth(frame, imageElement) {
            const preferredWidth = getExplicitImageWidth(imageElement)
                || getIntrinsicImageWidth(imageElement)
                || 320;
            const containerWidth = getAvailableImageWidth(frame);
            const nextWidth = Math.max(1, Math.min(preferredWidth, containerWidth));

            frame.style.width = String(nextWidth) + 'px';
            imageElement.style.width = '100%';
            imageElement.style.maxWidth = '100%';
            imageElement.style.height = 'auto';
        }

        function syncOverlayFrame(frame, imageElement) {
            const imageRect = imageElement.getBoundingClientRect();
            const articleRect = article.getBoundingClientRect();

            frame.style.left = String(Math.round(imageRect.left - articleRect.left + article.scrollLeft)) + 'px';
            frame.style.top = String(Math.round(imageRect.top - articleRect.top + article.scrollTop)) + 'px';
            frame.style.width = String(Math.max(1, Math.round(imageRect.width))) + 'px';
            frame.style.height = String(Math.max(1, Math.round(imageRect.height))) + 'px';
        }

        function getAvailableImageWidth(frame) {
            const host = frame.closest('.document');

            if (!(host instanceof HTMLElement)) {
                return 640;
            }

            const hostStyles = window.getComputedStyle(host);
            const paddingLeft = parseFloat(hostStyles.paddingLeft || '0');
            const paddingRight = parseFloat(hostStyles.paddingRight || '0');
            const scrollbarWidth = host.offsetWidth - host.clientWidth;

            return Math.max(120, Math.floor(host.clientWidth - paddingLeft - paddingRight - scrollbarWidth));
        }

        function startWrappedResize(event, image, frame, imageElement, badge) {
            event.preventDefault();

            const handle = event.currentTarget;
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startWidth = frame.getBoundingClientRect().width || imageElement.getBoundingClientRect().width;
            const minWidth = Number(state.settings.minImageWidth) || 48;
            const maxWidth = getAvailableImageWidth(frame);

            frame.classList.add('is-resizing');
            frame.style.width = String(Math.round(startWidth)) + 'px';
            imageElement.style.width = '100%';
            imageElement.style.height = 'auto';
            handle.setPointerCapture(pointerId);

            const onPointerMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + delta)));

                frame.style.width = String(nextWidth) + 'px';
                imageElement.style.width = '100%';
                imageElement.style.height = 'auto';
                updateBadge(badge, imageElement);
            };

            const finishResize = (commit) => (finishEvent) => {
                if (finishEvent.pointerId !== pointerId) {
                    return;
                }

                handle.releasePointerCapture(pointerId);
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerCancel);
                frame.classList.remove('is-resizing');

                if (!commit) {
                    frame.style.width = String(Math.round(startWidth)) + 'px';
                    imageElement.style.width = '100%';
                    imageElement.style.height = 'auto';
                    updateBadge(badge, imageElement);
                    return;
                }

                vscode.postMessage({
                    type: 'resizeImage',
                    payload: {
                        imageId: image.id,
                        width: Math.min(maxWidth, Math.max(minWidth, Math.round(frame.getBoundingClientRect().width))),
                        documentVersion: state.version
                    }
                });
            };

            const onPointerUp = finishResize(true);
            const onPointerCancel = finishResize(false);

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerCancel);
        }

        function startOverlayResize(event, image, frame, imageElement, badge, syncFrame) {
            event.preventDefault();

            const handle = event.currentTarget;
            const pointerId = event.pointerId;
            const startX = event.clientX;
            const startWidth = getRenderedImageWidth(imageElement) || frame.getBoundingClientRect().width;
            const startHeight = getRenderedImageHeight(imageElement) || frame.getBoundingClientRect().height;
            const minWidth = Number(state.settings.minImageWidth) || 48;
            const maxWidth = getAvailableImageWidth(frame);
            const aspectRatio = startWidth > 0 && startHeight > 0 ? startWidth / startHeight : 1;
            const originalWidth = imageElement.getAttribute('width');
            const originalHeight = imageElement.getAttribute('height');

            frame.classList.add('is-resizing');
            handle.setPointerCapture(pointerId);

            const onPointerMove = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const nextWidth = Math.min(maxWidth, Math.max(minWidth, Math.round(startWidth + delta)));

                applyOverlayImageSize(imageElement, nextWidth, aspectRatio);
                syncFrame();
                updateBadge(badge, imageElement);
            };

            const finishResize = (commit) => (finishEvent) => {
                if (finishEvent.pointerId !== pointerId) {
                    return;
                }

                handle.releasePointerCapture(pointerId);
                handle.removeEventListener('pointermove', onPointerMove);
                handle.removeEventListener('pointerup', onPointerUp);
                handle.removeEventListener('pointercancel', onPointerCancel);
                frame.classList.remove('is-resizing');

                if (!commit) {
                    restoreOverlayImageSize(imageElement, originalWidth, originalHeight);
                    syncFrame();
                    updateBadge(badge, imageElement);
                    return;
                }

                vscode.postMessage({
                    type: 'resizeImage',
                    payload: {
                        imageId: image.id,
                        width: Math.min(maxWidth, Math.max(minWidth, getRenderedImageWidth(imageElement))),
                        documentVersion: state.version
                    }
                });
            };

            const onPointerUp = finishResize(true);
            const onPointerCancel = finishResize(false);

            handle.addEventListener('pointermove', onPointerMove);
            handle.addEventListener('pointerup', onPointerUp);
            handle.addEventListener('pointercancel', onPointerCancel);
        }

        function applyOverlayImageSize(imageElement, width, aspectRatio) {
            imageElement.setAttribute('width', String(width));

            if (aspectRatio > 0) {
                imageElement.setAttribute('height', String(Math.max(1, Math.round(width / aspectRatio))));
            } else {
                imageElement.removeAttribute('height');
            }
        }

        function restoreOverlayImageSize(imageElement, originalWidth, originalHeight) {
            if (originalWidth === null) {
                imageElement.removeAttribute('width');
            } else {
                imageElement.setAttribute('width', originalWidth);
            }

            if (originalHeight === null) {
                imageElement.removeAttribute('height');
            } else {
                imageElement.setAttribute('height', originalHeight);
            }
        }
    </script>
</body>
</html>`;
    }
}

/**
 * Custom Editor で利用するローカルリソースルートを組み立てます。
 * @param extensionUri 拡張機能のルート URI です。
 * @param document 対象ドキュメントです。
 * @returns Webview がアクセス可能なルート一覧です。
 */
function getLocalResourceRoots(
    extensionUri: vscode.Uri,
    document: vscode.TextDocument
): vscode.Uri[] {
    if (document.uri.scheme !== 'file') {
        return [extensionUri];
    }

    return [
        extensionUri,
        vscode.Uri.file(path.dirname(document.uri.fsPath))
    ];
}

/**
 * CSP nonce を生成します。
 * @returns ランダムな英数字 nonce です。
 */
function getNonce(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';

    for (let index = 0; index < 32; index += 1) {
        nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }

    return nonce;
}