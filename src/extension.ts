import * as vscode from 'vscode';
import { MarkdownImageResizerCustomEditorProvider } from './markdownCustomEditorProvider';

/**
 * 拡張機能を有効化し、Custom Text Editor と関連コマンドを登録します。
 * @param context 拡張機能の実行コンテキストです。
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const provider = new MarkdownImageResizerCustomEditorProvider(context.extensionUri);

    context.subscriptions.push(
        provider,
        vscode.window.registerCustomEditorProvider(
            MarkdownImageResizerCustomEditorProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    const openCommand = vscode.commands.registerCommand(
        'markdownImageResizer.open',
        async (resource?: vscode.Uri) => {
            const target = resource ?? vscode.window.activeTextEditor?.document.uri;

            if (!target || !target.path.toLowerCase().endsWith('.md')) {
                void vscode.window.showInformationMessage('Open a Markdown file before using Markdown Image Resize Viewer.');
                return;
            }

            await vscode.commands.executeCommand(
                'vscode.openWith',
                target,
                MarkdownImageResizerCustomEditorProvider.viewType
            );
        }
    );

    context.subscriptions.push(openCommand);
}

/**
 * 拡張機能を無効化します。
 */
export function deactivate(): void {
    // 現時点では後処理はありません。
}