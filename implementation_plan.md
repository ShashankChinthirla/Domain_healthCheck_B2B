# Implementation Plan: Apple-Style Hero

## Design Goals
- **Minimalism**: White space, perfect alignment.
- **Premium**: Glassmorphism, subtle shadows, crisp typography.
- **Theme**: Light Mode (`bg-[#f5f5f7]`, `text-[#1d1d1f]`).

## Changes

### 1. Global Styles (`globals.css`)
- **Body Background**: Update to `#f5f5f7`.
- **Text Color**: Update to `#1d1d1f`.
- **Utilities**: Add `.glass-panel` for the specific Apple-like blur.

### 2. DomainChecker Component
- **Structure**:
    - **Header**: Simple "Logo" (Left) + "Nav" (Right).
    - **Main**: Centered Hero.
    - **Background**: Ambient gradient orbs (fixed/absolute).
- **Hero Elements**:
    - **H1**: "Domain Email Security. Explained Simply." (Tracking tight, heavy).
    - **Subtext**: "Instant analysis of your DNS, SPF, and DMARC configuration."
    - **Input**: Large, floating glass container.
- **Transition**:
    - Upon search, the layout must adapt (User requested "Search becomes compact" in previous turn, but this prompt allows "Hero Section" focus. I will ensure smooth handling).

## Technical Details
- **Font**: Use strict system font stack for Apple feel.
- **Search Bar**: `backdrop-blur-xl`, `bg-white/70`, `shadow-2xl`.
- **Results**: Detailed results will remain in their distinct cards (now dark on light, which is a common SaaS pattern).

## Files
- `app/globals.css`
- `components/DomainChecker.tsx`
