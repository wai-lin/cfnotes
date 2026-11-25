import arrowsExchange from "@tabler/icons/outline/arrows-exchange.svg?raw";
/**
 * The Tabler icons (https://tabler.io/icons) the editor draws, imported as SVG
 * text. Add a name here to use it.
 */
import bold from "@tabler/icons/outline/bold.svg?raw";
import bookmark from "@tabler/icons/outline/bookmark.svg?raw";
import check from "@tabler/icons/outline/check.svg?raw";
import chevronDown from "@tabler/icons/outline/chevron-down.svg?raw";
import code from "@tabler/icons/outline/code.svg?raw";
import copy from "@tabler/icons/outline/copy.svg?raw";
import dots from "@tabler/icons/outline/dots.svg?raw";
import download from "@tabler/icons/outline/download.svg?raw";
import externalLink from "@tabler/icons/outline/external-link.svg?raw";
import fileOff from "@tabler/icons/outline/file-off.svg?raw";
import filePlus from "@tabler/icons/outline/file-plus.svg?raw";
import fileText from "@tabler/icons/outline/file-text.svg?raw";
import fileTypePdf from "@tabler/icons/outline/file-type-pdf.svg?raw";
import focusCentered from "@tabler/icons/outline/focus-centered.svg?raw";
import gripVertical from "@tabler/icons/outline/grip-vertical.svg?raw";
import italic from "@tabler/icons/outline/italic.svg?raw";
import link from "@tabler/icons/outline/link.svg?raw";
import listTree from "@tabler/icons/outline/list-tree.svg?raw";
import maximize from "@tabler/icons/outline/maximize.svg?raw";
import messagePlus from "@tabler/icons/outline/message-plus.svg?raw";
import music from "@tabler/icons/outline/music.svg?raw";
import paperclip from "@tabler/icons/outline/paperclip.svg?raw";
import plus from "@tabler/icons/outline/plus.svg?raw";
import squareRoot from "@tabler/icons/outline/square-root.svg?raw";
import strikethrough from "@tabler/icons/outline/strikethrough.svg?raw";
import underline from "@tabler/icons/outline/underline.svg?raw";
import unlink from "@tabler/icons/outline/unlink.svg?raw";
import video from "@tabler/icons/outline/video.svg?raw";
import world from "@tabler/icons/outline/world.svg?raw";
import x from "@tabler/icons/outline/x.svg?raw";
import zoomIn from "@tabler/icons/outline/zoom-in.svg?raw";
import zoomOut from "@tabler/icons/outline/zoom-out.svg?raw";

const SOURCES = {
	messagePlus,
	listTree,
	unlink,
	video,
	music,
	fileTypePdf,
	arrowsExchange,
	bold,
	bookmark,
	check,
	chevronDown,
	code,
	copy,
	dots,
	download,
	externalLink,
	fileOff,
	filePlus,
	fileText,
	gripVertical,
	italic,
	link,
	paperclip,
	plus,
	squareRoot,
	strikethrough,
	underline,
	world,
	x,
	focusCentered,
	maximize,
	zoomIn,
	zoomOut,
} as const;

export type IconName = keyof typeof SOURCES;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The icon as an SVG string: `size` px square, a lighter stroke than Tabler's
 * default, decorative (`aria-hidden`), class `icon icon-<kebab-name>`.
 */
export function icon(name: IconName, size = 16, stroke = 1.75): string {
	return SOURCES[name]
		.replace(/<svg[^>]*>/, (tag) =>
			tag
				.replace(/\s+/g, " ")
				.replace(/ width="\d+"/, ` width="${size}"`)
				.replace(/ height="\d+"/, ` height="${size}"`)
				.replace(/ stroke-width="[\d.]+"/, ` stroke-width="${stroke}"`)
				.replace(
					/ class="[^"]*"/,
					` class="icon icon-${kebab(name)}" aria-hidden="true" focusable="false"`,
				),
		)
		.replace(/\s*<path stroke="none" d="M0 0h24v24H0z" fill="none" \/>/, "")
		.replace(/>\s+</g, "><")
		.trim();
}
