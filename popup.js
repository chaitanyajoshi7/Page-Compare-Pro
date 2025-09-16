document.addEventListener("DOMContentLoaded", function () {
    const activeTabTitleElement = document.getElementById("active-tab-title");
    const tabsContainer = document.getElementById("tabs");
    const compareButton = document.getElementById('btnCompare');
    
    let activeTab = null;

    // First, identify the active tab to set it as the "Reference" page.
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs.length === 0) {
            activeTabTitleElement.textContent = "No active tab found.";
            return;
        }
        activeTab = tabs[0];
        activeTabTitleElement.textContent = activeTab.title;
        activeTabTitleElement.title = `This is the current page that will be highlighted:\n${activeTab.url}`;

        // Now, query for all other tabs to populate the "Source" list.
        chrome.tabs.query({ currentWindow: true }, function (allTabs) {
            tabsContainer.innerHTML = ''; // Clear "Loading..." message
            let hasSelectableTabs = false;
            
            allTabs.forEach((tab) => {
                // List only valid, scriptable tabs and EXCLUDE the active tab itself.
                if (tab.id !== activeTab.id && tab.url && (tab.url.startsWith("http:") || tab.url.startsWith("https://"))) {
                    hasSelectableTabs = true;
                    tabsContainer.innerHTML += `
                        <div class="tab-item">
                            <input type="radio" name="tab" id="${tab.id}">
                            <label for="${tab.id}" title="${tab.url}">${tab.title}</label>
                        </div>
                    `;
                }
            });

            if (!hasSelectableTabs) {
                 tabsContainer.innerHTML = '<p>No other tabs available to use as a source.</p>';
            }
        });
    });

    // Enable the compare button only when a source tab is selected.
    tabsContainer.addEventListener('change', () => {
        compareButton.disabled = false;
    });

    // Handle the compare button click.
    compareButton.addEventListener('click', () => {
        const selectedSourceTab = document.querySelector('input[name="tab"]:checked');
        if (selectedSourceTab && activeTab) {
            const sourceTabId = parseInt(selectedSourceTab.id);

            // 1. Get the HTML from the selected source tab.
            chrome.scripting.executeScript({
                target: { tabId: sourceTabId },
                function: () => document.documentElement.outerHTML
            }, (injectionResults) => {
                if (chrome.runtime.lastError || !injectionResults || !injectionResults[0]) {
                    alert("Error: Could not access the selected source tab. It might be a protected page.");
                    return;
                }
                const sourceHTML = injectionResults[0].result;

                // 2. Inject the content script into the active (reference) tab.
                chrome.scripting.executeScript({
                    target: { tabId: activeTab.id },
                    files: ['content_script.js']
                }, () => {
                    // 3. Send the source HTML to the now-injected content script.
                    chrome.tabs.sendMessage(activeTab.id, {
                        from: "popup",
                        sourceHtml: sourceHTML
                    });
                    window.close(); // Close the popup to not obscure the view.
                });
            });
        }
    });
});