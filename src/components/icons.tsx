import type { ReactNode } from 'react';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PenIcon = () => (
  <Icon>
    <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" />
    <path d="M14.5 6.5l3 3" />
  </Icon>
);
export const HighlighterIcon = () => (
  <Icon>
    <path d="M9 15l-3 3-2 .5.5-2 3-3" />
    <path d="M14 4.5l5.5 5.5-8 8L6 12.5z" />
    <path d="M4 21h8" />
  </Icon>
);
export const EraserIcon = () => (
  <Icon>
    <path d="M7 21h12" />
    <path d="M5.5 14.5l8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z" />
    <path d="M10 10l5 5" />
  </Icon>
);
export const UndoIcon = () => (
  <Icon>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </Icon>
);
export const RedoIcon = () => (
  <Icon>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 0 0 0 12h3" />
  </Icon>
);
export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const MinusIcon = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);
export const MoonIcon = () => (
  <Icon>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  </Icon>
);
export const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </Icon>
);
export const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);
export const TrashIcon = () => (
  <Icon>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const FileIcon = () => (
  <Icon>
    <path d="M7 3h7l5 5v13H7z" />
    <path d="M14 3v5h5" />
  </Icon>
);
export const CloudIcon = () => (
  <Icon>
    <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.25 8.5z" />
  </Icon>
);
export const SyncIcon = () => (
  <Icon>
    <path d="M20 12a8 8 0 0 1-14.2 5M4 12a8 8 0 0 1 14.2-5" />
    <path d="M18.5 3v4h-4M5.5 21v-4h4" />
  </Icon>
);
export const AlertIcon = () => (
  <Icon>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17v.01" />
  </Icon>
);
export const FolderIcon = () => (
  <Icon>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </Icon>
);
export const FolderMoveIcon = () => (
  <Icon>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    <path d="M9 13.5h6M12.5 11l2.5 2.5-2.5 2.5" />
  </Icon>
);
export const FolderPlusIcon = () => (
  <Icon>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
    <path d="M12 10.5v6M9 13.5h6" />
  </Icon>
);
export const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);
export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Icon>
);
export const CloseIcon = () => (
  <Icon>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);
export const PencilIcon = () => (
  <Icon>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Icon>
);
export const UploadIcon = () => (
  <Icon>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </Icon>
);
export const ArrowIcon = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
