"""Event descriptions as plain text.

Google stores a description written in its web editor as HTML (<br>, <a>,
<b>, lists), while iCal feeds and CalDAV usually carry plain text. The widget
renders descriptions as plain text only, so markup is turned into line breaks
here rather than shown as tags or interpreted there.
"""

import html
import re
from html.parser import HTMLParser

DESCRIPTION_LIMIT = 1500

# Only markup Google's editor actually emits, so a plain-text description that
# happens to contain "<ana@example.com>" or "a < b" is left alone.
_LOOKS_LIKE_HTML = re.compile(
    r"<(?:br|p|div|a|b|i|u|s|em|strong|span|ul|ol|li|h[1-6]|blockquote|font|html|body)\b[^>]*>",
    re.IGNORECASE,
)
_BLOCK_TAGS = {"p", "div", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "tr"}
_SKIPPED_TAGS = {"script", "style", "head", "title"}
# Terminated entities only. html.unescape alone also decodes legacy forms
# without the semicolon, which would turn plain "R&D&not" into "R&D¬".
_ENTITY = re.compile(r"&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);")
_HORIZONTAL_SPACE = re.compile(r"[ \t\f\v\u00a0]+")
_EXTRA_BLANK_LINES = re.compile(r"\n{3,}")


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self._skipping = 0
        self._links = []

    def handle_starttag(self, tag, attrs):
        if tag in _SKIPPED_TAGS:
            self._skipping += 1
        elif tag == "br":
            self.parts.append("\n")
        elif tag in _BLOCK_TAGS:
            self._line_break()
            if tag == "li":
                self.parts.append("• ")
        elif tag == "a":
            self._links.append((dict(attrs).get("href") or "", len(self.parts)))

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in _SKIPPED_TAGS:
            self._skipping = max(0, self._skipping - 1)
        elif tag in _BLOCK_TAGS:
            self._line_break()
        elif tag == "a" and self._links:
            href, first = self._links.pop()
            label = "".join(self.parts[first:])
            # Keep the address when the link text hides it ("Join here"),
            # since the text is all the widget will show.
            if href.startswith(("https://", "http://")) and href not in label:
                self.parts.append(" (%s)" % href)

    def handle_data(self, data):
        if not self._skipping and data:
            self.parts.append(data)

    def _line_break(self):
        # A block boundary, unlike <br>, never stacks: "</li><li>" is one break.
        if self.parts and not self.parts[-1].endswith("\n"):
            self.parts.append("\n")


def description_text(raw, limit=DESCRIPTION_LIMIT):
    """`raw` as tidy plain text of at most `limit` characters."""
    text = str(raw or "").replace("\r\n", "\n").replace("\r", "\n")
    if _LOOKS_LIKE_HTML.search(text):
        parser = _TextExtractor()
        parser.feed(text)
        parser.close()
        text = "".join(parser.parts)
    else:
        text = _ENTITY.sub(lambda match: html.unescape(match.group(0)), text)

    lines = [_HORIZONTAL_SPACE.sub(" ", line).strip() for line in text.split("\n")]
    text = _EXTRA_BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text
