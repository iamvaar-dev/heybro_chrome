
export async function readPage(tabId) {
    if (!tabId) {
        throw new Error("tabId is required for read_page");
    }

    function extractContent() {
        try {
            // Create a clone to manipulate without affecting the page
            const clone = document.body.cloneNode(true);

            // Remove scripts, styles, and other non-content elements
            const toRemove = clone.querySelectorAll('script, style, noscript, iframe, object, embed, svg, img, video, audio, canvas, map, area, link, meta');
            toRemove.forEach(el => el.remove());

            // Get text content. innerText is aware of CSS styling (like display:none), 
            // but since we are on a clone that is not attached to the DOM, 
            // getComputedStyle might not work as expected for visibility.
            // However, textContent returns everything including hidden text.
            // innerText on a detached node usually tries to approximate.

            // To get the best result, we can use a TreeWalker on the CLONE to get text nodes,
            // and normalize whitespace.

            // Simple approach: textContent with regex cleaning
            let text = clone.textContent || "";

            // Collapse whitespace
            text = text.replace(/\s+/g, " ").trim();

            return text;
        } catch (e) {
            return "Error reading page: " + e.message;
        }
    }

    try {
        const result = await chrome.scripting.executeScript({
            target: { tabId },
            func: extractContent
        });

        if (result && result[0] && result[0].result) {
            return { ok: true, text: result[0].result };
        }
        return { ok: false, error: "Failed to extract text" };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}
