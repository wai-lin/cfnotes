// Every page's script. Datastar with Rocket starts on import, so it comes first.
import "#lib/datastar/index.ts";
import "#modules/appearance/client/appearance.ts";
import "#modules/auth/client/session.ts";
import "#modules/offline/client/offline.ts";
import { defineComments } from "#modules/comments/client/comments.ts";
import { defineDatabaseView } from "#modules/database/client/database-view.ts";
import { defineNotesEditor } from "#modules/pages/client/notes-editor.ts";
import "#modules/pages/client/page-chrome.ts";
import "#modules/search/client/search.ts";
import "#modules/sharing/client/share.ts";
import "#modules/sidebar/client/sidebar.ts";
import "#modules/trash/client/notices.ts";

// The table first: an editor being upgraded can hold one. Comments before
// the editor, which connects to them as it mounts.
defineDatabaseView();
defineComments();
defineNotesEditor();
