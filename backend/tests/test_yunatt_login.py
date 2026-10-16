"""A submitted login must finish before navigating to attendance records."""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

os.environ["DEBUG"] = "true"
from app.services import yunatt_service as service


class YunattLoginTests(unittest.TestCase):
    def run_fetch(self, accepted=True, password="test-password", navigation_timeout=False,
                  missing_months=False, expired=False, launch_error=None):
        state = {"authenticated": False, "submitted": False, "record_visits": 0, "fills": {}}
        page = MagicMock()
        page.url = "https://global.yunatt.com/login/toLogin"

        def locator(selector):
            element = MagicMock()
            element.first = element
            element.fill.side_effect = lambda value: state["fills"].__setitem__(selector, value)
            element.count.side_effect = lambda: 0 if state["authenticated"] else 1
            element.is_visible.side_effect = lambda: not state["authenticated"]
            element.press.side_effect = lambda key: state.__setitem__("submitted", True)
            return element

        page.locator.side_effect = locator
        button = MagicMock()
        button.first = button
        button.click.side_effect = lambda **kw: state.__setitem__("submitted", True)
        page.get_by_role.return_value = button

        def goto(url, **kw):
            if "/cardRecord/" in url:
                state["record_visits"] += 1
                if expired:
                    state["authenticated"] = False
                page.url = url if state["authenticated"] else "https://global.yunatt.com/login/toLogin"

        def wait_selector(selector, **kw):
            if selector == 'input[type="password"]' and kw.get("state") == "hidden":
                # Model an asynchronous login result; network-idle does not tell
                # the caller whether the login form has accepted credentials.
                if navigation_timeout:
                    state["authenticated"] = True  # no form, but navigation failed
                    raise TimeoutError("navigation timed out")
                state["authenticated"] = accepted and state["submitted"]
                if not state["authenticated"]:
                    raise TimeoutError("login form still visible")
                page.url = "https://global.yunatt.com/index"
            if selector == "#fq-monthDataId option" and (not state["authenticated"] or missing_months):
                raise TimeoutError("month selector missing")

        page.goto.side_effect = goto
        page.wait_for_selector.side_effect = wait_selector
        page.inner_text.return_value = "PRIVATE PAGE CONTENT test-password"
        page.eval_on_selector_all.return_value = [("m1", "2026-10")]
        page.evaluate.return_value = '{"rows": [{"staffNumber":"01", "staffName":"Test", "day-2026-10-16":"08:00<br>17:00"}]}'
        browser = MagicMock()
        browser.new_context.return_value.new_page.return_value = page
        runtime = MagicMock()
        runtime.__enter__.return_value.chromium.launch.return_value = browser
        if launch_error is not None:
            runtime.__enter__.return_value.chromium.launch.side_effect = RuntimeError(launch_error)
        module = types.ModuleType("playwright.sync_api")
        module.sync_playwright = lambda: runtime
        self.page, self.state, self.browser = page, state, browser
        with patch.dict(sys.modules, {"playwright.sync_api": module}), patch.object(
                service.settings, "YUNATT_EMAIL", "test@example.invalid"), patch.object(
                service.settings, "YUNATT_PASSWORD", password):
            return service.fetch_months(["2026-10"])

    def test_waits_until_login_form_disappears_before_opening_attendance(self):
        persons, punches = self.run_fetch()
        self.assertEqual(len(persons), 1)
        self.assertEqual(len(punches), 2)
        self.assertTrue(self.state["authenticated"])
        self.assertEqual(self.state["record_visits"], 1)
        self.browser.close.assert_called_once()

    def test_password_is_sent_exactly_as_configured(self):
        self.run_fetch(password="  significant spaces  ")
        self.assertIn("  significant spaces  ", self.state["fills"].values())

    def test_rejected_login_does_not_open_records_or_expose_page_text(self):
        with self.assertRaises(service.YunattError) as raised:
            self.run_fetch(accepted=False)
        self.assertEqual(self.state["record_visits"], 0)
        self.assertIn("YUNATT_EMAIL", str(raised.exception))
        self.assertNotIn("PRIVATE PAGE CONTENT", str(raised.exception))
        self.browser.close.assert_called_once()

    def test_navigation_timeout_stops_before_opening_records(self):
        with self.assertRaisesRegex(service.YunattError, "chưa hoàn tất"):
            self.run_fetch(navigation_timeout=True)
        self.assertEqual(self.state["record_visits"], 0)
        self.browser.close.assert_called_once()

    def test_missing_months_after_success_is_not_reported_as_bad_password(self):
        with self.assertRaisesRegex(service.YunattError, "chọn tháng") as raised:
            self.run_fetch(missing_months=True)
        self.assertNotIn("PRIVATE PAGE CONTENT", str(raised.exception))

    def test_redirect_to_login_after_success_is_reported_as_lost_session(self):
        with self.assertRaisesRegex(service.YunattError, "phiên đăng nhập"):
            self.run_fetch(expired=True)

    def test_missing_browser_is_actionable_error_instead_of_unhandled_500(self):
        with self.assertRaisesRegex(service.YunattError, "thiếu Chromium") as raised:
            self.run_fetch(launch_error="Executable doesn't exist at /root/.cache/ms-playwright/headless_shell")
        self.assertNotIn("/root/.cache", str(raised.exception))
        self.page.goto.assert_not_called()

    def test_other_launch_failure_is_reported_without_raw_diagnostics(self):
        with self.assertRaisesRegex(service.YunattError, "khởi động.*Chromium") as raised:
            self.run_fetch(launch_error="Host dependencies missing PRIVATE STARTUP DIAGNOSTIC")
        self.assertNotIn("PRIVATE STARTUP DIAGNOSTIC", str(raised.exception))
