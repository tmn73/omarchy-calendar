import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons

import "Model.js" as Model
import "Strings.js" as Strings

Column {
  id: root

  required property color foreground
  required property string fontFamily
  required property string language
  required property bool active

  property bool available: false
  property var accounts: []
  property bool statusRefreshPending: false
  property string signInUrl: ""
  property string message: ""
  property bool finished: false
  readonly property string commandPath: Model.localPathFromUrl(
    Qt.resolvedUrl("sync/omarchy-calendar-google"))
  readonly property color faint: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.60)

  visible: available
  spacing: Style.space(8)

  function tr(key, args) {
    return Strings.tr(root.language, key, args)
  }

  function readStatus() {
    if (statusProcess.running) {
      root.statusRefreshPending = true
      return
    }
    statusProcess.running = true
  }

  function startSignIn() {
    root.message = ""
    root.signInUrl = ""
    root.finished = false
    signIn.running = true
    if (!signIn.running) root.message = root.tr("settings.googleSignInFailed")
  }

  function openSignIn() {
    if (root.signInUrl !== "" && !Qt.openUrlExternally(root.signInUrl))
      Quickshell.execDetached(["xdg-open", root.signInUrl])
  }

  function handleReply(line) {
    var reply
    try { reply = JSON.parse(line) } catch (error) { return }
    if (reply.url) {
      root.signInUrl = reply.url
      root.openSignIn()
      return
    }
    root.finished = true
    if (reply.error) {
      root.message = reply.error
      return
    }
    var key = reply.result === "existing" ? "settings.googleAlreadyConnected"
      : reply.result === "reconnected" ? "settings.googleReconnected" : "settings.googleAdded"
    root.message = root.tr(key, [reply.email])
    if (reply.syncing === false) root.message += "\n" + root.tr("settings.googleSyncLater")
    root.readStatus()
  }

  onActiveChanged: if (active) Qt.callLater(root.readStatus)
  Component.onCompleted: if (active) Qt.callLater(root.readStatus)

  Process {
    id: statusProcess
    command: [root.commandPath, "status"]
    stdout: SplitParser {
      onRead: function(line) {
        try {
          var status = JSON.parse(line)
          root.available = status.available === true
          root.accounts = status.primary ? [status.primary].concat(status.accounts) : status.accounts
        } catch (error) {
          root.available = false
        }
      }
    }
    onExited: {
      if (root.statusRefreshPending) {
        root.statusRefreshPending = false
        Qt.callLater(root.readStatus)
      }
    }
  }

  Process {
    id: signIn
    command: [root.commandPath, "add"]
    stdout: SplitParser {
      onRead: function(line) { root.handleReply(line) }
    }
    onExited: Qt.callLater(function() {
      root.signInUrl = ""
      if (!root.finished) root.message = root.tr("settings.googleSignInFailed")
    })
  }

  SettingsCaption {
    foreground: root.foreground
    fontFamily: root.fontFamily
    text: root.tr("settings.googleAccounts")
  }

  Repeater {
    model: root.accounts
    Text {
      required property string modelData
      width: root.width
      text: modelData
      textFormat: Text.PlainText
      elide: Text.ElideRight
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.bodySmall
    }
  }

  Row {
    spacing: Style.space(8)

    SecondaryButton {
      foreground: root.foreground
      fontFamily: root.fontFamily
      text: root.tr(signIn.running ? "settings.googleOpenSignIn" : "settings.googleAddAccount")
      enabled: !signIn.running || root.signInUrl !== ""
      onClicked: {
        if (signIn.running) root.openSignIn()
        else root.startSignIn()
      }
    }

    SecondaryButton {
      visible: signIn.running
      foreground: root.foreground
      fontFamily: root.fontFamily
      text: root.tr("common.cancel")
      onClicked: signIn.signal(15)
    }
  }

  Text {
    visible: text !== ""
    width: root.width
    text: signIn.running ? root.tr("settings.googleSignInHint") : root.message
    textFormat: Text.PlainText
    wrapMode: Text.Wrap
    color: root.faint
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
  }

  Item { width: 1; height: Style.space(8) }
}
