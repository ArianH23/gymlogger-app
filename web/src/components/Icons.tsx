import type { ReactNode } from 'react'

// Small line icons drawn here (no icon library): 24 px grid, 2 px stroke, they take the text colour.

function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** A dumbbell: routines. */
export const IconRoutines = () => (
  <Icon>
    <path d="M6.5 8v8M3.5 10v4M17.5 8v8M20.5 10v4M6.5 12h11" />
  </Icon>
)

/** A list: the exercise catalog. */
export const IconExercises = () => (
  <Icon>
    <path d="M8 6h12M8 12h12M8 18h12" />
    <circle cx="4" cy="6" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1" fill="currentColor" stroke="none" />
  </Icon>
)

/** A clock: history. */
export const IconHistory = () => (
  <Icon>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

/** A person: body. */
export const IconBody = () => (
  <Icon>
    <circle cx="12" cy="5" r="2.5" />
    <path d="M5.5 10.5c2 .8 4.2 1.2 6.5 1.2s4.5-.4 6.5-1.2M12 11.7V16M12 16l-3 5M12 16l3 5" />
  </Icon>
)

/** Chevron pointing right, for rows that open something. */
export const IconChevron = () => (
  <Icon size={18}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
)

/** A spark: Claude's plans. */
export const IconSpark = () => (
  <Icon size={18}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
  </Icon>
)
