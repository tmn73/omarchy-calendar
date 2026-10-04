import unittest

from omarchy_calendar_sync.plaintext import DESCRIPTION_LIMIT, description_text


class TestDescriptionText(unittest.TestCase):
    def test_line_breaks_and_paragraphs_become_newlines(self):
        self.assertEqual(description_text("a<br>b<br/>c<p>d</p><div>e</div>"), "a\nb\nc\nd\ne")

    def test_list_items_get_bullets_without_blank_lines_between_them(self):
        self.assertEqual(description_text("<ul><li>one</li><li>two</li></ul>"), "• one\n• two")

    def test_entities_are_decoded(self):
        self.assertEqual(description_text("<b>Tom &amp; Jerry&nbsp;&#8212; &quot;live&quot;</b>"),
                         'Tom & Jerry \u2014 "live"')

    def test_a_link_keeps_its_address_when_the_text_hides_it(self):
        self.assertEqual(description_text('<a href="https://x.example/j">Join here</a>'),
                         "Join here (https://x.example/j)")
        self.assertEqual(description_text('<a href="https://x.example/j">https://x.example/j</a>'),
                         "https://x.example/j")
        self.assertEqual(description_text('<a href="mailto:a@b.c">write</a>'), "write")

    def test_scripts_and_styles_are_dropped(self):
        self.assertEqual(description_text("<p>hi</p><style>p{}</style><script>x()</script>"), "hi")

    def test_excess_blank_lines_and_spaces_collapse(self):
        self.assertEqual(description_text("a<br><br><br><br>b   c\t d"), "a\n\nb c d")
        self.assertEqual(description_text("  a\r\n\r\n\r\n\r\nb  "), "a\n\nb")

    def test_plain_text_with_angle_brackets_is_left_alone(self):
        text = "Ana <ana@example.com>\nif a < b then R&D"
        self.assertEqual(description_text(text), text)

    def test_plain_text_decodes_only_terminated_entities(self):
        self.assertEqual(description_text("fish &amp; chips &notes"), "fish & chips &notes")

    def test_long_text_is_capped_with_an_ellipsis(self):
        capped = description_text("word " * 1000)
        self.assertLessEqual(len(capped), DESCRIPTION_LIMIT)
        self.assertTrue(capped.endswith("…"))
        self.assertEqual(description_text("abc", limit=2), "a…")

    def test_blank_inputs(self):
        self.assertEqual(description_text(None), "")
        self.assertEqual(description_text("<br><p></p>"), "")


if __name__ == "__main__":
    unittest.main()
