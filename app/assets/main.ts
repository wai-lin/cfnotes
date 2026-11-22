// Every page's script. Datastar with Rocket starts on import, so it comes first.
import "#lib/datastar/index.ts";
import { defineDatabaseView } from "#modules/database/client/database-view.ts";
import { defineNotesEditor } from "#modules/pages/client/notes-editor.ts";
import "#modules/pages/client/page-chrome.ts";
import "#modules/search/client/search.ts";
import "#modules/sidebar/client/sidebar.ts";
import "#modules/trash/client/notices.ts";

// The table first: an editor being upgraded can hold one.
defineDatabaseView();
defineNotesEditor();
