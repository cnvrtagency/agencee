export function cleanContent(content: string): string {
  return content
    .replace(/ — /g, ', ')
    .replace(/—/g, ', ')
    .replace(/ -- /g, ', ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
