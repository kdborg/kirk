// Shared light/dark theme controller. Loaded in <head> before styles so the
// correct theme is set before first paint (no flash). The toggle button and
// icons are driven by CSS reacting to <html data-theme>, so this only manages
// state, persistence, and an event for pages that render to <canvas>.
(function () {
    var KEY = 'theme';
    var root = document.documentElement;

    function systemPrefersDark() {
        return (
            window.matchMedia &&
            window.matchMedia('(prefers-color-scheme: dark)').matches
        );
    }

    function stored() {
        try {
            return localStorage.getItem(KEY);
        } catch (e) {
            return null;
        }
    }

    function resolved() {
        return stored() || (systemPrefersDark() ? 'dark' : 'light');
    }

    function apply(theme) {
        root.setAttribute('data-theme', theme);
        window.dispatchEvent(
            new CustomEvent('themechange', { detail: { theme: theme } })
        );
    }

    // Set as early as possible — runs during <head> parsing.
    apply(resolved());

    function toggle() {
        var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        try {
            localStorage.setItem(KEY, next);
        } catch (e) {}
        apply(next);
    }

    // Delegated so it works no matter when the button is parsed.
    document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('.theme-toggle');
        if (btn) {
            e.preventDefault();
            toggle();
        }
    });

    // Follow the OS only while the user hasn't made an explicit choice.
    if (window.matchMedia) {
        window
            .matchMedia('(prefers-color-scheme: dark)')
            .addEventListener('change', function (e) {
                if (!stored()) apply(e.matches ? 'dark' : 'light');
            });
    }

    // Exposed for canvas pages that want the current theme on init.
    window.SiteTheme = { current: function () { return root.getAttribute('data-theme'); } };
})();
