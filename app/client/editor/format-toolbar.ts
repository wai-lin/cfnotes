import { $isCodeNode } from "@lexical/code";
import { $isLinkNode } from "@lexical/link";
import { $patchStyleText } from "@lexical/selection";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import { icon, type IconName } from "@modules/icons";
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_LOW,
	FORMAT_TEXT_COMMAND,
	SELECTION_CHANGE_COMMAND,
	type LexicalEditor,
	type TextFormatType,
} from "lexical";

import { BACK_COLORS, TEXT_COLORS } from "./colors";
import { INSERT_EQUATION_COMMAND } from "./equation-node";
import { OPEN_LINK_EDITOR_COMMAND } from "./link-ui";

const FORMATS: { format: TextFormatType; name: IconName; label: string }[] = [
	{ format: "bold", name: "bold", label: "Bold (⌘B)" },
	{ format: "italic", name: "italic", label: "Italic (⌘I)" },
	{ format: "underline", name: "underline", label: "Underline (⌘U)" },
	{ format: "strikethrough", name: "strikethrough", label: "Strikethrough" },
	{ format: "code", name: "code", label: "Inline code (⌘E)" },
];

/** A floating Notion-style toolbar over any text selection: B / i / U / S / code / link. */
export function registerFormatToolbar(editor: LexicalEditor): () => void {
	const bar = document.createElement("div");
	bar.className = "fmt-bar";
	bar.setAttribute("role", "toolbar");
	bar.hidden = true;
	// Keep the editor's selection while pressing toolbar buttons.
	bar.addEventListener("mousedown", (event) => event.preventDefault());

	const buttons = new Map<TextFormatType, HTMLButtonElement>();
	for (const { format, name, label } of FORMATS) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "fmt-btn";
		button.innerHTML = icon(name, 16);
		button.title = label;
		button.setAttribute("aria-label", label);
		button.addEventListener("click", () => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format));
		buttons.set(format, button);
		bar.append(button);
	}
	const linkButton = document.createElement("button");
	linkButton.type = "button";
	linkButton.className = "fmt-btn fmt-link";
	linkButton.innerHTML = icon("link", 16);
	linkButton.title = "Link (⌘K)";
	linkButton.setAttribute("aria-label", "Link");
	linkButton.addEventListener("click", () =>
		editor.dispatchCommand(OPEN_LINK_EDITOR_COMMAND, undefined),
	);
	bar.append(linkButton);
	const mathButton = document.createElement("button");
	mathButton.type = "button";
	mathButton.className = "fmt-btn fmt-math";
	mathButton.innerHTML = icon("squareRoot", 16);
	mathButton.title = "Inline equation (⌘⇧E)";
	mathButton.setAttribute("aria-label", "Inline equation");
	mathButton.addEventListener("click", () =>
		editor.dispatchCommand(INSERT_EQUATION_COMMAND, { inline: true }),
	);
	bar.append(mathButton);

	// ---- A▾ : text color and highlight ----
	const colorButton = document.createElement("button");
	colorButton.type = "button";
	colorButton.className = "fmt-btn fmt-color";
	colorButton.textContent = "A";
	colorButton.title = "Text color";
	colorButton.setAttribute("aria-label", "Text color");
	bar.append(colorButton);

	const panel = document.createElement("div");
	panel.className = "color-menu";
	panel.hidden = true;
	const applyStyle = (styles: Record<string, string | null>) => {
		panel.hidden = true;
		editor.update(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) $patchStyleText(selection, styles);
		});
	};
	const swatchRow = (
		title: string,
		colors: [string, string | null][],
		style: (value: string | null) => Record<string, string | null>,
		paint: (swatch: HTMLButtonElement, value: string | null) => void,
	) => {
		const head = document.createElement("div");
		head.className = "color-head";
		head.textContent = title;
		const row = document.createElement("div");
		row.className = "color-row";
		for (const [name, value] of colors) {
			const swatch = document.createElement("button");
			swatch.type = "button";
			swatch.className = "color-swatch";
			swatch.textContent = "A";
			swatch.title = name;
			swatch.setAttribute("aria-label", `${title}: ${name}`);
			paint(swatch, value);
			swatch.addEventListener("click", () => applyStyle(style(value)));
			row.append(swatch);
		}
		panel.append(head, row);
	};
	swatchRow(
		"Text color",
		TEXT_COLORS,
		(value) => ({ color: value }),
		(swatch, value) => {
			if (value) swatch.style.color = value;
		},
	);
	swatchRow(
		"Background",
		BACK_COLORS,
		(value) => ({ "background-color": value }),
		(swatch, value) => {
			if (value) swatch.style.backgroundColor = value;
		},
	);
	bar.append(panel);
	colorButton.addEventListener("click", () => (panel.hidden = !panel.hidden));

	document.body.append(bar);

	const hide = () => {
		bar.hidden = true;
		panel.hidden = true;
	};

	const place = () => {
		const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
		const rect = range?.getBoundingClientRect();
		if (!rect || (rect.width === 0 && rect.height === 0)) return hide();
		const top = rect.top - bar.offsetHeight - 8;
		bar.style.top = `${top > 8 ? top : rect.bottom + 8}px`;
		bar.style.left = `${Math.max(8, Math.min(rect.left + rect.width / 2 - bar.offsetWidth / 2, innerWidth - bar.offsetWidth - 8))}px`;
	};

	const refresh = () => {
		editor.getEditorState().read(() => {
			const selection = $getSelection();
			if (
				!$isRangeSelection(selection) ||
				selection.isCollapsed() ||
				selection.getTextContent() === "" ||
				$isCodeNode(selection.anchor.getNode().getTopLevelElement())
			)
				return hide();
			for (const [format, button] of buttons)
				button.classList.toggle("is-on", selection.hasFormat(format));
			const node = selection.anchor.getNode();
			linkButton.classList.toggle("is-on", $findMatchingParent(node, $isLinkNode) !== null);
			bar.hidden = false;
			place();
		});
	};

	// Wait for mouseup so the bar doesn't chase a drag-selection.
	let dragging = false;
	const onMouseDown = (event: MouseEvent) => {
		if (!bar.contains(event.target as Node)) dragging = true;
	};
	const onMouseUp = () => {
		dragging = false;
		setTimeout(refresh, 0);
	};
	const onScroll = () => {
		if (!bar.hidden) place();
	};
	document.addEventListener("mousedown", onMouseDown);
	document.addEventListener("mouseup", onMouseUp);
	window.addEventListener("scroll", onScroll, true);
	window.addEventListener("resize", onScroll);

	return mergeRegister(
		editor.registerCommand(
			SELECTION_CHANGE_COMMAND,
			() => {
				if (dragging) hide();
				else refresh();
				return false;
			},
			COMMAND_PRIORITY_LOW,
		),
		editor.registerUpdateListener(() => {
			if (!dragging) refresh();
		}),
		editor.registerRootListener((root, prevRoot) => {
			prevRoot?.removeEventListener("blur", onBlur);
			root?.addEventListener("blur", onBlur);
		}),
		() => {
			document.removeEventListener("mousedown", onMouseDown);
			document.removeEventListener("mouseup", onMouseUp);
			window.removeEventListener("scroll", onScroll, true);
			window.removeEventListener("resize", onScroll);
			bar.remove();
		},
	);

	function onBlur(event: FocusEvent) {
		const to = event.relatedTarget as Node | null;
		if (!to || !bar.contains(to)) hide();
	}
}
