// ============================================================================
// shared/sources.js — Lecture des sources de données du dashboard KPIs IA.
//
// Chargé en <script> classique APRÈS shared/utils.js et AVANT le script de
// page : les fonctions sont globales (parseDescriptifJSON, parseGeotechJSON…),
// comme lorsqu'elles vivaient dans app.js. Partagé par index (app.js) et
// adoption-agences (même lecture des sources = mêmes chiffres).
//
// Ne dépend que de KPI (shared/utils.js) : aucun élément du DOM, aucun filtre
// de page. Les enveloppes n8n ([{data: csv}], {data}, tableau direct) sont
// décodées par decodeTabularPayload.
// ============================================================================

// Vrai si le dataset descriptif contient au moins une ligne avec un type renseigné.
// Recalculé après le chargement des données (voir loadData).
let descriptifTypePresent = false;

// Prédicat : une ligne est un "Descriptif sommaire des travaux".
// Logique centralisée et testée dans shared/utils.js (les lignes au type vide,
// RICT sans génération IA, sont exclues — garde-fou passthrough si query pré-filtrée).
function isDescriptifRow(item) {
    return KPI.isDescriptifItem(item, descriptifTypePresent);
}

// ==================== UTILITY FUNCTIONS ====================

// Extract plain text from HTML string (cf. shared/utils.js)
function extractText(html) {
    return KPI.extractText(html);
}

// Count words in text (only words, not numbers) (cf. shared/utils.js)
function countWords(text) {
    return KPI.countWords(text);
}

/**
 * Helper function to parse a CSV line with quoted values (cf. shared/utils.js)
 */
function parseCSVLine(line) {
    return KPI.parseCSVLine(line);
}

/**
 * Full CSV parser that correctly handles quoted fields containing newlines (cf. shared/utils.js)
 */
function parseFullCSV(csvString) {
    return KPI.parseFullCSV(csvString);
}

/**
 * Extract agency code from contract number
 */
function extractAgency(contractNumber) {
    if (!contractNumber || typeof contractNumber !== 'string') {
        return null;
    }
    
    const match = contractNumber.match(/C-([A-Z0-9]+)-/);
    if (match && match[1]) {
        return match[1];
    }
    
    return null;
}

/**
 * Parses a French date string into a Date object.
 */
function parseFrenchDate(dateString) {
    return KPI.parseFrenchDate(dateString);
}

// ==================== DATA PARSING ====================

/**
 * Parse CSV data for descriptif
 */
function parseDescriptifCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const rows = parseFullCSV(csvString);
    if (rows.length === 0) return [];

    const headers = rows[0];

    // Find column indices
    let typeIndex = -1;
    let contractIndex = -1;
    let diffusedAtIndex = -1;
    let emailIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;
    let descriptionIndex = -1;
    let aiResultIndex = -1;

    // Pass 1: pre-scan for typeIndex with pattern priority
    // (AIDeliverable__type wins over Report__reportType regardless of column order)
    for (let i = 0; i < headers.length && typeIndex === -1; i++) {
        const header = headers[i].toLowerCase();
        if (header.includes('aideliver') && header.includes('type')) { typeIndex = i; }
    }
    if (typeIndex === -1) {
        for (let i = 0; i < headers.length && typeIndex === -1; i++) {
            const header = headers[i].toLowerCase();
            if (header.includes('reporttype') || (header.includes('report') && header.includes('type') && !header.includes('diffusedat'))) {
                typeIndex = i;
            }
        }
    }
    // Pass 2: other columns (no priority conflict, first match wins)
    // Precomputed lean columns scanned BEFORE the generic description/result patterns
    let descWcIndex = -1;
    let aiWcIndex = -1;
    let hasAiIndex = -1;
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) { contractIndex = i; }
        if (diffusedAtIndex === -1 && header.includes('report') && header.includes('diffusedat')) { diffusedAtIndex = i; }
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) { emailIndex = i; }
        if (agencyIndex === -1 && header.includes('productionservice')) { agencyIndex = i; }
        if (managementIndex === -1 && header.includes('management')) { managementIndex = i; }
        if (descWcIndex === -1 && header.includes('description') && header.includes('wordcount')) { descWcIndex = i; }
        if (aiWcIndex === -1 && header.includes('airesult') && header.includes('wordcount')) { aiWcIndex = i; }
        if (hasAiIndex === -1 && header.includes('hasai')) { hasAiIndex = i; }
        if (descriptionIndex === -1 && header.includes('description') && !header.includes('complement') && !header.includes('wordcount')) { descriptionIndex = i; }
        if (aiResultIndex === -1 && ((header.includes('longresult') && !header.includes('indexcomparator')) || (header.includes('result') && !header.includes('wordcount')))) { aiResultIndex = i; }
    }

    if (contractIndex === -1) return [];

    console.log('Descriptif CSV column indices:', { typeIndex, contractIndex, diffusedAtIndex, emailIndex, agencyIndex, managementIndex, descriptionIndex, aiResultIndex, descWcIndex, aiWcIndex, hasAiIndex });

    // Parse data rows
    const data = [];
    for (let i = 1; i < rows.length; i++) {
        const values = rows[i];
        if (values.length < headers.length / 2) continue;

        const type = typeIndex >= 0 ? (values[typeIndex] || '') : '';
        const contractNumber = values[contractIndex] || '';
        const diffusedAt = diffusedAtIndex >= 0 ? values[diffusedAtIndex] : '';
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        const description = descriptionIndex >= 0 ? values[descriptionIndex] : '';
        const aiResult = aiResultIndex >= 0 ? values[aiResultIndex] : '';
        const descWcRaw = descWcIndex >= 0 ? values[descWcIndex] : '';
        const aiWcRaw  = aiWcIndex >= 0 ? values[aiWcIndex] : '';
        const hasAiRaw = hasAiIndex >= 0 ? (values[hasAiIndex] || '').toLowerCase().trim() : '';

        data.push({
            type: (type || '').trim(),
            contractNumber: (contractNumber || '').trim(),
            createdAt: (diffusedAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            description: description,
            aiResult: aiResult,
            descriptionWordCount: (descWcRaw !== '' && !isNaN(parseInt(descWcRaw))) ? parseInt(descWcRaw) : undefined,
            aiResultWordCount:    (aiWcRaw  !== '' && !isNaN(parseInt(aiWcRaw)))  ? parseInt(aiWcRaw)  : undefined,
            hasAi: hasAiRaw === 'true'
        });
    }

    return data;
}

/**
 * Parse CSV data for autocontact
 */
function parseAutocontactCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    
    // Find column indices
    let contractIndex = -1;
    let fromAIIndex = -1;
    let emailIndex = -1;
    let createdAtIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;
    
    for (let i = 0; i < headers.length; i++) {
        const header = headers[i].toLowerCase();
        if (contractIndex === -1 && header.includes('contractnumber')) {
            contractIndex = i;
        }
        if (fromAIIndex === -1 && (header.includes('fromai') || header.includes('from_ai'))) {
            fromAIIndex = i;
        }
        // Look for BTP user email column (same logic as autocontact.js)
        if (emailIndex === -1 && header.includes('user') && header.includes('email')) {
            emailIndex = i;
        }
        if (createdAtIndex === -1 && (header.includes('createdat') || header.includes('created_at'))) {
            createdAtIndex = i;
        }
        if (agencyIndex === -1 && header.includes('productionservice')) {
            agencyIndex = i;
        }
        if (managementIndex === -1 && header.includes('management')) {
            managementIndex = i;
        }
    }
    
    if (contractIndex === -1) {
        return [];
    }
    
    // If email column not found in headers, search in data rows
    if (emailIndex === -1) {
        for (let rowIdx = 1; rowIdx < Math.min(10, lines.length); rowIdx++) {
            const values = parseCSVLine(lines[rowIdx]);
            for (let colIdx = 0; colIdx < values.length; colIdx++) {
                const val = values[colIdx];
                if (val && val.includes('@btp-consultants.fr')) {
                    emailIndex = colIdx;
                    console.log('Found BTP email column at index', colIdx, 'by examining data');
                    break;
                }
            }
            if (emailIndex !== -1) break;
        }
    }
    
    console.log('Autocontact CSV parsing - Column indices:', {
        contract: contractIndex,
        fromAI: fromAIIndex,
        email: emailIndex,
        createdAt: createdAtIndex,
        agency: agencyIndex,
        management: managementIndex
    });
    
    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;
        
        const contractNumber = values[contractIndex] || '';
        const fromAI = fromAIIndex >= 0 ? (values[fromAIIndex] || '').toLowerCase() === 'true' : false;
        const email = emailIndex >= 0 ? values[emailIndex] : '';
        const createdAt = createdAtIndex >= 0 ? values[createdAtIndex] : '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';
        
        data.push({
            contractNumber: (contractNumber || '').trim(),
            fromAI: fromAI,
            email: (email || '').trim(),
            createdAt: (createdAt || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim()
        });
    }
    
    return data;
}

/**
 * Parse LongResult JSON to extract max page number
 */
function extractMaxPage(longResultString) {
    if (!longResultString || typeof longResultString !== 'string') {
        return 0;
    }
    
    try {
        // Parse the JSON (now properly unescaped by parseCSVLine)
        const longResult = JSON.parse(longResultString);
        
        if (longResult && longResult.indexComparator && longResult.indexComparator.items) {
            const items = longResult.indexComparator.items;
            let maxPage = 0;
            
            // Iterate through all items and find the maximum page value
            items.forEach(item => {
                if (item.page !== undefined && item.page !== null) {
                    const pageNum = typeof item.page === 'number' ? item.page : parseInt(item.page);
                    if (!isNaN(pageNum)) {
                        maxPage = Math.max(maxPage, pageNum);
                    }
                }
            });
            
            return maxPage;
        }
    } catch (e) {
        console.error('Failed to parse LongResult JSON:', e.message);
    }
    
    return 0;
}

/**
 * Helper: find an object-key matching one of several patterns.
 * Each pattern is an array of substrings that must ALL be present (lowercase).
 * Substrings prefixed with '!' must be ABSENT.
 * Patterns are tried in order — pattern priority beats key order, so a more
 * specific pattern listed first wins even if a less specific one would also
 * match a key earlier in the object.
 */
function findKey(keys, ...patterns) {
    return KPI.findKey(keys, ...patterns);
}

/**
 * Parse new direct JSON array format for descriptif (from Metabase JSON download).
 * Output shape mirrors parseDescriptifCSV().
 */
function parseDescriptifJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) return [];

    const keys = Object.keys(jsonArray[0] || {});
    const kType        = findKey(keys, ['aideliver', 'type'], ['reporttype'], ['report', 'type', '!diffusedat']);
    const kContract    = findKey(keys, ['contractnumber']);
    const kDiffusedAt  = findKey(keys, ['report', 'diffusedat']);
    const kEmail       = findKey(keys, ['user', 'email']);
    const kAgency      = findKey(keys, ['productionservice']);
    const kManagement  = findKey(keys, ['management']);
    // Precomputed (lean format) — must be checked BEFORE the HTML "description" pattern
    const kDescWC      = findKey(keys, ['description', 'wordcount']);
    const kAiWC        = findKey(keys, ['airesult', 'wordcount']);
    const kHasAi       = findKey(keys, ['hasai']);
    const kDescription = findKey(keys, ['description', '!complement', '!wordcount']);
    const kAiResult    = findKey(keys, ['longresult', 'description'], ['longresult'], ['airesult', '!wordcount'], ['result', '!wordcount']);

    console.log('Descriptif JSON keys map:', { kType, kContract, kDiffusedAt, kEmail, kAgency, kManagement, kDescWC, kAiWC, kHasAi, kDescription, kAiResult });

    if (!kContract) return [];

    return jsonArray.map(item => {
        const hasAiVal = kHasAi ? item[kHasAi] : null;
        return {
            type:                  ((kType && item[kType]) || '').toString().trim(),
            contractNumber:        ((kContract && item[kContract]) || '').toString().trim(),
            createdAt:             ((kDiffusedAt && item[kDiffusedAt]) || '').toString().trim(),
            email:                 ((kEmail && item[kEmail]) || '').toString().trim(),
            agency:                ((kAgency && item[kAgency]) || '').toString().trim(),
            direction:             ((kManagement && item[kManagement]) || '').toString().trim(),
            description:           (kDescription && item[kDescription]) || '',
            aiResult:              (kAiResult && item[kAiResult]) || '',
            descriptionWordCount:  (kDescWC && typeof item[kDescWC] === 'number') ? item[kDescWC] : (kDescWC && item[kDescWC] != null ? parseInt(item[kDescWC]) : undefined),
            aiResultWordCount:     (kAiWC && typeof item[kAiWC] === 'number') ? item[kAiWC] : (kAiWC && item[kAiWC] != null ? parseInt(item[kAiWC]) : undefined),
            hasAi:                 hasAiVal === true || hasAiVal === 'true' || hasAiVal === 'TRUE'
        };
    });
}

/**
 * Parse new direct JSON array format for autocontact (from Metabase JSON download).
 * Output shape mirrors parseAutocontactCSV().
 */
function parseAutocontactJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) return [];

    const keys = Object.keys(jsonArray[0] || {});
    const kContract   = findKey(keys, ['contractnumber']);
    const kFromAI     = findKey(keys, ['fromai'], ['from_ai']);
    const kEmail      = findKey(keys, ['user', 'email']);
    const kCreatedAt  = findKey(keys, ['contact', 'createdat'], ['createdat'], ['created_at']);
    const kAgency     = findKey(keys, ['productionservice']);
    const kManagement = findKey(keys, ['management']);

    console.log('Autocontact JSON keys map:', { kContract, kFromAI, kEmail, kCreatedAt, kAgency, kManagement });

    if (!kContract) return [];

    return jsonArray.map(item => {
        const fromAIVal = kFromAI ? item[kFromAI] : null;
        const fromAI = fromAIVal === true || fromAIVal === 'true' || fromAIVal === 'TRUE';
        return {
            contractNumber: ((kContract && item[kContract]) || '').toString().trim(),
            fromAI: fromAI,
            email:          ((kEmail && item[kEmail]) || '').toString().trim(),
            createdAt:      ((kCreatedAt && item[kCreatedAt]) || '').toString().trim(),
            agency:         ((kAgency && item[kAgency]) || '').toString().trim(),
            direction:      ((kManagement && item[kManagement]) || '').toString().trim()
        };
    });
}

/**
 * Parse new direct JSON array format for comparateur
 */
function parseComparateurJSON(jsonArray) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        console.warn('Invalid or empty JSON array for comparateur');
        return [];
    }

    console.log('Parsing comparateur from direct JSON array, rows:', jsonArray.length);
    const data = [];

    jsonArray.forEach((item) => {
        const contractNumber = (item['ContractNumber'] || '').trim();
        const createdAt = (item['AIDeliverable → CreatedAt'] || '').trim();
        const email = (item['User - UserId → Email'] || '').trim();
        const agency = (item['Agency - AgencyId → ProductionService'] || '').trim();
        const direction = (item['Agency - AgencyId → Management'] || '').trim();

        let maxPage = 0;
        const itemsStr = item['LongResult → IndexComparator → Items'];
        if (itemsStr && typeof itemsStr === 'string') {
            try {
                const items = JSON.parse(itemsStr);
                if (Array.isArray(items)) {
                    items.forEach(it => {
                        if (it.page !== undefined && it.page !== null) {
                            const pageNum = typeof it.page === 'number' ? it.page : parseInt(it.page);
                            if (!isNaN(pageNum)) maxPage = Math.max(maxPage, pageNum);
                        }
                    });
                }
            } catch (e) {
                console.warn('Failed to parse IndexComparator Items:', e.message);
            }
        }
        if (maxPage === 0) {
            maxPage = extractMaxPage(item['AIDeliverable → LongResult'] || '');
        }

        data.push({
            contractNumber,
            createdAt,
            email,
            agency,
            direction,
            maxPage
        });
    });

    console.log('Parsed', data.length, 'comparateur rows from direct JSON');
    return data;
}

/**
 * Parse direct JSON array from Metabase card 139 (Analyse Géotechnique).
 * One row per AnalyticEvent (Notice or Report). Front-end dedupes operations via DeliverableId.
 */
function parseAnalyticEventsJSON(jsonArray, noticeRe, reportRe, label, keepRe) {
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
        return [];
    }
    const data = [];
    jsonArray.forEach(item => {
        const eventName = (item['EventName'] || '').trim();
        const isNotice = noticeRe.test(eventName);
        const isReport = reportRe.test(eventName);
        // keepRe (optionnel) : garde aussi les lignes "génération" qui ne sont
        // ni Notice ni Report (ex. AIDeliverable type ETUDE_ACOUSTIQUE).
        if (!isNotice && !isReport && !(keepRe && keepRe.test(eventName))) return;
        const contractNumber = (item['ContractNumber'] || '').trim();
        let agencyCode = null;
        const m = contractNumber.match(/C-([A-Z0-9]+)-/);
        if (m) agencyCode = m[1];
        data.push({
            eventName,
            isNotice,
            isReport,
            createdAt: (item['EventDate'] || '').trim(),
            deliverableId: (item['DeliverableId'] || '').trim(),
            reportId: (item['ReportId'] || '').trim(),
            noticesCount: parseInt(item['NoticesCount']) || 0,
            // Card 158 : nb de rapports créés depuis le livrable (events Create Report).
            reportsCount: parseInt(item['ReportsCount']) || 0,
            contractNumber,
            agencyCode,
            email: (item['UserEmail'] || '').trim(),
            agency: (item['Agence'] || '').trim(),
            direction: (item['DR'] || '').trim(),
        });
    });
    console.log('Parsed', data.length, label, 'events from direct JSON');
    return data;
}

function parseGeotechJSON(jsonArray) {
    return parseAnalyticEventsJSON(jsonArray,
        /^Create Notice From AI Geotech$/i, /^Create Report From AI Geotech$/i, 'geotech');
}

// Acoustique : source AIDeliverable type ETUDE_ACOUSTIQUE (card 158) — chaque
// ligne est une génération IA (pas d'events frontend Notice/Report comme la
// géotech). Les préfixes Create sont conservés au cas où AnalyzTech
// instrumenterait un jour le tracking.
function parseAcoustiqueJSON(jsonArray) {
    return parseAnalyticEventsJSON(jsonArray,
        /^Create Notice From AI Acousti/i, /^Create Report From AI Acousti/i, 'acoustique',
        /ACOUSTI/i);
}

/**
 * Parse AnalyticEvents CSV envelope (n8n format: [{ data: "csv..." }]).
 * The CSV is simple — no commas in fields — so we split on comma directly.
 */
function parseAnalyticEventsCSV(csvString, jsonParser) {
    if (!csvString || typeof csvString !== 'string') return [];
    const lines = csvString.split('\n').filter(l => l.trim() !== '');
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        if (parts.length < header.length) continue;
        const row = {};
        header.forEach((key, idx) => {
            row[key] = (parts[idx] ?? '').trim();
        });
        rows.push(row);
    }
    return jsonParser(rows);
}

function parseGeotechCSV(csvString) {
    return parseAnalyticEventsCSV(csvString, parseGeotechJSON);
}

function parseAcoustiqueCSV(csvString) {
    return parseAnalyticEventsCSV(csvString, parseAcoustiqueJSON);
}

/**
 * Parse XPL Funnel API payload {count, data:[{marcheId, refMarche, typeAvis, dateDetection, leads:[...]}]}.
 * Returns an array of marchés (each with its leads).
 */
function parseAOPayload(payload) {
    if (!payload || !Array.isArray(payload.data)) {
        console.warn('Invalid AO payload — expected {count, data:[]}');
        return [];
    }
    return payload.data
        // Floor de mise en place : ignorer les marchés détectés avant le go-live.
        // (Les marchés sans date de détection valide sont conservés.)
        .filter(m => KPI.isAfterAOStart(m.dateDetection))
        .map(m => ({
            marcheId: m.marcheId || '',
            refMarche: m.refMarche || '',
            typeAvis: m.typeAvis || '',
            dateDetection: m.dateDetection || '',
            leads: Array.isArray(m.leads) ? m.leads : [],
        }));
}


/**
 * Parse CSV data for comparateur
 */
function parseComparateurCSV(csvString) {
    if (!csvString || typeof csvString !== 'string') {
        return [];
    }
    
    csvString = csvString.trim();
    while (csvString.startsWith('[') || csvString.startsWith('{')) {
        csvString = csvString.substring(1).trim();
    }
    while (csvString.endsWith(']') || csvString.endsWith('}')) {
        csvString = csvString.substring(0, csvString.length - 1).trim();
    }
    
    const lines = csvString.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 0) return [];
    
    const headers = parseCSVLine(lines[0]);
    
    // Find column indices
    let contractIndex = -1;
    let createdAtIndex = -1;
    let emailIndex = -1;
    let longResultIndex = -1;
    let indexComparatorItemsIndex = -1;
    let agencyIndex = -1;
    let managementIndex = -1;

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        const headerLower = header.toLowerCase();

        if (contractIndex === -1 && (headerLower.includes('contractnumber') || header.includes('SubAffairDetailId'))) {
            contractIndex = i;
        }
        // CreatedAt — supports "CreatedAt" and "AIDeliverable → CreatedAt"
        if (createdAtIndex === -1 && headerLower.includes('createdat')) {
            createdAtIndex = i;
        }
        if (emailIndex === -1 && header.includes('User') && header.includes('Email')) {
            emailIndex = i;
        }
        // LongResult → IndexComparator → Items (direct JSON array — higher priority for pages)
        if (indexComparatorItemsIndex === -1 && headerLower.includes('indexcomparator') && headerLower.includes('items')) {
            indexComparatorItemsIndex = i;
        }
        // LongResult — supports "LongResult" and "AIDeliverable → LongResult"
        if (longResultIndex === -1 && headerLower.includes('longresult') && !headerLower.includes('indexcomparator')) {
            longResultIndex = i;
        }
        if (agencyIndex === -1 && headerLower.includes('productionservice')) {
            agencyIndex = i;
        }
        if (managementIndex === -1 && headerLower.includes('management')) {
            managementIndex = i;
        }
    }

    if (contractIndex === -1 || (longResultIndex === -1 && indexComparatorItemsIndex === -1)) {
        return [];
    }

    // Parse data rows
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        if (values.length < headers.length / 2) continue;

        const contractNumber = values[contractIndex] || '';
        const createdAt = (createdAtIndex >= 0 ? values[createdAtIndex] : '') || '';
        const email = (emailIndex >= 0 ? values[emailIndex] : '') || '';
        const longResult = (longResultIndex >= 0 ? values[longResultIndex] : '') || '';
        const agency = (agencyIndex >= 0 ? values[agencyIndex] : '') || '';
        const direction = (managementIndex >= 0 ? values[managementIndex] : '') || '';

        // Extract max page: try IndexComparator Items (flat array) first, then LongResult JSON
        let maxPage = 0;
        if (indexComparatorItemsIndex >= 0 && values[indexComparatorItemsIndex]) {
            try {
                const items = JSON.parse(values[indexComparatorItemsIndex]);
                if (Array.isArray(items)) {
                    items.forEach(it => {
                        if (it.page !== undefined && it.page !== null) {
                            const p = typeof it.page === 'number' ? it.page : parseInt(it.page);
                            if (!isNaN(p)) maxPage = Math.max(maxPage, p);
                        }
                    });
                }
            } catch (e) {
                console.warn('Failed to parse IndexComparator Items in CSV row:', e.message);
            }
        }
        if (maxPage === 0) {
            maxPage = extractMaxPage(longResult);
        }

        data.push({
            contractNumber: (contractNumber || '').trim(),
            createdAt: (createdAt || '').trim(),
            email: (email || '').trim(),
            agency: (agency || '').trim(),
            direction: (direction || '').trim(),
            maxPage: maxPage
        });
    }
    
    return data;
}

/**
 * Fix encoding issues in CSV text
 */
function fixEncoding(text) {
    const replacements = {
        'Ã©': 'é',
        'Ã¨': 'è',
        'Ãª': 'ê',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ã´': 'ô',
        'Ã»': 'û',
        'Ã§': 'ç',
        'Ã«': 'ë',
        'Ã¯': 'ï',
        'Ã¼': 'ü',
        'Ã': 'É',
        'Ã': 'È',
        'Ã': 'À',
        'Ã': 'Ç',
        '�': 'é'
    };
    
    let fixed = text;
    for (const [bad, good] of Object.entries(replacements)) {
        fixed = fixed.replace(new RegExp(bad, 'g'), good);
    }
    return fixed;
}

/**
 * Parse Population Data CSV (using same logic as descriptif.js)
 * Format: DR;Agence;Effectif
 */
// Helper function to parse CSV line with quoted values (cf. shared/utils.js)
function parseCSVLineWithCommas(line) {
    return KPI.parseCSVLine(line);
}

// Extract CSV content from "data" field if present
function extractCSVFromDataField(csvText) {
    // Check if first line is "data"
    const lines = csvText.split('\n');
    if (lines.length > 0 && lines[0].trim() === 'data') {
        // Extract everything after "data" line
        const csvLines = lines.slice(1);
        
        // Remove leading quote from first line if present
        if (csvLines.length > 0 && csvLines[0].startsWith('"')) {
            csvLines[0] = csvLines[0].substring(1);
        }
        
        // Remove trailing quote from last line if present
        if (csvLines.length > 0 && csvLines[csvLines.length - 1].trim() === '"') {
            csvLines.pop(); // Remove the line that is just a quote
        } else if (csvLines.length > 0 && csvLines[csvLines.length - 1].endsWith('"')) {
            csvLines[csvLines.length - 1] = csvLines[csvLines.length - 1].slice(0, -1);
        }
        
        return csvLines.join('\n').trim();
    }
    return csvText;
}

/**
 * NF Habitat filter: controlName contains "NF" AND "Habitat" (case-insensitive), status === "COMPLETED"
 */
function isNFHabitatItem(item) {
    const name = (item.controlName || '').toLowerCase();
    return name.includes('nf') && name.includes('habitat') && item.status === 'COMPLETED';
}

// ==================== ENVELOPPES ET CHATS ====================

/**
 * Décode un fichier tabulaire déposé par n8n, quelle que soit son enveloppe :
 * CSV brut, [{data: "<csv ou json>"}], {data: "<csv ou json>"} ou tableau JSON
 * direct (export Metabase). Même logique que les branches géotech / acoustique
 * de loadData (app.js).
 */
function decodeTabularPayload(raw, jsonParser, csvParser) {
    if (!raw || typeof raw !== 'string') return [];
    let payload = null;
    try { payload = JSON.parse(raw); } catch (_) { /* CSV brut */ }
    const inner = text => {
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* CSV */ }
        return Array.isArray(json) ? jsonParser(json) : csvParser(text);
    };
    if (payload === null) return csvParser(raw);
    if (Array.isArray(payload) && payload.length && payload[0] && typeof payload[0].data === 'string') return inner(payload[0].data);
    if (payload && !Array.isArray(payload) && typeof payload.data === 'string') return inner(payload.data);
    if (Array.isArray(payload)) return jsonParser(payload);
    return [];
}

/**
 * Sessions chat / expert (API AnalyzTech) → items du dashboard. Même forme que
 * les branches Expert / Chat de loadData (app.js) : l'agence est le service de
 * production porté par les métadonnées de la session.
 */
function parseChatSessions(jsonArray, agencyToDirection) {
    if (!Array.isArray(jsonArray)) return [];
    const toDirection = agencyToDirection || {};
    return jsonArray.map(item => {
        const metadata = item.metadata || {};
        const productionService = metadata.productionService || '';
        const management = metadata.management ? fixEncoding(metadata.management) : '';
        return {
            id: item.id,
            title: item.title || '',
            email: KPI.chatEmail(item),
            createdAt: item.createdAt || '',
            updatedAt: item.updatedAt || '',
            messagesLength: item.messagesLength || (item._count && item._count.messages) || 0,
            agency: productionService,
            agencyCode: productionService,
            direction: management || toDirection[productionService] || '',
            metadata,
        };
    });
}

/**
 * Population cible (DR, agence, effectif) → [{dr, agencyCode, effectif}], sans
 * effet de bord. Accepte le tableau JSON Metabase ([{DR, Agence, Effectif}]),
 * le CSV à virgules ou à points-virgules, et les enveloppes n8n [{data: csv}]
 * et « data » (ligne `data` puis CSV entre guillemets, format du bucket).
 */
function parsePopulationRows(raw) {
    const rows = [];
    const push = (dr, agency, effectif) => {
        const agencyCode = String(agency || '').trim().toUpperCase();
        const n = parseInt(effectif, 10);
        if (agencyCode && !isNaN(n)) rows.push({ dr: String(dr || '').trim(), agencyCode, effectif: n });
    };
    const fromJson = arr => {
        if (!arr.length || typeof arr[0] !== 'object') return [];
        const keys = Object.keys(arr[0]);
        const kDR  = keys.find(k => k.toLowerCase() === 'dr' || k.toLowerCase().includes('management'));
        const kAg  = keys.find(k => k.toLowerCase() === 'agence' || k.toLowerCase().includes('productionservice'));
        const kEff = keys.find(k => k.toLowerCase() === 'effectif' || k.toLowerCase() === 'count');
        arr.forEach(r => push(r[kDR], r[kAg], r[kEff]));
        return rows;
    };
    const fromCsv = text => {
        // Export n8n « data » : première ligne `data`, puis le CSV entre guillemets.
        const clean = extractCSVFromDataField(fixEncoding(text)).trim();
        const firstLine = clean.split(/\r?\n/)[0] || '';
        const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
        KPI.parseFullCSV(clean, sep).slice(1).forEach(cols => { if (cols.length >= 3) push(cols[0], cols[1], cols[2]); });
        return rows;
    };
    return decodeTabularPayload(raw, fromJson, fromCsv);
}
