# Themes and fonts

The "Aa" button in a page's bar picks a theme and a reading font. The choice is kept per device (localStorage), shows at once, and reaches the device's other open tabs.

## Themes

- **System** follows the device's light or dark setting, and changes along with it.
- **Light** and **Dark** are the usual ones.
- **Paper** looks like old newsprint: yellowed paper and brown-black ink.
- **Dusk** is a dark theme for reading at length: warm charcoal, not black, with off-white text that doesn't glare.

Printing (Export PDF) always uses the light colours.

## Fonts

The font applies to a page's title and text. The rest of the app, databases and code keep their own fonts.

- **Default** is the system's sans-serif.
- **Serif** is the system's serif (New York on Apple devices, Georgia elsewhere).
- **Typewriter** is Courier Prime.

Myanmar text is shown in Noto Sans Myanmar whatever the font, since few systems have a good Myanmar font.

- The browser fetches it only for a page with Myanmar text.
- Pages with Myanmar text in their title or content get taller lines (`has-myanmar`), so stacked marks don't touch the line above.

Both fonts come from fontsource packages and are served by the app with its other assets, so they work offline too.

## Code

- `lib/ui/app.css`: the light tokens, and the dark ones under `:root[data-scheme="dark"]`.
- `lib/ui/themes.css`: Paper, Dusk, the fonts and the Myanmar line height.
- `modules/appearance/appearance.ts`: the themes and fonts, and what a saved choice resolves to (pure, tested).
- `modules/appearance/views.ts`: the head script.
  - It sets `data-theme`, `data-scheme` and `data-font` on `<html>` before the first paint, and sets the browser's bar colour.
  - Every document's head has it, the login page's too.
- `modules/appearance/client/appearance.ts`: the picker, following System, syncing tabs, and keeping `has-myanmar` current while typing.

To add a theme, add it to `THEMES` (and to `DARK` if it builds on the dark tokens), and give it a token block in `themes.css`.
