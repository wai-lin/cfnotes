import { DatabaseView } from "./database/database-view";
import { NotesEditor } from "./notes/notes-editor";

if (!customElements.get("cf-database")) {
	customElements.define("cf-database", DatabaseView);
}

if (!customElements.get("notes-editor")) {
	customElements.define("notes-editor", NotesEditor);
}
