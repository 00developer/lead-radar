import type { ReactNode, SVGProps } from 'react';

// A small hand-drawn icon set (24x24, stroke based). Decorative by default: aria-hidden.
function Svg({ children, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}
type P = SVGProps<SVGSVGElement>;

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="3.5" width="7" height="8" rx="2" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="2" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="2" />
    <rect x="3.5" y="14.5" width="7" height="6" rx="2" />
  </Svg>
);
export const IconLeads = (p: P) => (
  <Svg {...p}>
    <path d="M4 13.5 6.4 5.6A2 2 0 0 1 8.3 4.2h7.4a2 2 0 0 1 1.9 1.4L20 13.5" />
    <path d="M4 13.5h4.2l1.3 2.5h5l1.3-2.5H20V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
  </Svg>
);
export const IconKeywords = (p: P) => (
  <Svg {...p}>
    <path d="M20.5 13.4 13.4 20.5a2 2 0 0 1-2.8 0L3.5 13.4V3.5h9.9l7.1 7.1a2 2 0 0 1 0 2.8z" />
    <circle cx="8" cy="8" r="1.4" />
  </Svg>
);
export const IconSources = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="1.8" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19.2 4.8a10.2 10.2 0 0 1 0 14.4M4.8 19.2a10.2 10.2 0 0 1 0-14.4" />
  </Svg>
);
export const IconProfile = (p: P) => (
  <Svg {...p}>
    <path d="M5 21V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V21" />
    <path d="M15 10h3.5A1.5 1.5 0 0 1 20 11.5V21M3 21h18M8.5 8h3M8.5 12h3M8.5 16h3" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="17" r="2" />
  </Svg>
);
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3M16 16.5 20.5 12 16 7.5M20.5 12H9.5" />
  </Svg>
);
export const IconMenu = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconSparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.3l-1.9-5.5L4.5 10.9 10.1 9z" />
    <path d="M19 3v3M17.5 4.5h3" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);
export const IconEyeOff = (p: P) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 6.2A9.6 9.6 0 0 1 12 6c5 0 8.5 4.2 9.5 6-0.4 0.8-1.3 2.1-2.7 3.3M6.4 7.7C4.4 9 3 11 2.5 12c1 1.8 4.5 6 9.5 6a9 9 0 0 0 3.2-.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);
export const IconTarget = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="1" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 4 3 19.5h18z" />
    <path d="M12 10v4.2M12 17h.01" />
  </Svg>
);
export const IconCoin = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
    <path d="M4.5 6.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5M4.5 11.5v5c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-5" />
  </Svg>
);
export const IconChart = (p: P) => (
  <Svg {...p}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
  </Svg>
);
export const IconInbox = IconLeads;

/** Brand mark: a radar sweep inside a rounded square with the accent gradient. */
export function LogoMark({ size = 36 }: { size?: number }) {
  return (
    <span className="grad-bg grid place-items-center text-white" style={{ width: size, height: size, borderRadius: size * 0.3, boxShadow: '0 8px 22px -8px var(--accent)' }}>
      <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" opacity="0.55" />
        <circle cx="12" cy="12" r="4.2" opacity="0.8" />
        <path d="M12 12 18.2 5.8" />
        <circle cx="12" cy="12" r="1" fill="currentColor" />
      </svg>
    </span>
  );
}
