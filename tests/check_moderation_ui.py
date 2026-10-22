"""Run directly: python tests/check_moderation_ui.py (Playwright + Chromium).
Local, mocked UI contracts only: no network, accounts, or database are used.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FRONT = ROOT / 'frontend'


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.route('**/*', lambda route: route.abort())
        css = (FRONT / 'css/style.css').read_text().replace('@import url("verification.css");', '')
        css += (FRONT / 'css/verification.css').read_text()
        page.set_content('<html dir="rtl" lang="ar"><body class="dir-rtl"><main class="admin-shell"><button id="trigger">التوثيق</button><div id="admin-content"></div></main></body></html>')
        page.add_style_tag(content=css)
        page.evaluate('''() => {
          window.calls = []; window.toastCalls = []; window.failNext = false;
          window.Api = {
            get: async () => ({items: [], total: 0}),
            put: async (url, body) => { window.calls.push({url, body}); await new Promise(r => setTimeout(r, 100)); if (window.failNext) {window.failNext=false; throw Error('خطأ اختباري');} }
          };
          window.showToast = (...args) => window.toastCalls.push(args);
        }''')
        page.add_script_tag(content=(FRONT / 'js/admin.js').read_text())
        for mode in ['permanent', 'temporary', 'revoke']:
            page.locator('#trigger').focus()
            page.evaluate('openVerificationDialog("42", document.getElementById("trigger"))')
            page.locator(f'input[name="mode"][value="{mode}"]').check()
            assert page.locator('#verification-days-field').is_visible() == (mode == 'temporary')
            page.locator('[name="note"]').fill('مراجعة اختبار محلية')
            if mode == 'temporary':
                page.locator('[name="days"]').fill('7')
            page.locator('.verification-submit').click()
            page.wait_for_selector('#verification-dialog', state='detached')
            last = page.evaluate('window.calls.at(-1)')
            assert last['url'] == '/api/admin/users/42/verification'
            assert last['body']['mode'] == mode
            assert ('days' in last['body']) == (mode == 'temporary')
            if mode == 'temporary':
                assert last['body']['days'] == 7
        page.evaluate('openVerificationDialog("42", document.getElementById("trigger"))')
        page.locator('[name="note"]').fill('   ')
        page.locator('.verification-submit').click()
        assert page.locator('.verification-error').inner_text() == 'ملاحظة التوثيق مطلوبة'
        page.locator('[name="note"]').fill('اختبار إعادة المحاولة')
        page.evaluate('window.failNext = true')
        page.locator('.verification-submit').click()
        page.wait_for_function('document.querySelector(".verification-error").textContent === "خطأ اختباري"')
        assert not page.locator('.verification-submit').is_disabled()
        before = page.evaluate('calls.length')
        page.evaluate('''() => { const f = document.querySelector('.verification-form'); f.requestSubmit(); f.dispatchEvent(new Event('submit', {cancelable:true})); }''')
        page.wait_for_selector('#verification-dialog', state='detached')
        assert page.evaluate('calls.length') == before + 1
        page.locator('#trigger').focus()
        page.evaluate('openVerificationDialog("42", document.getElementById("trigger"))')
        page.keyboard.press('Escape')
        page.wait_for_selector('#verification-dialog', state='detached')
        assert page.locator('#verification-dialog').count() == 0
        assert page.evaluate('document.activeElement.id') == 'trigger'
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({'width': width, 'height': 844})
            for dark in [False, True]:
                page.evaluate('(dark) => document.documentElement.dataset.theme = dark ? "dark" : "light"', dark)
                page.evaluate('openVerificationDialog("42", document.getElementById("trigger"))')
                bounds = page.locator('#verification-dialog').bounding_box()
                assert bounds['width'] <= width and bounds['x'] >= 0
                assert page.evaluate('document.querySelector(".verification-dialog").scrollWidth <= document.querySelector(".verification-dialog").clientWidth')
                page.keyboard.press('Escape')
                page.wait_for_selector('#verification-dialog', state='detached')
        print('VERIFICATION_UI_OK: 3 modes, day payload, required note, retry, duplicate guard, Escape/focus, 4 widths, light/dark')
        page.add_style_tag(content=(FRONT / 'css/report-dialog.css').read_text())
        page.add_script_tag(content=(FRONT / 'js/post-card.js').read_text())
        page.evaluate('''() => {
          window.reports = []; window.optionsFail = false;
          Api.get = async () => { if (window.optionsFail) throw Error('offline'); return {target_types:['user','post','comment','reel','story','message']}; };
          Api.post = async (url, body) => { reports.push({url,body}); await new Promise(r => setTimeout(r,100)); if (failNext) {failNext=false; throw Error('تعذر الإرسال');} };
        }''')
        for target in ['user', 'post', 'comment', 'reel', 'story', 'message']:
            page.locator('#trigger').focus()
            page.evaluate('(target) => openReportModal(target,42)', target)
            assert page.locator('.report-option').count() == 10
            page.locator('.report-option').filter(has=page.locator('input[value="privacy"]')).click()
            page.locator('.report-button-primary').click()
            page.wait_for_selector('#ytrana-report-dialog', state='detached')
            last = page.evaluate('reports.at(-1)')
            assert last['body'] == {'target_type':target,'target_id':42,'category':'privacy','reason':'خصوصية'}
        page.evaluate('openReportModal("post",42)')
        page.locator('.report-reason').fill('ab')
        page.locator('.report-button-primary').click()
        assert page.locator('.report-error').is_visible()
        page.locator('.report-reason').fill('اختبار')
        assert page.locator('.report-counter').inner_text() == '6/500'
        page.evaluate('failNext=true')
        page.locator('.report-button-primary').click()
        page.wait_for_function('document.querySelector(".report-button-primary").textContent === "إعادة المحاولة"')
        assert page.locator('.report-reason').input_value() == 'اختبار'
        before = page.evaluate('reports.length')
        page.evaluate('''() => {const b=document.querySelector('.report-button-primary'); b.click(); b.click();}''')
        page.wait_for_selector('#ytrana-report-dialog', state='detached')
        assert page.evaluate('reports.length') == before + 1
        page.evaluate('optionsFail=true')
        page.locator('#trigger').focus()
        page.evaluate('openReportModal("post",42)')
        assert page.locator('.report-option').count() == 10
        page.keyboard.press('Shift+Tab')
        assert page.locator('.report-button-primary').evaluate('(el) => el === document.activeElement')
        page.keyboard.press('Tab')
        assert page.locator('.report-close').evaluate('(el) => el === document.activeElement')
        page.keyboard.press('Escape')
        assert page.locator('#ytrana-report-dialog').count() == 0
        assert page.evaluate('document.activeElement.id') == 'trigger'
        for width in [320, 390, 768, 1440]:
            page.set_viewport_size({'width':width,'height':700})
            for dark in [False, True]:
                page.evaluate('(dark) => document.documentElement.dataset.theme=dark ? "dark":"light"', dark)
                page.evaluate('openReportModal("post",42)')
                assert page.evaluate('document.querySelector(".report-panel").scrollWidth <= document.querySelector(".report-panel").clientWidth')
                bounds = page.locator('.report-panel').bounding_box()
                assert bounds['x'] >= 0 and bounds['width'] <= width
                page.keyboard.press('Escape')
        page.evaluate('''() => { const story=document.createElement('dialog'); story.id='story'; document.body.append(story); story.showModal(); }''')
        page.evaluate('openReportModal("story",42)')
        assert page.locator('#story #ytrana-report-dialog').count() == 1
        page.keyboard.press('Escape')
        assert page.locator('#story').evaluate('(el) => el.open')
        page.evaluate('document.getElementById("story").close()')
        print('REPORT_UI_OK: 10 categories, 6 targets, fallback, validation/counter, retry/duplicate guard, keyboard focus, story dialog, 4 widths, light/dark')
        browser.close()


if __name__ == '__main__':
    run()
