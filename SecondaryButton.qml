import QtQuick
import qs.Commons
import qs.Ui

// The panel's secondary action: the kit's bordered Button at the panel's
// text size. AccentButton is the primary action and has the same padding,
// so the two line up in a row. With an icon and no text, the padding is
// the same on all four sides, so the button comes out square.
Button {
  bordered: true
  fontSize: Style.font.bodySmall
  horizontalPadding: text === "" ? verticalPadding : Style.spacing.controlPaddingX
}
