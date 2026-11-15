import { definePage, html } from "spacefn/pages";

// The loader always redirects to a page, so this render is a fallback only.
export default definePage(() => html`<p><a href="/">Open cfnotes</a></p>`);
