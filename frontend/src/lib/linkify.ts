// Tách URL (http/https) ra khỏi đoạn chữ để render thành link bấm được — dùng cho tin nhắn chat.
// Không import gì để test được bằng node --test (tests/linkify.test.cjs).

export type TextPart = { type: "text" | "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"']+/g;
// Dấu câu hay đi liền sau URL trong câu ("...xem link này: https://a.b/c." ) -> không tính vào link.
const TRAILING = /[.,;:!?]+$/;

/** "xem https://a.b/c nhé" -> [text "xem ", link "https://a.b/c", text " nhé"].
 *  Dấu ngoặc đóng thừa ở cuối (không có ngoặc mở tương ứng trong URL) cũng bị đẩy ra ngoài. */
export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of Array.from(text.matchAll(URL_RE))) {
    let url = m[0];
    let tail = "";
    // Bỏ dần dấu câu / ngoặc đóng thừa ở cuối URL.
    for (;;) {
      const punct = url.match(TRAILING);
      if (punct) {
        url = url.slice(0, -punct[0].length);
        tail = punct[0] + tail;
        continue;
      }
      if (url.endsWith(")") && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
        url = url.slice(0, -1);
        tail = ")" + tail;
        continue;
      }
      break;
    }
    const start = m.index ?? 0;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    if (url) parts.push({ type: "link", value: url });
    if (tail) parts.push({ type: "text", value: tail });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}
