// ============================================================================
// shared/claude.js — Indicateurs Claude (namespace KPIClaude).
//
// Source : claude_kpis.json, calculé par le workflow n8n « KPIs IA — Dépôt
// exports Claude » à chaque export de la console Claude (Analytique) :
//   teams.<groupe|ppi>.historique[] = { date, membres?, skills?, fonctionnalites? }
//   - membres          : export « members-analytics » (fenêtre glissante 30 j)
//   - skills           : export « skills » (fenêtre glissante 30 j)
//   - fonctionnalites  : export « Claude Code usage » (mois civil en cours)
// Une entrée par jour de dépôt ; un export refait le même jour la remplace.
//
// Fonctions PURES, sans DOM : la page claude-ia.js les appelle pour composer
// la vue d'une Team ou des deux réunies (« tous »). Testé par tests/claude.test.js.
//
// Vue « tous » : les sommes sont exactes (sièges, messages, artefacts…), le top
// 20 des utilisateurs aussi (union des deux tops 20). Les skills distincts et
// le top des skills sont des sommes par Team : un même skill utilisé dans les
// deux Teams compte deux fois dans « skills distincts ».
// ============================================================================

const KPIClaude = (function () {
    'use strict';

    const TEAMS = ['groupe', 'ppi'];
    const LABELS = { groupe: 'Team Groupe', ppi: 'Pôle PPI', tous: 'Les deux Teams' };

    // Champs numériques de la section « membres » qui s'additionnent entre Teams.
    const MEMBRES_SUM = [
        'sieges', 'premium', 'actifs_periode', 'actifs_7j', 'reguliers', 'conversations',
        'messages_chat', 'messages_cowork', 'sessions_cowork', 'sessions_code', 'pull_requests',
        'projets_crees', 'artefacts', 'artefacts_cowork', 'artefacts_code', 'artefacts_chat',
        'utilisateurs_cowork', 'utilisateurs_code',
    ];

    const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

    function historique(kpis, team) {
        const t = kpis && kpis.teams && kpis.teams[team];
        return t && Array.isArray(t.historique) ? t.historique : [];
    }

    // Teams présentes dans le fichier, dans l'ordre d'affichage.
    function teamsAvailable(kpis) {
        return TEAMS.filter((t) => historique(kpis, t).length > 0);
    }

    // Les deux dernières entrées d'une Team qui portent la section `key`.
    function lastTwo(kpis, team, key) {
        const h = historique(kpis, team).filter((e) => e && e[key]);
        return { cur: h[h.length - 1] || null, prev: h[h.length - 2] || null };
    }

    function messagesOf(m) {
        return num(m.messages_chat) + num(m.messages_cowork);
    }

    // Somme de deux sections « membres » (ou une seule si l'autre manque).
    function combineMembres(list) {
        const parts = list.filter(Boolean);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const out = { periode: parts[0].periode || null, entites: {}, top_utilisateurs: [] };
        MEMBRES_SUM.forEach((k) => { out[k] = parts.reduce((a, p) => a + num(p[k]), 0); });
        parts.forEach((p) => {
            Object.entries(p.entites || {}).forEach(([nom, e]) => {
                const o = out.entites[nom] || (out.entites[nom] = { sieges: 0, messages: 0, artefacts: 0, jours: 0 });
                o.sieges += num(e.sieges); o.messages += num(e.messages);
                o.artefacts += num(e.artefacts); o.jours += num(e.jours);
            });
            out.top_utilisateurs = out.top_utilisateurs.concat(p.top_utilisateurs || []);
        });
        out.top_utilisateurs.sort((a, b) => num(b.messages) - num(a.messages));
        out.top_utilisateurs = out.top_utilisateurs.slice(0, 20);
        const total = messagesOf(out);
        const top = out.top_utilisateurs.reduce((a, u) => a + num(u.messages), 0);
        out.part_top20 = total ? top / total : 0;
        return out;
    }

    function combineSkills(list) {
        const parts = list.filter(Boolean);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const out = { periode: parts[0].periode || null, skills_distincts: 0, skills_nommes: 0, invocations: 0, invocations_anthropic: 0, top: [] };
        const byName = new Map();
        parts.forEach((p) => {
            ['skills_distincts', 'skills_nommes', 'invocations', 'invocations_anthropic'].forEach((k) => { out[k] += num(p[k]); });
            (p.top || []).forEach((s) => {
                // Les skills privés sans nom ne se fusionnent pas entre Teams.
                const key = s.nom === 'Skill privé (sans nom)' ? s.nom + '#' + byName.size : s.nom;
                const o = byName.get(key) || { nom: s.nom, utilisateurs: 0, invocations: 0, origine: s.origine };
                o.utilisateurs += num(s.utilisateurs); o.invocations += num(s.invocations);
                byName.set(key, o);
            });
        });
        out.top = Array.from(byName.values()).sort((a, b) => b.invocations - a.invocations).slice(0, 15);
        return out;
    }

    function combineFonctionnalites(list) {
        const parts = list.filter(Boolean);
        if (parts.length === 0) return null;
        if (parts.length === 1) return parts[0];
        const out = { periode: parts[0].periode || null, skills_utilises: 0, serveurs_mcp: 0, adoption: [], mcp: [] };
        const fonc = new Map();
        const mcp = new Map();
        parts.forEach((p) => {
            out.skills_utilises += num(p.skills_utilises);
            out.serveurs_mcp = Math.max(out.serveurs_mcp, num(p.serveurs_mcp));
            (p.adoption || []).forEach((a) => {
                const o = fonc.get(a.fonction) || { fonction: a.fonction, utilisateurs: 0, actifs: 0 };
                o.utilisateurs += num(a.utilisateurs); o.actifs += num(a.actifs);
                fonc.set(a.fonction, o);
            });
            (p.mcp || []).forEach((s) => {
                const o = mcp.get(s.nom) || { nom: s.nom, utilisateurs: 0, invocations: 0 };
                o.utilisateurs += num(s.utilisateurs); o.invocations += num(s.invocations);
                mcp.set(s.nom, o);
            });
        });
        out.adoption = Array.from(fonc.values()).map((o) => ({ ...o, part: o.actifs ? o.utilisateurs / o.actifs : 0 }));
        out.mcp = Array.from(mcp.values()).sort((a, b) => b.invocations - a.invocations).slice(0, 8);
        return out;
    }

    const COMBINERS = { membres: combineMembres, skills: combineSkills, fonctionnalites: combineFonctionnalites };

    // Vue d'une section pour 'groupe', 'ppi' ou 'tous' : { cur, prev, dates }.
    // `prev` sert aux évolutions : en « tous », il n'existe que si chaque Team
    // présente a elle-même un relevé précédent.
    function view(kpis, team, key) {
        const teams = team === 'tous' ? teamsAvailable(kpis) : [team];
        const pairs = teams.map((t) => lastTwo(kpis, t, key));
        const cur = COMBINERS[key](pairs.map((p) => p.cur && p.cur[key]));
        const prevOk = pairs.length > 0 && pairs.every((p) => p.prev || !p.cur);
        const prev = prevOk ? COMBINERS[key](pairs.map((p) => p.prev && p.prev[key])) : null;
        const dates = pairs.map((p) => p.cur && p.cur.date).filter(Boolean).sort();
        return { cur, prev, date: dates[dates.length - 1] || null };
    }

    // Série d'un champ de « membres » par date de relevé ; en « tous », somme
    // des Teams aux dates où toutes les Teams présentes ont un relevé.
    function series(kpis, team, field) {
        const teams = team === 'tous' ? teamsAvailable(kpis) : [team];
        const byDate = new Map();
        teams.forEach((t) => {
            historique(kpis, t).forEach((e) => {
                if (!e || !e.membres) return;
                const o = byDate.get(e.date) || { n: 0, v: 0 };
                o.n += 1; o.v += num(e.membres[field]);
                byDate.set(e.date, o);
            });
        });
        return Array.from(byDate.entries())
            .filter(([, o]) => o.n === teams.length)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, o]) => ({ date, value: o.v }));
    }

    // Évolution d'un chiffre : null si pas de relevé précédent.
    function delta(cur, prev) {
        if (typeof cur !== 'number' || typeof prev !== 'number') return null;
        return { abs: cur - prev, pct: prev ? (cur - prev) / prev : null };
    }

    return {
        TEAMS,
        LABELS,
        teamsAvailable,
        combineMembres,
        combineSkills,
        combineFonctionnalites,
        view,
        series,
        delta,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPIClaude = KPIClaude;
if (typeof module !== 'undefined' && module.exports) module.exports = KPIClaude;
