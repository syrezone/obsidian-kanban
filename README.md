# Obsidian Kanban Plugin

> ## About this fork
>
> **`syrezone/obsidian-kanban`, branch `canvas-kanban`:** a personal build of Kanban
> 2.0.51 that adds nested cards and a note side panel, and lets Kanban boards live inside
> [Maguilanote](https://github.com/syrezone/maguilanote-obsidian/tree/canvas-kanban)
> canvas cards. It is used and tested on Obsidian desktop and in Ignis (Obsidian in a
> browser); it is not a community release.
>
> ### What it adds
>
> - **Nested cards.** Tasks indented under a card become its child cards, at any depth,
>   with their own checkboxes, dates and tags. Drag a card with the pointer on the right
>   half of another card to nest it; a translucent preview shows where it will land.
>   The file stays an ordinary indented task list.
> - **Note side panel.** A card's note (the first link in its first line) opens in one
>   reused panel to the right. Ctrl/Cmd+click a card or a link opens it there, like
>   Ctrl/Cmd+Enter on a `[[link]]` while editing; Alt+click opens it in a new tab. A card
>   without a note gets one created (**New note from card**).
> - **Note tasks on cards.** The tasks inside a card's note are listed under the card
>   (up to ten) and can be ticked there.
> - **Kanban in canvas cards.** Other plugins can mount a real, editable board inside
>   their own views (`plugin.mountBoard()`, embed API 2). Dragging, editing and saving
>   work in zoomed canvases, and Kanban commands and hotkeys act on the board you last
>   clicked.
> - **Safer saving.** One shared document per board file: tabs and canvas cards of the
>   same board stay in sync, changes made outside Kanban are merged into unsaved edits
>   line by line (as Obsidian does for notes), and an edit you have not confirmed with
>   Enter is kept when a board closes.
> - **Smaller things.** A `kanban` badge on board files in the file explorer; opening
>   another card's editor or starting a drag confirms the open edit, like Enter.
>
> ### Using it
>
> Build from this branch and copy `main.js`, `manifest.json` and `styles.css` into
> `.obsidian/plugins/obsidian-kanban/` of your vault:
>
> ```
> corepack yarn@1.22.22 install --frozen-lockfile
> corepack yarn@1.22.22 build
> ```
>
> The manifest still says 2.0.51, so **do not update Kanban from the community list**,
> which would replace this build. Indented task lists are read as child cards, so
> existing boards that use indented checklists inside cards look different; the file
> keeps them as an indented task list (when the board saves, children are written one
> indent deeper than their card, as tasks). Canvas cards are supported in the main window on
> desktop and Ignis; pop-out windows and mobile are not.
>
> Details for developers: [personal development guide](docs/PERSONAL_DEVELOPMENT.md)
> and [personal changelog](docs/PERSONAL_CHANGELOG.md). Everything below is the
> original project's README.

Create markdown-backed Kanban boards in [Obsidian](https://obsidian.md/)

- [Bugs, Issues, & Feature Requests](https://github.com/mgmeyers/obsidian-kanban/issues)
- [Development Roadmap](https://github.com/mgmeyers/obsidian-kanban/projects/1)

![Screen Shot 2021-09-16 at 12.58.22 PM.png](https://github.com/mgmeyers/obsidian-kanban/blob/main/docs/Assets/Screen%20Shot%202021-09-16%20at%2012.58.22%20PM.png)

![Screen Shot 2021-09-16 at 1.10.38 PM.png](https://github.com/mgmeyers/obsidian-kanban/blob/main/docs/Assets/Screen%20Shot%202021-09-16%20at%201.10.38%20PM.png)

## Documentation

Find the plugin documentation here: [Obsidian Kanban Plugin Documentation](https://publish.obsidian.md/kanban/)

## Support

If you find this plugin useful and would like to support its development, you can sponsor [me](https://github.com/mgmeyers) on Github, or buy me a coffee.

[![GitHub Sponsors](https://img.shields.io/github/sponsors/mgmeyers?label=Sponsor&logo=GitHub%20Sponsors&style=for-the-badge)](https://github.com/sponsors/mgmeyers)

<a href="https://www.buymeacoffee.com/mgme"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=mgme&button_colour=5F7FFF&font_colour=ffffff&font_family=Lato&outline_colour=000000&coffee_colour=FFDD00"></a>
