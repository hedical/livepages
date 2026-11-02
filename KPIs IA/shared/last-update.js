// ============================================================================
// shared/last-update.js — Date de dernière mise à jour des données, sur
// chaque page du dashboard KPIs IA (namespace global KPILastUpdate).
//
// La date affichée est celle des FICHIERS du bucket Supabase, pas celle du
// chargement de la page : chaque réponse d'une URL signée porte l'en-tête
// Last-Modified (heure d'écriture du fichier par n8n), lisible en CORS sans
// réglage côté bucket. Le module enveloppe window.fetch pour le relever, sans
// rien changer aux scripts de page, qui chargent leurs données chacun à leur
// façon.
//
// Chargé en <script> classique dans le <head>, AVANT le script de page (sinon
// les premiers fetch échappent au relevé). Le texte s'ajoute sous le titre h1
// (ou dans l'élément #data-updated-at s'il existe) : la date la plus récente,
// le détail fichier par fichier en infobulle.
// ============================================================================

const KPILastUpdate = (function () {
    'use strict';

    // Relevés de la page : nom de fichier → Date (Last-Modified).
    const records = {};

    // Nom du fichier d'une URL de stockage Supabase (signée ou publique),
    // null pour toute autre URL (webhook n8n, Google Sheet…).
    function storageFileName(url) {
        let u;
        try { u = new URL(url); } catch (e) { return null; }
        if (!/\.supabase\.co$/.test(u.hostname) || u.pathname.indexOf('/storage/v1/object/') === -1) return null;
        return decodeURIComponent(u.pathname.split('/').pop()) || null;
    }

    // Date la plus récente d'une liste de relevés [{ file, date }]. null si vide.
    function latestOf(entries) {
        let best = null;
        (entries || []).forEach(e => {
            if (e && e.date instanceof Date && !isNaN(e.date) && (!best || e.date > best)) best = e.date;
        });
        return best;
    }

    // « 2 novembre 2026 à 06:02 », heure de Paris quel que soit le poste.
    function formatDate(date) {
        return new Date(date).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' });
    }

    function record(file, lastModified) {
        const date = new Date(lastModified);
        if (!file || isNaN(date)) return;
        records[file] = date;
        render();
    }

    // Relevés triés du plus récent au plus ancien.
    function sources() {
        return Object.keys(records)
            .map(file => ({ file, date: records[file] }))
            .sort((a, b) => b.date - a.date);
    }

    function latest() {
        const d = latestOf(sources());
        return d ? d.toISOString() : null;
    }

    // ===================== AFFICHAGE =====================

    function target() {
        let el = document.getElementById('data-updated-at');
        if (el) return el;
        const h1 = document.querySelector('h1');
        if (!h1 || !h1.parentElement) return null;
        el = document.createElement('p');
        el.id = 'data-updated-at';
        el.className = 'text-graphite text-xs mt-1';
        h1.parentElement.appendChild(el);
        return el;
    }

    function render() {
        if (typeof document === 'undefined') return;
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', render, { once: true });
            return;
        }
        const list = sources();
        if (!list.length) return;
        const el = target();
        if (!el) return;
        el.textContent = `Données mises à jour le ${formatDate(latestOf(list))}`;
        el.title = list.map(s => `${s.file} : ${formatDate(s.date)}`).join('\n');
    }

    // ===================== RELEVÉ DES RÉPONSES =====================

    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        const nativeFetch = window.fetch;
        window.fetch = function () {
            return nativeFetch.apply(this, arguments).then(response => {
                try {
                    const file = response.ok ? storageFileName(response.url) : null;
                    const lastModified = file ? response.headers.get('Last-Modified') : null;
                    if (lastModified) record(file, lastModified);
                } catch (e) { /* le relevé ne doit jamais casser un chargement */ }
                return response;
            });
        };
    }

    return {
        storageFileName,
        latestOf,
        formatDate,
        record,
        sources,
        latest,
    };
})();

// Navigateur : namespace global. Node (tests) : module CommonJS.
if (typeof window !== 'undefined') window.KPILastUpdate = KPILastUpdate;
if (typeof module !== 'undefined' && module.exports) module.exports = KPILastUpdate;
