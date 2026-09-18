/**
 * 健壮的剪贴板复制工具函数：
 * 优先使用现代化 navigator.clipboard.writeText，在非安全上下文 (HTTP / 校内内网 IP / 部分 WebView) 或抛出异常时，
 * 自动降级为 textarea + document.execCommand('copy')，保障 100% 成功复制。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. 尝试使用现代 Clipboard API
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      console.warn("navigator.clipboard.writeText failed, falling back to execCommand", e);
    }
  }

  // 2. 降级方案：创建临时 textarea 元素并执行 execCommand
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    textArea.style.opacity = "0";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error("Fallback execCommand copy failed:", err);
    return false;
  }
}
