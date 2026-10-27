// ============================================================================
// shared/analyztech-tailwind.js — Palette Tailwind de la charte AnalyzTech
//
// Chargé juste APRÈS <script src="https://cdn.tailwindcss.com">, sur chaque page.
// Les pages et leurs scripts écrivent des classes Tailwind (bg-blue-600,
// text-green-700, bg-indigo-50…) jusque dans le HTML qu'ils génèrent : plutôt
// que de les réécrire une à une, on redirige ici chaque palette vers les six
// couleurs de la charte (guideline V1.0, « Couleurs ») :
//   Digital White #FFFDF6 · Off White #F8F5EB · Stone Grey #B6B9AD
//   Graphite #595959 · Black #1A1A1A · Compliant Green #BAF266
//
// Règle de sûreté : les nuances 50 à 300 restent CLAIRES et les nuances 500 à
// 950 FONCÉES, quelle que soit la palette. Un « bg-x-50 text-x-700 » reste donc
// toujours lisible. Les badges « bg-x-100 text-x-800 » reçoivent leur style
// inversé (vert sur noir, etc.) dans shared/analyztech-theme.css.
//
// Teintes intermédiaires : Stone Grey et Compliant Green posés en transparence
// sur l'Off White (#EDEAE0, #DADACF, #E9F4CA) — pas de couleur hors charte.
// ============================================================================
(function () {
    const AT = {
        paper: '#FFFDF6', off: '#F8F5EB', stone: '#B6B9AD', graphite: '#595959', ink: '#1A1A1A', green: '#BAF266',
        stone18: '#EDEAE0', stone45: '#DADACF', green25: '#E9F4CA',
    };

    const ramp = (s50, s100) => ({
        50: s50, 100: s100, 200: AT.stone45, 300: AT.stone, 400: AT.graphite,
        500: AT.ink, 600: AT.ink, 700: AT.ink, 800: AT.ink, 900: AT.ink, 950: AT.ink,
    });

    const neutral = {
        50: AT.off, 100: AT.stone18, 200: AT.stone45, 300: AT.stone, 400: AT.graphite,
        500: AT.graphite, 600: AT.graphite, 700: AT.ink, 800: AT.ink, 900: AT.ink, 950: AT.ink,
    };

    // Accent froid (bleus, violets) : fond vert pâle, puis Compliant Green en 100.
    const accent = ramp(AT.green25, AT.green);
    // Verts : fond vert pâle.
    const greens = ramp(AT.green25, AT.green25);
    // Alertes et chauds (rouges, oranges, jaunes) : neutres, le texte porte le sens.
    const warm = ramp(AT.off, AT.stone18);
    // Cyans : gris pierre clair, pour rester distinct des bleus.
    const cyans = ramp(AT.off, AT.stone45);

    window.tailwind = window.tailwind || {};
    window.tailwind.config = {
        theme: {
            extend: {
                fontFamily: { sans: ['"Inter Tight"', '"Helvetica Neue"', 'Arial', 'sans-serif'] },
                colors: {
                    // Jetons de la charte, à employer dans le balisage des pages.
                    paper: AT.paper, off: AT.off, graphite: AT.graphite, ink: AT.ink, compliant: AT.green,
                    stone: AT.stone,
                    white: AT.paper,
                    gray: neutral, slate: neutral, zinc: neutral, neutral: neutral,
                    blue: accent, sky: accent, indigo: accent, violet: accent, purple: accent, fuchsia: accent, pink: accent,
                    green: greens, emerald: greens, teal: greens, lime: greens,
                    red: warm, rose: warm, orange: warm, amber: warm, yellow: warm,
                    cyan: cyans,
                },
            },
        },
    };
})();
