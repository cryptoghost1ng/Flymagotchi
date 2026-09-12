# Privacy policy — Flymagotchi

*Last updated: 12 September 2026*

## Flymagotchi collects nothing

The extension does not collect, transmit, sell or share any personal data. There is no
analytics, no tracking, no account, and no server that receives anything. The simulation
runs entirely inside your browser.

## What is stored, and where

Four values are kept in your browser's local extension storage, on your own device:

- a random **seed**, generated on install, which decides which 40 neurons are silenced in
  your fly;
- the **time it was created**, to show its age;
- the **time it last ate**, to advance the hunger clock;
- a **count of meals**.

None of it leaves your device. None of it identifies you. Uninstalling the extension
deletes all of it.

## Network requests

The extension makes **no network requests at all**. The connectome data, the simulator and
the artwork all ship inside the package and are read from disk. **There is no remote
code**: nothing is fetched from anywhere and executed.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Keeps the four values above, locally. |
| `sidePanel` | The pet lives in the side panel. That is the whole interface. |
| `activeTab`, `scripting` | Only used when the user presses *Let it out on the web*, to draw the fly on top of the tab they are viewing. |
| `*://*/*` (optional) | Never requested at install. Chrome asks for it at the moment the user presses that button, and *Bring it back* revokes it. Used only to draw the fly over the page. The extension does not read, store or transmit the content of any page. |

## Children

The extension is not directed at children, and collects no data from anyone of any age.

## Changes

Any change is published here with a new date. The source is public, so a change in
behaviour is visible in the commit history of this repository.

## Contact

Open an issue on <https://github.com/cryptoghost1ng/Flymagotchi>.
