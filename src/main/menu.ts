import type { MenuItemConstructorOptions } from 'electron';

export function buildMenuTemplate(handlers: { onOpen: () => void }): MenuItemConstructorOptions[] {
  return [
    {
      label: 'File',
      submenu: [
        { id: 'menu-open', label: 'Open…', accelerator: 'CmdOrCtrl+O', click: handlers.onOpen },
        { type: 'separator' },
        { id: 'menu-exit', label: 'Exit', role: 'quit' },
      ],
    },
  ];
}
