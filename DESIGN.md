# Design System — Rostrum Prospectus

## Visual Direction
The prospectus web application is designed to feel **premium, editorial, and sophisticated**, reflecting the high standards of Rostrum Education. It avoids generic SaaS templates in favor of a bespoke reading experience.

## Color Palette
The color system is built entirely around the provided brand colors, using them to create depth and emphasis through glassmorphism and subtle gradients.

### Core Brand Colors
- **Navy**: `#152F7A` (Primary accent, used for subtle backgrounds)
- **Blue**: `#2F4DA4` (Interactive elements, hover states)
- **Crimson**: `#740D28` (Deep accents)
- **Red**: `#CE1D47` (Primary highlight, progress bars, active states)

### UI Surfaces
We use a dark theme to make the white pages of the prospectus "pop" and feel like a glowing centerpiece.
- **Background**: `#fff` (Very white)
- **Cards/Glass**: `rgba(26, 34, 54, 0.7)` (Translucent navy for UI panels)
- **Text**: `#F1F5F9` (Off-white for readability), `#94A3B8` (Muted for secondary text)

## Typography
To achieve the "editorial" feel, we pair a classic serif with a modern sans-serif.

- **Display/Headings**: `Playfair Display`
  - Used for the main titles ("Explore Our Prospectus", "Undergraduate").
  - Provides a traditional, academic, and authoritative feel.
- **Body/UI**: `Inter`
  - Used for small text, buttons, page numbers, and controls.
  - Highly legible at small sizes, providing a clean modern contrast to the serif headings.

## Motion & Interaction
- **Micro-animations**: All UI elements (buttons, thumbnails, cards) have subtle scale and color transitions on hover.
- **Entrance**: The landing page uses staggered, eased animations (Framer Motion) to reveal content elegantly.
- **Page Flip**: The core interaction uses realistic easing physics with dynamic drop shadows that mimic real paper.
- **Accessibility**: Respects `prefers-reduced-motion` across the board, falling back to instant/fade transitions.

## Components

### Glass Controls
The bottom navigation bar uses heavy backdrop-blur (`backdrop-filter: blur(32px)`) to float seamlessly over the background without fully obscuring it, feeling modern and unobtrusive.

### Lazy Thumbnails
The thumbnail strip slides up smoothly. Instead of loading 100+ high-res images at once (which would freeze the browser), it renders low-res versions dynamically only as they scroll into view.
