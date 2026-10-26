/** Keep a contiguous tail of whole messages; never cut a sourced quotation in half. */
export function tutorHistory(log: { role: "user" | "assistant"; text: string }[]) {
  const encoder = new TextEncoder();
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  let bytes = 0;
  for (let index = log.length - 1; index >= 0 && messages.length < 8; index--) {
    const entry = log[index];
    const size = encoder.encode(entry.text).length;
    if (size > 4096 || bytes + size > 16384) break;
    messages.unshift({ role: entry.role, content: entry.text });
    bytes += size;
  }
  return messages;
}
