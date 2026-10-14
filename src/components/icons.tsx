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
export const StarIcon = () => (
  <Icon>
    <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8z" />
  </Icon>
);
export const MarkIcon = () => (
  <Icon>
    <path d="M9 15l-3 3-2 .5.5-2 3-3" />
    <path d="M14 4.5l5.5 5.5-8 8L6 12.5z" />
  </Icon>
);
export const GridIcon = () => (
  <Icon>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);
export const ListIcon = () => (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Icon>
);
export const CopyIcon = () => (
  <Icon>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </Icon>
);
export const BooksIcon = () => (
  <Icon>
    <path d="M5 4h3.5v16H5zM10.5 4H14v16h-3.5z" />
    <path d="M16 5.2l3.3-.9 3 13.6-3.3.8z" transform="translate(-1.5 .4)" />
  </Icon>
);
export const ChevronIcon = () => (
  <Icon>
    <path d="M7 10l5 5 5-5" />
  </Icon>
);
export const MergeIcon = () => (
  <Icon>
    <path d="M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V4" />
    <path d="M12 13v7M9 17.5l3 3 3-3" />
  </Icon>
);
export const SplitIcon = () => (
  <Icon>
    <path d="M12 20v-6" />
    <path d="M12 14c0-3-6-3-6-8M12 14c0-3 6-3 6-8" />
    <path d="M3.5 8.5L6 6l2.5 2.5M15.5 8.5L18 6l2.5 2.5" />
  </Icon>
);
export const CropIcon = () => (
  <Icon>
    <path d="M7 3v14h14M3 7h14v14" />
  </Icon>
);
export const EditPagesIcon = () => (
  <Icon>
    <path d="M13 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H11" />
    <path d="M13 4l4 4v2" />
    <path d="M12.5 19.5l.8-2.8 6-6a1.6 1.6 0 0 1 2.3 2.3l-6 6z" />
  </Icon>
);
export const SparkIcon = () => (
  <Icon>
    <path d="M11 3l1.8 4.7L17.5 9.5l-4.7 1.8L11 16l-1.8-4.7L4.5 9.5l4.7-1.8z" />
    <path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8z" />
  </Icon>
);
export const RotateLeftIcon = () => (
  <Icon>
    <path d="M5 11a7.5 7.5 0 1 1 2.3 5.4" />
    <path d="M4.5 5.5V11H10" />
  </Icon>
);
export const RotateRightIcon = () => (
  <Icon>
    <path d="M19 11a7.5 7.5 0 1 0-2.3 5.4" />
    <path d="M19.5 5.5V11H14" />
  </Icon>
);
export const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 20h14" />
  </Icon>
);
export const CloudOffIcon = () => (
  <Icon>
    <path d="M7 18a4.5 4.5 0 0 1-.6-8.96M10 6.4A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1 1.5 7.4M4 4l16 16" />
    <path d="M9.5 18H17" />
  </Icon>
);

export const HandIcon = () => (
  <Icon>
    <path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11 11V4a1.5 1.5 0 0 1 3 0v7" />
    <path d="M14 11V5.5a1.5 1.5 0 0 1 3 0V13" />
    <path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.5a6 6 0 0 1-4.6-2.1L4.2 14a1.6 1.6 0 0 1 2.4-2L8 13.5" />
  </Icon>
);
export const LassoIcon = () => (
  <Icon>
    <path d="M12 4c4.6 0 8 2 8 4.8S16.6 13.6 12 13.600c-.7 0-1.4-.1-2-.2" strokeDasharray="2.6 2.4" />
    <path d="M12 4C7.4 4 4 6 4 8.800c0 2 1.7 3.6 4.2 4.4" strokeDasharray="2.6 2.4" />
    <path d="M9.5 14.5c-1 1.7-1.6 3.3-1.6 4.6 0 1.1.8 1.9 1.8 1.900s1.7-.7 1.7-1.6" />
  </Icon>
);
export const TextNoteIcon = () => (
  <Icon>
    <path d="M5 6V4.5h14V6M12 4.5V19M9 19h6" />
  </Icon>
);
export const ScissorsIcon = () => (
  <Icon>
    <circle cx="6" cy="6.5" r="2.5" />
    <circle cx="6" cy="17.5" r="2.5" />
    <path d="M8 8l12 9M8 16l12-9" />
  </Icon>
);
export const PasteIcon = () => (
  <Icon>
    <rect x="5" y="5" width="14" height="16" rx="2" />
    <path d="M9 5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 12h6M9 16h4" />
  </Icon>
);
export const StyleIcon = () => (
  <Icon>
    <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.9 2-1.8 0-1.1-.9-1.5-.9-2.5 0-1 .8-1.7 1.9-1.700H17a3.5 3.5 0 0 0 3.5-3.5C20.5 6.7 16.7 3.5 12 3.5z" />
    <circle cx="7.5" cy="11" r="1" />
    <circle cx="10" cy="7.5" r="1" />
    <circle cx="14.5" cy="7.5" r="1" />
  </Icon>
);
export const SelectAllIcon = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="2" strokeDasharray="3 2.5" />
    <path d="M9 12l2.2 2.200L15.5 10" />
  </Icon>
);

export const NotePlusIcon = () => (
  <Icon>
    <path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z" />
    <path d="M14 3.5v5h5" />
    <path d="M12 11.5v6M9 14.5h6" />
  </Icon>
);
export const SwapIcon = () => (
  <Icon>
    <path d="M7 7h12l-3-3M17 17H5l3 3" />
  </Icon>
);

export const MoreVIcon = () => (
  <Icon>
    <circle cx="12" cy="5.5" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="18.5" r="1.3" fill="currentColor" />
  </Icon>
);

export const MoreHIcon = () => (
  <Icon>
    <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
  </Icon>
);

export const SortIcon = () => (
  <Icon>
    <path d="M7 5v14M4 16l3 3 3-3M17 19V5M14 8l3-3 3 3" />
  </Icon>
);

export const UserIcon = () => (
  <Icon>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Icon>
);

export const ShieldIcon = () => (
  <Icon>
    <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />
    <path d="M9 12l2 2 4-4" />
  </Icon>
);

export const RailIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </Icon>
);

export const PanelIcon = () => (
  <Icon>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M14.5 4.5v15" />
  </Icon>
);

export const FitIcon = () => (
  <Icon>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Icon>
);

export const BookOpenIcon = () => (
  <Icon>
    <path d="M12 6.5C10 5 7.5 4.5 4 4.5v14c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-14c-3.5 0-6 .5-8 2z" />
    <path d="M12 6.5v14" />
  </Icon>
);

export const AaIcon = () => (
  <Icon>
    <path d="M3 19l5-13 5 13M5 14h6M15.5 19l3-8 3 8M16.6 16.5h3.8" />
  </Icon>
);

export const BookmarkIcon = ({ filled }: { filled?: boolean }) => (
  <Icon>
    <path d="M7 4h10v17l-5-4-5 4z" fill={filled ? 'currentColor' : 'none'} />
  </Icon>
);

/** Two chevrons: fold the side menu in (pointing left), or open it again (`open`, pointing right). */
export const FoldIcon = ({ open = false }: { open?: boolean }) => (
  <Icon>
    <path d={open ? 'M6 6l6 6-6 6M12 6l6 6-6 6' : 'M18 6l-6 6 6 6M12 6l-6 6 6 6'} />
  </Icon>
);
