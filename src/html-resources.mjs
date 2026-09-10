const resourceTags = new Set(['script', 'img', 'link', 'iframe', 'source']);
const space = (char) => char !== undefined && /[\t\n\f\r ]/.test(char);
const relative = (value) => !/^(https?:|data:|\/\/|#)/i.test(value);

// Warning-only scan. Every cursor advances, including across malformed or unclosed input.
// This is not an HTML/CSS validator, dependency resolver or security boundary.
export function hasRelativeResources(html) {
  let cursor = 0;
  while ((cursor = html.indexOf('<', cursor)) !== -1) {
    if (html.startsWith('<!--', cursor)) {
      const end = html.indexOf('-->', cursor + 4);
      cursor = end === -1 ? html.length : end + 3;
      continue;
    }
    const start = ++cursor;
    while (cursor < html.length && /[A-Za-z0-9:-]/.test(html[cursor])) cursor++;
    if (!resourceTags.has(html.slice(start, cursor).toLowerCase())) continue;
    while (cursor < html.length) {
      while (space(html[cursor]) || html[cursor] === '/') cursor++;
      if (html[cursor] === '<') break;
      if (html[cursor] === '>') { cursor++; break; }
      const nameStart = cursor;
      while (cursor < html.length && !space(html[cursor]) && !/[=<>/]/.test(html[cursor])) cursor++;
      const name = html.slice(nameStart, cursor).toLowerCase();
      while (space(html[cursor])) cursor++;
      if (html[cursor] !== '=') continue;
      cursor++;
      while (space(html[cursor])) cursor++;
      const quote = html[cursor];
      let value;
      if (quote === '"' || quote === "'") {
        const end = html.indexOf(quote, cursor + 1);
        if (end === -1) { cursor = html.length; break; }
        value = html.slice(cursor + 1, end);
        cursor = end + 1;
      } else {
        const valueStart = cursor;
        while (cursor < html.length && !space(html[cursor]) && html[cursor] !== '>' && html[cursor] !== '<') cursor++;
        value = html.slice(valueStart, cursor);
      }
      if ((name === 'src' || name === 'href') && relative(value)) return true;
    }
  }

  const urls = /url\(/gi;
  let match;
  while ((match = urls.exec(html))) {
    cursor = urls.lastIndex;
    while (space(html[cursor])) cursor++;
    const quote = html[cursor];
    let value;
    if (quote === '"' || quote === "'") {
      const end = html.indexOf(quote, cursor + 1);
      if (end === -1) break;
      value = html.slice(cursor + 1, end);
      cursor = end + 1;
    } else {
      const start = cursor;
      while (cursor < html.length && !space(html[cursor]) && !/[()"']/.test(html[cursor])) cursor++;
      value = html.slice(start, cursor);
    }
    while (space(html[cursor])) cursor++;
    if (html[cursor] === ')' && relative(value)) return true;
    // Do not restart a failed match at each nested url( inside an unclosed value.
    urls.lastIndex = Math.max(cursor, match.index + 4);
  }
  return false;
}
