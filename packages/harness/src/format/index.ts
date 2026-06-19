export function markdownToPlain(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function markdownToSlackMrkdwn(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/`([^`]+)`/g, '`$1`')
    .replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
}

export function markdownToTelegramHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function markdownToDiscord(text: string): string {
  return markdownToPlain(text);
}

export function formatForChannel(channel: string, markdown: string): string {
  switch (channel) {
    case 'slack':
      return markdownToSlackMrkdwn(markdown);
    case 'telegram':
      return markdownToTelegramHtml(markdown);
    case 'discord':
      return markdownToDiscord(markdown);
    default:
      return markdownToPlain(markdown);
  }
}
