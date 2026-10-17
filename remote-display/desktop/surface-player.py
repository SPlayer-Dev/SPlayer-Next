#!/usr/bin/python3
"""Surface Player：只渲染主机播放器界面的 GTK/WebKit 窗口。"""
import json
import os
from pathlib import Path
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, Gdk, GLib, WebKit2

URL = os.environ.get("SURFACE_PLAYER_URL", "http://192.168.2.38:14558/display/")


class Player(Gtk.ApplicationWindow):
    def __init__(self, application):
        super().__init__(application=application, title="Surface Player")
        self.set_default_size(1440, 960)
        self.is_fullscreen = True
        self.retry_source = 0
        self.web = WebKit2.WebView()
        self.web.get_settings().set_enable_developer_extras(True)
        self.web.get_settings().set_media_playback_requires_user_gesture(True)
        self.web.set_background_color(Gdk.RGBA(0.11, 0.11, 0.15, 1))
        self.web.connect("load-failed", self.on_failure)
        self.web.connect("web-process-terminated", self.on_terminated)
        self.web.connect("decide-policy", self.on_policy)
        self.web.connect("permission-request", self.deny_permission)
        self.web.connect("load-changed", self.on_load)
        self.add(self.web)
        self.connect("key-press-event", self.on_key)
        self.web.load_uri(URL)
        self.show_all()
        self.fullscreen()
        GLib.timeout_add_seconds(5, self.diagnostics)

    def deny_permission(self, _web, request):
        request.deny()
        return True

    def toggle_fullscreen(self):
        self.is_fullscreen = not self.is_fullscreen
        self.fullscreen() if self.is_fullscreen else self.unfullscreen()

    def on_key(self, _window, event):
        if event.keyval == Gdk.KEY_F11:
            self.toggle_fullscreen()
            return True
        if event.keyval == Gdk.KEY_Escape and self.is_fullscreen:
            self.toggle_fullscreen()
            return True
        if event.keyval in (Gdk.KEY_q, Gdk.KEY_Q) and event.state & Gdk.ModifierType.CONTROL_MASK:
            self.destroy()
            return True
        return False

    def on_policy(self, _web, decision, kind):
        if kind == WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            uri = decision.get_navigation_action().get_request().get_uri()
            if not uri.startswith(URL) and uri != "about:blank":
                decision.ignore()
                return True
        return False

    def reload(self):
        self.retry_source = 0
        self.web.load_uri(URL)
        return False

    def on_failure(self, *_args):
        if not self.retry_source:
            self.web.load_html("<html style='background:#1c1d27'><body style='margin:0'><div aria-label='主机未连接' style='position:fixed;inset:0;background:rgba(255,90,90,.18)'></div></body></html>", "about:blank")
            self.retry_source = GLib.timeout_add_seconds(5, self.reload)
        return True

    def on_terminated(self, *_args):
        self.on_failure()

    def on_load(self, _web, event):
        if event == WebKit2.LoadEvent.FINISHED and self.web.get_uri() == URL and self.retry_source:
            GLib.source_remove(self.retry_source)
            self.retry_source = 0

    def diagnostics(self):
        def complete(web, result):
            try:
                value = web.evaluate_javascript_finish(result).to_string()
                data = json.loads(value)
                if isinstance(data, dict):
                    folder = Path.home() / ".local/state/surface-player"
                    folder.mkdir(parents=True, exist_ok=True)
                    (folder / "status.json").write_text(json.dumps(data), encoding="utf-8")
            except (GLib.Error, ValueError):
                pass
        self.web.evaluate_javascript("JSON.stringify(window.surfacePlayerDiagnostics || null)", -1, None, None, None, complete)
        return True


class Application(Gtk.Application):
    def __init__(self):
        super().__init__(application_id="org.neclyon.SurfacePlayer")

    def do_activate(self):
        window = self.get_active_window()
        if window is None:
            window = Player(self)
        window.present()


Application().run(None)
