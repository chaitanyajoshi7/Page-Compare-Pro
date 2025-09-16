// content_script.js - Fixed Toggle + Sorted Results with Indicators
(() => {
    // Prevent multiple executions
    if (window.PCE_DATA) return;

    /*** ===========================
     * GLOBAL STATE & CONFIG
     * =========================== */
    window.PCE_DATA = {
        diffCounter: 0,
        sourceTextSet: new Set(),
        sourceLinksHref: new Map(),
        sourceLinksText: new Map(),
        sourceImages: new Set(),
        COLORS: {
            HEADING: '#FFC300',
            PARAGRAPH: '#FFFAA0',
            CTA_TEXT: '#DA70D6',
            LINK: '#FF4136',
            IMAGE: '#82CA9D',
            GENERAL_TEXT: '#E0E0E0',
            REMOVED: '#B0C4DE'
        },
        ICONS: {
            HEADING: '✏️',
            PARAGRAPH: '📄',
            CTA_TEXT: '💬',
            MODIFIED_LINK: '↔️',
            NEW_LINK: '✨',
            IMAGE: '🖼️',
            GENERAL_TEXT: '📝',
            REMOVED: '❌'
        },
        PRIORITIES: {
            'Heading Change': 1,
            'New Link': 2,
            'Paragraph Change': 3,
            'General Text Change': 4,
            'Removed Text': 5,
            'Removed Link': 6,
            'Modified Link': 7,
            'CTA Text Change': 8,
            'Image Change': 9
        },
        LEGEND_SORT_ORDER: {
            'HEADING': 1,
            'LINK': 2,
            'MODIFIED_LINK': 2,
            'NEW_LINK': 2,
            'CTA_TEXT': 3,
            'PARAGRAPH': 4,
            'IMAGE': 5,
            'GENERAL_TEXT': 6,
            'REMOVED': 7
        }
    };

    const $ = (id) => document.getElementById(id);

    /*** ===========================
     * MESSAGE LISTENER
     * =========================== */
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.from === "popup" && request.sourceHtml) {
            clearPreviousComparison();
            const parser = new DOMParser();
            const sourceDoc = parser.parseFromString(request.sourceHtml, "text/html");
            comparePages(sourceDoc, document);
            sendResponse({ status: "Comparison initiated" });
        }
        return true;
    });

    /*** ===========================
     * MAIN COMPARISON FUNCTION
     * =========================== */
    function comparePages(sourceDoc, currentDoc) {
        injectUI();
        makeTableSortable($('pce-summary-table'));

        cacheSourceData(sourceDoc);

        // Detect new/changed text
        getTextNodes(currentDoc.body).forEach(node => {
            const text = normalizeText(node.nodeValue);
            if (!window.PCE_DATA.sourceTextSet.has(text)) {
                const parentTag = node.parentElement.tagName.toUpperCase();
                if (/^H[1-6]$/.test(parentTag)) {
                    processDifference(node.parentElement, 'Heading Change', `Text changed in <${parentTag}>`, 'HEADING');
                } else if (parentTag === 'P') {
                    processDifference(node.parentElement, 'Paragraph Change', 'Text changed in <p>', 'PARAGRAPH');
                } else if (!(node.parentElement.closest('a') || node.parentElement.closest('button'))) {
                    processDifference(node.parentElement, 'General Text Change', `Text changed in <${parentTag}>`, 'GENERAL_TEXT');
                }
            }
        });

        // Detect link changes/new links
        Array.from(currentDoc.getElementsByTagName('a')).forEach(link => handleLinkComparison(link, currentDoc));

        // Detect image changes
        Array.from(currentDoc.getElementsByTagName('img')).forEach(img => handleImageComparison(img));

        // Detect removed content (text & links)
        detectRemovedContent(currentDoc);

        // Update UI count and sort results
        updateDiffCount();
        sortResultsByPriority();
    }

    /*** ===========================
     * DATA CACHING
     * =========================== */
    function cacheSourceData(sourceDoc) {
        // Cache text
        getTextNodes(sourceDoc.body).forEach(node => {
            window.PCE_DATA.sourceTextSet.add(normalizeText(node.nodeValue));
        });

        // Cache links
        Array.from(sourceDoc.getElementsByTagName('a')).forEach(a => {
            const href = getAbsoluteUrl(sourceDoc, a.href);
            const text = normalizeText(a.innerText);
            window.PCE_DATA.sourceLinksHref.set(href, { href, text });
            if (text) window.PCE_DATA.sourceLinksText.set(text, { href, text });
        });

        // Cache images
        window.PCE_DATA.sourceImages = getAllImageFileNames(sourceDoc);
    }

    /*** ===========================
     * COMPARISON HELPERS
     * =========================== */
    function handleLinkComparison(link, currentDoc) {
        const href = getAbsoluteUrl(currentDoc, link.href);
        const text = normalizeText(link.innerText);

        if (window.PCE_DATA.sourceLinksHref.has(href) && window.PCE_DATA.sourceLinksHref.get(href).text === text) return;

        if (window.PCE_DATA.sourceLinksHref.has(href)) {
            processDifference(link, 'CTA Text Change', `Link text changed from "${window.PCE_DATA.sourceLinksHref.get(href).text}"`, 'CTA_TEXT');
        } else if (window.PCE_DATA.sourceLinksText.has(text)) {
            processDifference(link, 'Modified Link', `URL changed from: ${window.PCE_DATA.sourceLinksText.get(text).href}`, 'MODIFIED_LINK');
        } else {
            processDifference(link, 'New Link', `URL: ${link.href}`, 'NEW_LINK');
        }
    }

    function handleImageComparison(img) {
        const names = new Set([getFinalImageName(img.src), ...parseSrcsetForFileNames(img.srcset)].filter(Boolean));
        if (![...names].some(name => window.PCE_DATA.sourceImages.has(name))) {
            processDifference(img, 'Image Change', `Filename: ${[...names][0] || 'N/A'}`, 'IMAGE');
        }
    }

    function detectRemovedContent(currentDoc) {
        // Removed text
        window.PCE_DATA.sourceTextSet.forEach(text => {
            if (!Array.from(getTextNodes(currentDoc.body)).some(n => normalizeText(n.nodeValue) === text)) {
                processDifference(null, 'Removed Text', `Text removed: "${text}"`, 'REMOVED');
            }
        });

        // Removed links
        window.PCE_DATA.sourceLinksHref.forEach(({ href }) => {
            if (![...currentDoc.getElementsByTagName('a')].some(a => getAbsoluteUrl(currentDoc, a.href) === href)) {
                processDifference(null, 'Removed Link', `URL removed: ${href}`, 'REMOVED');
            }
        });
    }

    /*** ===========================
     * DIFF HANDLING
     * =========================== */
    function processDifference(element, type, details, diffType) {
        window.PCE_DATA.diffCounter++;
        const id = `pce-element-${window.PCE_DATA.diffCounter}`;

        if (element) {
            element.id = id;
            element.setAttribute('data-pce-marked', 'true');
            element.style.cursor = 'pointer';
            styleElementForDiff(element, diffType);
            element.addEventListener('click', e => handleElementClick(e, id));
        }

        addDifferenceToSummaryList(id, type, details, diffType);
    }

    function styleElementForDiff(element, diffType) {
        if (['HEADING', 'PARAGRAPH', 'GENERAL_TEXT', 'CTA_TEXT'].includes(diffType)) {
            element.style.backgroundColor = window.PCE_DATA.COLORS[diffType];
        } else if (['LINK', 'MODIFIED_LINK', 'NEW_LINK'].includes(diffType)) {
            element.style.border = `3px solid ${window.PCE_DATA.COLORS.LINK}`;
            element.style.padding = '2px';
        } else if (diffType === 'IMAGE') {
            const marker = document.createElement('span');
            marker.className = 'pce-marker';
            marker.innerHTML = `<span class="pce-marker-dot pce-flash" style="background-color:${window.PCE_DATA.COLORS.IMAGE};"></span>`;
            element.insertAdjacentElement('afterend', marker);
            marker.addEventListener('click', e => handleElementClick(e, element.id));
        }
    }

    function handleElementClick(e, id) {
        e.preventDefault();
        e.stopPropagation();
        // Show element in summary panel
        const row = document.querySelector(`tr[data-element-id="${id}"]`);
        if (row) {
            const tableContainer = $('pce-table-container');
            if (tableContainer) {
                // Scroll the row into view within the table container
                const containerRect = tableContainer.getBoundingClientRect();
                const rowRect = row.getBoundingClientRect();
                
                if (rowRect.top < containerRect.top || rowRect.bottom > containerRect.bottom) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
            
            // Highlight the row
            const originalBg = row.style.backgroundColor;
            row.style.backgroundColor = '#ffeb3b';
            setTimeout(() => {
                row.style.backgroundColor = originalBg;
            }, 1500);
        }
    }

    /*** ===========================
     * UI FUNCTIONS
     * =========================== */
    function injectUI() {
        const container = document.createElement('div');
        container.id = 'pce-ui-container';
        container.innerHTML = `
            <div id="pce-summary-panel" class="pce-collapsed">
                <div id="pce-header">
                    <h3 id="pce-title">Page Differences (<span id="pce-summary-count">0</span>)</h3>
                    <div id="pce-controls">
                        <input type="text" id="pce-search" placeholder="Search changes..." />
                        <button id="pce-toggle-btn" type="button" title="Toggle Panel">−</button>
                    </div>
                </div>
                <div id="pce-summary-content">
                    <div id="pce-legend">
                        <div class="pce-legend-item pce-clickable-legend" data-filter="HEADING" title="Click to show only heading changes">
                            <span class="pce-legend-color" style="background: #FFC300;"></span>
                            ✏️ Headings
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="LINK" title="Click to show only link changes">
                            <span class="pce-legend-color" style="background: #FF4136;"></span>
                            🔗 Links
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="CTA_TEXT" title="Click to show only CTA text changes">
                            <span class="pce-legend-color" style="background: #DA70D6;"></span>
                            💬 CTA Text
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="PARAGRAPH" title="Click to show only paragraph changes">
                            <span class="pce-legend-color" style="background: #FFFAA0;"></span>
                            📄 Paragraphs
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="IMAGE" title="Click to show only image changes">
                            <span class="pce-legend-color" style="background: #82CA9D;"></span>
                            🖼️ Images
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="GENERAL_TEXT" title="Click to show only general text changes">
                            <span class="pce-legend-color" style="background: #E0E0E0;"></span>
                            📝 Text
                        </div>
                        <div class="pce-legend-item pce-clickable-legend" data-filter="REMOVED" title="Click to show only removed content">
                            <span class="pce-legend-color" style="background: #B0C4DE;"></span>
                            ❌ Removed
                        </div>
                        <div class="pce-legend-item pce-reset-filter" title="Click to show all changes">
                            <span class="pce-legend-color" style="background: linear-gradient(45deg, #ccc, #999);"></span>
                            🔄 All
                        </div>
                    </div>
                    <div id="pce-table-container">
                        <table id="pce-summary-table" class="pce-sortable">
                            <thead>
                                <tr>
                                    <th class="pce-priority-col" title="Click to sort by priority">Priority</th>
                                    <th title="Click to sort by type">Type</th>
                                    <th title="Click to sort by category">Category</th>
                                    <th title="Click to sort by details">Details</th>
                                </tr>
                            </thead>
                            <tbody id="pce-summary-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);
        addUIStyles();
        
        // Setup toggle functionality with proper event handling
        const toggleBtn = $('pce-toggle-btn');
        const panel = $('pce-summary-panel');
        
        if (toggleBtn && panel) {
            toggleBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                
                panel.classList.toggle('pce-collapsed');
                const isCollapsed = panel.classList.contains('pce-collapsed');
                toggleBtn.textContent = isCollapsed ? '+' : '−';
                toggleBtn.title = isCollapsed ? 'Expand Panel' : 'Collapse Panel';
            };
        }
        
        // Setup search functionality
        const searchInput = $('pce-search');
        if (searchInput) {
            searchInput.addEventListener('input', filterSummaryTable);
        }

        // Setup legend filtering
        setupLegendFiltering();
    }

    function addDifferenceToSummaryList(id, type, details, diffType) {
        const tableBody = $('pce-summary-table-body');
        const row = tableBody.insertRow();
        row.setAttribute('data-element-id', id);
        row.setAttribute('data-priority', window.PCE_DATA.PRIORITIES[type] || 99);
        row.setAttribute('data-type', type);
        row.setAttribute('data-diff-type', diffType); // Add this for filtering
        row.style.backgroundColor = window.PCE_DATA.COLORS[diffType] + '33';
        
        const priorityBadge = getPriorityBadge(type);
        row.innerHTML = `
            <td class="pce-priority-cell">${priorityBadge}</td>
            <td>${window.PCE_DATA.ICONS[diffType] || '❓'}</td>
            <td><strong>${type}</strong></td>
            <td>${details}</td>
        `;
        
        row.addEventListener('click', () => {
            const el = $(id);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('pce-focus-highlight');
                setTimeout(() => el.classList.remove('pce-focus-highlight'), 2500);
            }
        });
    }

    function getPriorityBadge(type) {
        const priority = window.PCE_DATA.PRIORITIES[type] || 99;
        let badge = '';
        let color = '';
        
        if (priority <= 6) {  // HIGH: Heading, New Link, Paragraph, General Text, Removed
            badge = 'HIGH';
            color = '#ff4444';
        } else if (priority === 7) {  // MEDIUM: Modified Link
            badge = 'MED';
            color = '#ff9900';
        } else {  // LOW: CTA Text, Image
            badge = 'LOW';
            color = '#4CAF50';
        }
        
        return `<span class="pce-priority-badge" style="background-color: ${color};">${badge}</span>`;
    }

    function sortResultsByPriority() {
        const tableBody = $('pce-summary-table-body');
        if (!tableBody) return;
        
        const rows = Array.from(tableBody.rows);
        rows.sort((a, b) => {
            const priorityA = parseInt(a.getAttribute('data-priority')) || 99;
            const priorityB = parseInt(b.getAttribute('data-priority')) || 99;
            return priorityA - priorityB;
        });
        
        // Clear and re-add sorted rows
        tableBody.innerHTML = '';
        rows.forEach(row => tableBody.appendChild(row));
    }

    function filterSummaryTable() {
        const q = normalizeText(this.value);
        const rows = Array.from($('pce-summary-table-body').rows);
        
        rows.forEach(row => {
            const text = normalizeText(row.innerText);
            row.style.display = text.includes(q) ? '' : 'none';
        });
    }

    function setupLegendFiltering() {
        // Add click handlers for legend items
        document.querySelectorAll('.pce-clickable-legend').forEach(item => {
            item.addEventListener('click', () => {
                const filter = item.getAttribute('data-filter');
                filterByType(filter);
                
                // Update active state
                document.querySelectorAll('.pce-clickable-legend').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
            });
        });

        // Add reset filter handler
        const resetFilter = document.querySelector('.pce-reset-filter');
        if (resetFilter) {
            resetFilter.addEventListener('click', () => {
                showAllRows();
                
                // Remove active state from all legend items
                document.querySelectorAll('.pce-clickable-legend').forEach(el => el.classList.remove('active'));
                resetFilter.classList.add('active');
            });
        }
    }

    function filterByType(diffType) {
        const rows = Array.from($('pce-summary-table-body').rows);
        
        rows.forEach(row => {
            const rowDiffType = row.getAttribute('data-diff-type');
            
            // Handle link filtering (includes LINK, MODIFIED_LINK, NEW_LINK)
            if (diffType === 'LINK') {
                row.style.display = ['LINK', 'MODIFIED_LINK', 'NEW_LINK'].includes(rowDiffType) ? '' : 'none';
            } else {
                row.style.display = rowDiffType === diffType ? '' : 'none';
            }
        });

        // Sort filtered results by legend order
        sortByLegendOrder(diffType);
    }

    function sortByLegendOrder(activeFilter) {
        const tableBody = $('pce-summary-table-body');
        if (!tableBody) return;
        
        const rows = Array.from(tableBody.rows).filter(row => row.style.display !== 'none');
        
        rows.sort((a, b) => {
            const typeA = a.getAttribute('data-diff-type');
            const typeB = b.getAttribute('data-diff-type');
            
            const orderA = window.PCE_DATA.LEGEND_SORT_ORDER[typeA] || 99;
            const orderB = window.PCE_DATA.LEGEND_SORT_ORDER[typeB] || 99;
            
            // If same type, sort by priority within type
            if (orderA === orderB) {
                const priorityA = parseInt(a.getAttribute('data-priority')) || 99;
                const priorityB = parseInt(b.getAttribute('data-priority')) || 99;
                return priorityA - priorityB;
            }
            
            return orderA - orderB;
        });
        
        // Re-append sorted rows
        rows.forEach(row => tableBody.appendChild(row));
    }

    function showAllRows() {
        const rows = Array.from($('pce-summary-table-body').rows);
        rows.forEach(row => {
            row.style.display = '';
        });
        
        // Re-sort by priority when showing all
        sortResultsByPriority();
    }

    function updateDiffCount() {
        const countEl = $('pce-summary-count');
        if (countEl) countEl.textContent = window.PCE_DATA.diffCounter;
        
        if (window.PCE_DATA.diffCounter > 0) {
            const panel = $('pce-summary-panel');
            const toggleBtn = $('pce-toggle-btn');
            
            if (panel && toggleBtn) {
                panel.classList.remove('pce-collapsed');
                toggleBtn.textContent = '−';
                toggleBtn.title = 'Collapse Panel';
            }
        }
    }

    /*** ===========================
     * UTILS
     * =========================== */
    const normalizeText = (t) => (t || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const getAbsoluteUrl = (doc, url) => new URL(url, doc.baseURI).href;
    const getFinalImageName = (url) => { try { return new URL(url, document.baseURI).pathname.split('/').pop(); } catch { return null; } };
    const parseSrcsetForFileNames = (srcset) => (srcset || '').split(',').map(s => getFinalImageName(s.trim().split(/\s+/)[0])).filter(Boolean);
    const getAllImageFileNames = (doc) => { const names = new Set(); Array.from(doc.getElementsByTagName('img')).forEach(img => { const srcName = getFinalImageName(img.src); if (srcName) names.add(srcName); parseSrcsetForFileNames(img.srcset).forEach(name => names.add(name)); }); return names; };
    const getTextNodes = (el) => { const nodes = []; const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.parentElement || n.parentElement.closest('script, style, #pce-ui-container') || !n.nodeValue.trim()) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT }); while (walker.nextNode()) nodes.push(walker.currentNode); return nodes; };
    const clearPreviousComparison = () => { const el = $('pce-ui-container'); if (el) el.remove(); window.PCE_DATA.diffCounter = 0; };
    const makeTableSortable = (table) => { 
        if (!table) return;
        table.querySelectorAll('th').forEach((header, i) => {
            header.addEventListener('click', () => sortTableByColumn(table, i, !header.classList.contains('sort-asc')));
        });
    };
    const sortTableByColumn = (table, col, asc = true) => { 
        const dir = asc ? 1 : -1; 
        const tBody = table.tBodies[0]; 
        const rows = Array.from(tBody.querySelectorAll('tr')); 
        
        rows.sort((a, b) => {
            let aVal = a.cells[col].textContent.trim();
            let bVal = b.cells[col].textContent.trim();
            
            // For priority column, sort by actual priority number
            if (col === 0) {
                aVal = parseInt(a.getAttribute('data-priority')) || 99;
                bVal = parseInt(b.getAttribute('data-priority')) || 99;
                return (aVal - bVal) * dir;
            }
            
            return aVal.localeCompare(bVal) * dir;
        }); 
        
        tBody.innerHTML = '';
        rows.forEach(row => tBody.appendChild(row));
        
        table.querySelectorAll('th').forEach(th => th.classList.remove('sort-asc', 'sort-desc')); 
        table.querySelector(`th:nth-child(${col + 1})`).classList.add(asc ? 'sort-asc' : 'sort-desc'); 
    };
    
    const addUIStyles = () => { 
        const s = document.createElement('style'); 
        s.textContent = `
            .pce-focus-highlight { 
                outline: 3px solid #00BFFF !important; 
                box-shadow: 0 0 15px rgba(0, 191, 255, 0.7) !important; 
            }
            .pce-marker { 
                display: inline-block; 
                width: 16px; 
                height: 16px; 
                margin-left: 5px; 
                cursor: pointer; 
            }
            .pce-marker-dot { 
                width: 100%; 
                height: 100%; 
                border-radius: 50%; 
                border: 1px solid white; 
                box-shadow: 0 0 5px rgba(0,0,0,0.7); 
            }
            @keyframes pce-flash { 
                50% { 
                    box-shadow: 0 0 8px 3px #fff; 
                    opacity: 0.5; 
                } 
            }
            .pce-flash { 
                animation: pce-flash 1s infinite; 
            }
            #pce-summary-panel { 
                position: fixed; 
                top: 10px; 
                right: 10px; 
                width: 650px; 
                max-width: 95vw; 
                max-height: 85vh;
                background: white; 
                border-radius: 8px; 
                box-shadow: 0 4px 15px rgba(0,0,0,0.3); 
                z-index: 999999;
                display: flex;
                flex-direction: column;
                transition: transform 0.3s ease;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            #pce-summary-panel.pce-collapsed { 
                transform: translateX(calc(100% - 50px)); 
            }
            #pce-header { 
                display: flex; 
                align-items: center; 
                justify-content: space-between;
                background: linear-gradient(135deg, #005A9C, #0078D4); 
                color: white; 
                padding: 10px 15px;
                border-radius: 8px 8px 0 0;
                flex-shrink: 0;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            #pce-title {
                margin: 0;
                font-size: 15px;
                font-weight: 600;
                flex: 1;
            }
            #pce-controls {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            #pce-header input { 
                padding: 6px 10px; 
                border: none; 
                border-radius: 4px; 
                width: 160px;
                font-size: 12px;
                outline: none;
            }
            #pce-toggle-btn {
                background: rgba(255,255,255,0.2);
                color: white;
                border: none;
                border-radius: 4px;
                width: 28px;
                height: 28px;
                cursor: pointer;
                font-size: 18px;
                font-weight: bold;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                user-select: none;
            }
            #pce-toggle-btn:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.05);
            }
            #pce-toggle-btn:active {
                transform: scale(0.95);
            }
            #pce-summary-content {
                flex: 1;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }
            #pce-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                padding: 10px 15px;
                background: #f8f9fa;
                border-bottom: 1px solid #e9ecef;
                font-size: 11px;
            }
            .pce-legend-item {
                display: flex;
                align-items: center;
                gap: 4px;
                padding: 4px 8px;
                border-radius: 4px;
                background: white;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                transition: all 0.2s ease;
                font-size: 11px;
                font-weight: 500;
            }
            .pce-clickable-legend {
                cursor: pointer;
            }
            .pce-clickable-legend:hover {
                transform: translateY(-1px);
                box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                background: #f8f9fa;
            }
            .pce-clickable-legend.active {
                background: #007bff;
                color: white;
                box-shadow: 0 2px 6px rgba(0,123,255,0.3);
            }
            .pce-reset-filter {
                cursor: pointer;
                border: 2px dashed #ccc;
            }
            .pce-reset-filter:hover {
                border-color: #007bff;
                background: #f8f9fa;
            }
            .pce-reset-filter.active {
                background: #28a745;
                color: white;
                border-color: #28a745;
            }
            .pce-legend-color {
                width: 12px;
                height: 12px;
                border-radius: 2px;
                border: 1px solid rgba(0,0,0,0.2);
            }
            #pce-table-container {
                flex: 1;
                overflow-y: auto;
                overflow-x: auto;
            }
            #pce-summary-table { 
                width: 100%; 
                border-collapse: collapse; 
                font-size: 12px; 
            }
            #pce-summary-table th {
                position: sticky;
                top: 0;
                background: #f1f3f4;
                border-bottom: 2px solid #dadce0;
                padding: 10px 8px;
                font-weight: 600;
                cursor: pointer;
                user-select: none;
                text-align: left;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            #pce-summary-table th:hover {
                background: #e8eaed;
            }
            .pce-priority-col {
                width: 70px !important;
            }
            #pce-summary-table td { 
                padding: 8px; 
                border-bottom: 1px solid #e9ecef; 
                word-wrap: break-word;
                vertical-align: top;
            }
            .pce-priority-cell {
                text-align: center;
                width: 70px;
            }
            .pce-priority-badge {
                display: inline-block;
                padding: 2px 6px;
                border-radius: 3px;
                color: white;
                font-size: 10px;
                font-weight: bold;
                text-align: center;
                min-width: 35px;
            }
            #pce-summary-table tbody tr { 
                cursor: pointer;
                transition: background-color 0.15s ease;
            }
            #pce-summary-table tbody tr:hover { 
                background: #e3f2fd !important; 
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            #pce-summary-table th.sort-asc::after {
                content: ' ▲';
                font-size: 10px;
                color: #005A9C;
            }
            #pce-summary-table th.sort-desc::after {
                content: ' ▼';
                font-size: 10px;
                color: #005A9C;
            }
        `; 
        document.head.appendChild(s); 
    };
})();