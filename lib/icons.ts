import alignLeft from "@tabler/icons/outline/align-left.svg?raw";
import archive from "@tabler/icons/outline/archive.svg?raw";
import arrowBackUp from "@tabler/icons/outline/arrow-back-up.svg?raw";
import arrowDown from "@tabler/icons/outline/arrow-down.svg?raw";
import arrowLeft from "@tabler/icons/outline/arrow-left.svg?raw";
import arrowRight from "@tabler/icons/outline/arrow-right.svg?raw";
import arrowUpRight from "@tabler/icons/outline/arrow-up-right.svg?raw";
import arrowUp from "@tabler/icons/outline/arrow-up.svg?raw";
import arrowsSort from "@tabler/icons/outline/arrows-sort.svg?raw";
import bold from "@tabler/icons/outline/bold.svg?raw";
import bookmark from "@tabler/icons/outline/bookmark.svg?raw";
import calendarTime from "@tabler/icons/outline/calendar-time.svg?raw";
import calendar from "@tabler/icons/outline/calendar.svg?raw";
import check from "@tabler/icons/outline/check.svg?raw";
import chevronDown from "@tabler/icons/outline/chevron-down.svg?raw";
import chevronLeft from "@tabler/icons/outline/chevron-left.svg?raw";
import chevronRight from "@tabler/icons/outline/chevron-right.svg?raw";
import chevronsLeft from "@tabler/icons/outline/chevrons-left.svg?raw";
import circleCheck from "@tabler/icons/outline/circle-check.svg?raw";
import circleChevronDown from "@tabler/icons/outline/circle-chevron-down.svg?raw";
import clockEdit from "@tabler/icons/outline/clock-edit.svg?raw";
import clockHour4 from "@tabler/icons/outline/clock-hour-4.svg?raw";
import clock from "@tabler/icons/outline/clock.svg?raw";
import code from "@tabler/icons/outline/code.svg?raw";
import colorSwatch from "@tabler/icons/outline/color-swatch.svg?raw";
import copy from "@tabler/icons/outline/copy.svg?raw";
import dots from "@tabler/icons/outline/dots.svg?raw";
import download from "@tabler/icons/outline/download.svg?raw";
import externalLink from "@tabler/icons/outline/external-link.svg?raw";
import fileOff from "@tabler/icons/outline/file-off.svg?raw";
import filePlus from "@tabler/icons/outline/file-plus.svg?raw";
import fileText from "@tabler/icons/outline/file-text.svg?raw";
import filter from "@tabler/icons/outline/filter.svg?raw";
import folderOpen from "@tabler/icons/outline/folder-open.svg?raw";
import folderPlus from "@tabler/icons/outline/folder-plus.svg?raw";
import folder from "@tabler/icons/outline/folder.svg?raw";
import gripVertical from "@tabler/icons/outline/grip-vertical.svg?raw";
import hash from "@tabler/icons/outline/hash.svg?raw";
import infoCircle from "@tabler/icons/outline/info-circle.svg?raw";
import italic from "@tabler/icons/outline/italic.svg?raw";
import key from "@tabler/icons/outline/key.svg?raw";
import layoutGrid from "@tabler/icons/outline/layout-grid.svg?raw";
import layoutKanban from "@tabler/icons/outline/layout-kanban.svg?raw";
import layoutRows from "@tabler/icons/outline/layout-rows.svg?raw";
import letterCase from "@tabler/icons/outline/letter-case.svg?raw";
import link from "@tabler/icons/outline/link.svg?raw";
import listNumbers from "@tabler/icons/outline/list-numbers.svg?raw";
import list from "@tabler/icons/outline/list.svg?raw";
import mail from "@tabler/icons/outline/mail.svg?raw";
import mathFunction from "@tabler/icons/outline/math-function.svg?raw";
import menu from "@tabler/icons/outline/menu-2.svg?raw";
import messageCircle from "@tabler/icons/outline/message-circle.svg?raw";
import moodSmile from "@tabler/icons/outline/mood-smile.svg?raw";
import paperclip from "@tabler/icons/outline/paperclip.svg?raw";
import pencil from "@tabler/icons/outline/pencil.svg?raw";
import phone from "@tabler/icons/outline/phone.svg?raw";
import photo from "@tabler/icons/outline/photo.svg?raw";
import plus from "@tabler/icons/outline/plus.svg?raw";
import printer from "@tabler/icons/outline/printer.svg?raw";
import search from "@tabler/icons/outline/search.svg?raw";
import send from "@tabler/icons/outline/send.svg?raw";
import squareCheck from "@tabler/icons/outline/square-check.svg?raw";
import squareRoot from "@tabler/icons/outline/square-root.svg?raw";
import strikethrough from "@tabler/icons/outline/strikethrough.svg?raw";
/**
 * Tabler icons (https://tabler.io/icons), imported as SVG text so the server
 * shell and the browser scripts draw the same icons. Add a name here to use it.
 */
import table from "@tabler/icons/outline/table.svg?raw";
import timeline from "@tabler/icons/outline/timeline.svg?raw";
import trash from "@tabler/icons/outline/trash.svg?raw";
import underline from "@tabler/icons/outline/underline.svg?raw";
import userEdit from "@tabler/icons/outline/user-edit.svg?raw";
import user from "@tabler/icons/outline/user.svg?raw";
import world from "@tabler/icons/outline/world.svg?raw";
import x from "@tabler/icons/outline/x.svg?raw";

const SOURCES = {
	gripVertical,
	layoutGrid,
	layoutKanban,
	chevronLeft,
	mathFunction,
	archive,
	arrowBackUp,
	arrowsSort,
	filter,
	arrowUp,
	arrowDown,
	table,
	alignLeft,
	hash,
	circleChevronDown,
	list,
	listNumbers,
	calendar,
	squareCheck,
	link,
	trash,
	arrowLeft,
	arrowRight,
	arrowUpRight,
	letterCase,
	x,
	check,
	chevronDown,
	chevronRight,
	chevronsLeft,
	copy,
	colorSwatch,
	dots,
	fileOff,
	filePlus,
	fileText,
	folder,
	folderOpen,
	folderPlus,
	menu,
	plus,
	bold,
	italic,
	underline,
	strikethrough,
	code,
	download,
	moodSmile,
	paperclip,
	photo,
	search,
	infoCircle,
	bookmark,
	externalLink,
	printer,
	squareRoot,
	world,
	mail,
	phone,
	user,
	calendarTime,
	clockHour4,
	clock,
	clockEdit,
	userEdit,
	timeline,
	layoutRows,
	messageCircle,
	circleCheck,
	pencil,
	send,
	key,
} as const;

export type IconName = keyof typeof SOURCES;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * The icon as an SVG string: `size` px square, a lighter stroke than Tabler's
 * default to match the UI text, decorative (`aria-hidden`), class `icon icon-<kebab-name>`.
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
