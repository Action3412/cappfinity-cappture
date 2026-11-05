const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
export const ChevronL = (p) => <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><path d="M15 18l-6-6 6-6" /></svg>
export const ChevronR = (p) => <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>
export const Repeat = (p) => <svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
export const Search = (p) => <svg width="16" height="16" viewBox="0 0 24 24" {...base} {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
export const Plus = (p) => <svg width="20" height="20" viewBox="0 0 24 24" {...base} {...p}><path d="M12 5v14M5 12h14" /></svg>
export const Pencil = (p) => <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
export const Calendar = (p) => <svg width="14" height="14" viewBox="0 0 24 24" {...base} {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
export const Check = (p) => <svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}><path d="M5 12l5 5L20 7" /></svg>
export const Info = (p) => <svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></svg>
export const Download = (p) => <svg width="15" height="15" viewBox="0 0 24 24" {...base} {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" /></svg>
export const X = (p) => <svg width="11" height="11" viewBox="0 0 24 24" {...base} strokeWidth={2.5} {...p}><path d="M6 6l12 12M18 6L6 18" /></svg>
