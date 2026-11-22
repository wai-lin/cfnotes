import { defineHandler } from "spacefn/handler";

/** The Archive is now Trash: old links and bookmarks still arrive there. */
export const GET = defineHandler((c) => c.redirect("/trash", 301));
